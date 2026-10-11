import type { ForecastResultResponse, ForecastResultSummary, ForecastsResponse, Holding, RankedForecastEvent, ScenarioRequest, ForecastMarket } from '../../../shared/types.ts';
import type { PricePoint } from '../math/series.ts';
import { cents } from '../math/forecast.ts';
import { DRIVERS } from '../config/drivers.ts';
import { calculateScenario, validateScenario } from './forecast-model.ts';
import { forecastMarket, type MarketRow } from './forecasts.ts';

export interface EventCandidate {
    ticker: string; seriesTicker: string; title: string; category: string; tags: string[];
    linkedSymbols: string[]; eventTime: string; eventTimeSource: RankedForecastEvent['eventTimeSource']; closeTime: string;
    /** Presentation family; does not grant a verified per-contract level mapping. */
    groupKey?: string;
}
export interface ResultMarketRow extends MarketRow {
    series_ticker: string; strike_type: string | null; floor_strike: number | null; cap_strike: number | null;
    linked_symbols: string[];
}

export function rankForecastEvents(candidates: EventCandidate[], data: ForecastsResponse, holdings: Holding[]): RankedForecastEvent[] {
    const values = new Map(holdings.map(h => [h.symbol, h.valueUsd] as const));
    return candidates.map(event => {
        const exact = DRIVERS.find(d => d.levelSeries?.includes(event.seriesTicker) || event.groupKey === `level:${d.key}`);
        const options = data.drivers.filter(d => d.key === exact?.key || DRIVERS.find(source => source.key === d.key)?.tags.some(t => event.tags.includes(t)))
            .map(driver => {
                const holdings = driver.holdings.filter(h => event.linkedSymbols.includes(h.symbol));
                const dailySensitivityUsd = holdings.length && holdings.every(h => h.sensitivity.typicalEffect !== null && Number.isFinite(h.sensitivity.typicalEffect) && h.sensitivity.typicalEffect >= 0)
                    ? cents(holdings.reduce((s, h) => s + h.valueUsd * h.sensitivity.typicalEffect!, 0)) : null;
                return { driver, holdings, dailySensitivityUsd };
            }).sort((a, b) => Number(b.driver.key === exact?.key) - Number(a.driver.key === exact?.key)
                || (b.dailySensitivityUsd ?? -1) - (a.dailySensitivityUsd ?? -1));
        const chosen = options[0];
        const linkedValue = cents(event.linkedSymbols.reduce((s, symbol) => s + (values.get(symbol) ?? 0), 0));
        return { ticker: event.ticker, title: event.title, category: event.category, eventTime: event.eventTime,
            eventTimeSource: event.eventTimeSource, closeTime: event.closeTime, linkedValue,
            share: data.totalValue ? linkedValue / data.totalValue : 0, dailySensitivityUsd: chosen?.dailySensitivityUsd ?? null,
            driver: chosen?.driver.key ?? null, driverLabel: chosen?.driver.label ?? null,
            measuredSymbols: chosen?.holdings.map(h => h.symbol) ?? [],
            unmeasuredSymbols: event.linkedSymbols.filter(s => !chosen?.holdings.some(h => h.symbol === s)), outcomes: [], preferredMarketTicker: null };
    }).sort((a, b) => (b.dailySensitivityUsd ?? -1) - (a.dailySensitivityUsd ?? -1)
        || b.linkedValue - a.linkedValue || a.eventTime.localeCompare(b.eventTime) || a.ticker.localeCompare(b.ticker));
}

/** A specific numeric result, not a guessed average of a binary yes/no tail. */
export function predictEventResult(row: ResultMarketRow, data: ForecastsResponse, prices: Map<string, PricePoint[]>, cutoff: string): ForecastResultResponse {
    const market = forecastMarket(row);
    const driver = DRIVERS.find(d => d.levelSeries?.includes(row.series_ticker));
    const referenceSymbol = driver?.levelReference?.symbol ?? driver?.key;
    const reference = referenceSymbol ? prices.get(referenceSymbol)?.filter(p => p.date <= cutoff && Number.isFinite(p.close)).at(-1) : undefined;
    const unit = driver?.levelReference?.unit ?? 'percent';
    const levelText = (value: number) => unit === 'points' ? `${value.toFixed(2)} index points` : `${value.toFixed(3)}% yield`;
    let level: number | null = null, label = 'No measured outcome estimate';
    if (row.strike_type === 'between' && row.floor_strike !== null && row.cap_strike !== null
        && Number.isFinite(row.floor_strike) && Number.isFinite(row.cap_strike) && row.floor_strike < row.cap_strike) {
        level = (row.floor_strike + row.cap_strike) / 2;
        label = `At ${levelText(level)} (midpoint of the result range)`;
    } else if (['greater', 'greater_or_equal'].includes(row.strike_type ?? '') && row.floor_strike !== null && Number.isFinite(row.floor_strike)) {
        level = row.floor_strike; label = `At ${levelText(level)} (market boundary)`;
    } else if (['less', 'less_or_equal'].includes(row.strike_type ?? '') && row.cap_strike !== null && Number.isFinite(row.cap_strike)) {
        level = row.cap_strike; label = `At ${levelText(level)} (market boundary)`;
    }
    let reason: string | null = null;
    let unavailableReason: ForecastResultSummary['unavailableReason'];
    if (!driver) { unavailableReason = 'outcome-mapping'; reason = 'This event result does not specify a verified measured driver level. A shared topic or company tag cannot establish whether a stock goes up or down. Enter a driver-change assumption to calculate a measured scenario.'; }
    else if (level === null) { unavailableReason = 'missing-strike'; reason = 'The market has no supported numeric strike. No result value is inferred from its title. Enter a driver-change assumption instead.'; }
    else if (!reference || (unit === 'points' && reference.close <= 0) || Date.parse(cutoff) - Date.parse(reference.date) > 7 * 86400000) {
        unavailableReason = 'missing-reference'; reason = `A recent ${referenceSymbol} reference is missing. Run the price job, then reload; reloading alone does not fetch prices.`;
    }
    const summary: ForecastResultSummary = { marketTicker: market.ticker, label: driver ? label : 'No measured outcome estimate',
        driver: driver?.key ?? null, targetLevel: driver ? level : null,
        reference: reference && driver ? { value: reference.close, date: reference.date, url: driver.levelReference?.url ?? `https://fred.stlouisfed.org/series/${driver.key}`,
            unit, label: driver.levelReference?.label ?? driver.key } : null,
        coveredValue: 0, changeUsd: null, portfolioValueAssumingOthersFlat: null, gainingStocks: [], losingStocks: [], reason, unavailableReason, basis: 'market-level' };
    const notes = ['This is a static sensitivity scenario at the specified result level, with other contributions held at zero. It is not a cumulative return forecast through the event date.',
        'For above/below markets, the estimate is at the boundary, not the full yes or no outcome. For a bounded range, its midpoint is a representative result, not an estimated conditional average.',
        'Kalshi odds refer to the market’s full yes outcome, not the exact level used in this scenario. Separate event estimates overlap and must not be added.',
        'The full portfolio scenario keeps every excluded holding at its current value. Those holdings’ actual future moves are unknown.'];
    if (driver?.levelReference?.proxy) notes.unshift('Proxy scenario: the S&P 500 index return is substituted for the SPY return in the measured stock beta. SPY tracking differences, dividends and fees are not modeled.');
    const scenarioDrivers = availableScenarioDrivers(row.linked_symbols, data);
    if (!scenarioDrivers.length) {
        summary.unavailableReason = 'no-measurement';
        summary.reason = 'No reviewed event-linked holding has a reliable daily sensitivity. The measurement job needs sufficient aligned price history and a coefficient range excluding zero.';
    }
    if (summary.reason || !driver || level === null || !reference) return { market, totalValue: data.totalValue, result: summary, scenario: null, stocks: [], notes, scenarioDrivers, asOf: data.asOf };
    let request;
    try { request = validateScenario({ driver: driver.key, change: unit === 'points' ? (level / reference.close - 1) * 100 : level - reference.close }); }
    catch { return { market, totalValue: data.totalValue, result: { ...summary, unavailableReason: 'scenario-range', reason: 'This result exceeds the supported linear-scenario range.' }, scenario: null, stocks: [], notes, scenarioDrivers, asOf: data.asOf }; }
    return applyResultScenario(market, row.linked_symbols, data, request, summary, notes);
}

function availableScenarioDrivers(linkedSymbols: string[], data: ForecastsResponse): NonNullable<ForecastResultResponse['scenarioDrivers']> {
    return data.drivers.flatMap(driver => {
        const linked = driver.holdings.filter(h => linkedSymbols.includes(h.symbol));
        return linked.length ? [{ key: driver.key, label: driver.label, unit: driver.unit,
            coveredValue: cents(linked.reduce((sum, h) => sum + h.valueUsd, 0)) }] : [];
    });
}

/** An explicit user assumption supplies the missing outcome-to-driver link, never the AI. */
export function assumedEventResult(row: ResultMarketRow, data: ForecastsResponse, input: unknown): ForecastResultResponse {
    return assumedForecastResult(forecastMarket(row), row.linked_symbols, data, input);
}

export function assumedForecastResult(market: ForecastMarket, linkedSymbols: string[], data: ForecastsResponse, input: unknown): ForecastResultResponse {
    const request = validateScenario(input);
    const driver = data.drivers.find(d => d.key === request.driver)!;
    const summary: ForecastResultSummary = { marketTicker: market.ticker, label: `Assuming ${driver.label} changes ${request.change}${driver.unit === 'percent' ? '%' : ' percentage points'}`,
        driver: request.driver, targetLevel: null, reference: null, coveredValue: 0, changeUsd: null,
        portfolioValueAssumingOthersFlat: null, gainingStocks: [], losingStocks: [], reason: null,
        basis: 'user-assumption', assumption: request };
    return applyResultScenario(market, linkedSymbols, data, request, summary, [
        'The driver change is your assumption for this result, not an automatically predicted event reaction. Stock effects use reliable measured sensitivities.',
        'Enter the remaining net change from current prices for one session around the event, allowing for expectations already priced in. This is not cumulative growth through the market close.',
        'Other driver contributions are held at zero; holdings without a reviewed event link or reliable sensitivity keep their current values. Their actual moves are unknown.',
        'Kalshi odds describe the contract outcome, not the chance of your assumed driver change. These overlapping scenarios must not be added.'
    ]);
}

function applyResultScenario(market: ForecastMarket, linkedSymbols: string[], data: ForecastsResponse, request: ScenarioRequest, summary: ForecastResultSummary, notes: string[]): ForecastResultResponse {
    const scoped = { ...data, drivers: data.drivers.map(d => ({ ...d,
        holdings: d.holdings.filter(h => linkedSymbols.includes(h.symbol)),
        excluded: [...d.excluded, ...d.holdings.filter(h => !linkedSymbols.includes(h.symbol)).map(h => ({ symbol: h.symbol, valueUsd: h.valueUsd, reason: 'No reviewed portfolio link to this event.' }))] })) };
    const scenario = calculateScenario(scoped, request);
    const model = scoped.drivers.find(d => d.key === request.driver)!;
    const stocks = scenario.holdings.map(h => {
        const returnEstimate = h.sensitivity.b * (model.unit === 'percent' ? request.change / 100 : request.change);
        return { symbol: h.symbol, currentValue: h.valueUsd, predictedValue: h.predictedValue, changeUsd: h.changeUsd,
            returnEstimate, direction: returnEstimate > 0 ? 'up' as const : returnEstimate < 0 ? 'down' as const : 'unchanged' as const,
            sensitivity: h.sensitivity, lead: model.holdings.find(m => m.symbol === h.symbol)?.lead ?? null };
    }).sort((a, b) => Math.abs(b.changeUsd) - Math.abs(a.changeUsd) || a.symbol.localeCompare(b.symbol));
    return { market, totalValue: data.totalValue, scenario, stocks, asOf: data.asOf, notes, scenarioDrivers: availableScenarioDrivers(linkedSymbols, data),
        result: { ...summary, coveredValue: scenario.coveredValue, changeUsd: scenario.changeUsd,
            evidence: stocks.length ? { driver: request.driver, change: request.change, unit: model.unit,
                observations: Math.min(...stocks.map(h => h.sensitivity.days)),
                measuredAt: stocks.map(h => h.sensitivity.computedAt).sort()[0], referenceUrl: summary.reference?.url ?? null } : undefined,
            portfolioValueAssumingOthersFlat: scenario.changeUsd === null ? null : cents(data.totalValue + scenario.changeUsd),
            gainingStocks: stocks.filter(s => s.direction === 'up').map(s => s.symbol), losingStocks: stocks.filter(s => s.direction === 'down').map(s => s.symbol),
            unavailableReason: scenario.predictedValue === null ? model.holdings.length ? 'scenario-range' : 'no-measurement' : undefined,
            reason: scenario.predictedValue !== null ? null : model.holdings.length
                ? 'This shock leaves no linked holding with a valid linear-model value. Enter a smaller assumption.'
                : 'No linked holding has a reliable sensitivity for this driver and result. Run the measurement job after loading sufficient price history; unreliable coefficients cannot produce a number.' } };
}
