import type { EventForecastRequest, EventForecastResponse, ForecastMarket, ForecastMarketsResponse, ForecastsResponse, Holding, ScenarioForecast } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { CONTROL, DRIVERS } from '../config/drivers.ts';
import { midpoint } from '../math/index.ts';
import type { PricePoint } from '../math/series.ts';
import { cents } from '../math/forecast.ts';
import { isSecurity } from './asset-links.ts';
import { getHoldings } from './holdings.ts';
import type { MeasuredRow } from './matching.ts';
import { completedPriceDate } from './price-date.ts';
import { buildForecasts, calculateScenario, validateScenario } from './forecast-model.ts';

export async function loadForecasts(session: string, historyLimit: 2 | 321 = 321, snapshot?: Awaited<ReturnType<typeof getHoldings>>): Promise<{
    data: ForecastsResponse; holdings: Holding[]; prices: Map<string, PricePoint[]>; cutoff: string;
}> {
    const portfolio = snapshot ?? await getHoldings(session), cutoff = completedPriceDate(new Date(Date.now()));
    if (!portfolio.holdings.length) return { holdings: [], prices: new Map(), cutoff, data: buildForecasts({ holdings: [], measurements: [], prices: new Map(), cutoff, asOf: null }) };
    const symbols = [...new Set([...portfolio.holdings.filter(isSecurity).map(h => h.symbol), CONTROL,
        ...DRIVERS.filter(d => d.period === 'day').map(d => d.key), ...DRIVERS.flatMap(d => d.levelReference ? [d.levelReference.symbol] : [])])];
    const [prices, measurements] = await Promise.all([
        // Bounded index lookups rather than a table-wide price scan. No external APIs or AI.
        query<{ symbol: string; ts: Date; close: number; loaded_at: Date }>(`
            SELECT s.symbol,p.ts,p.close,p.loaded_at FROM unnest($1::text[])s(symbol)
            CROSS JOIN LATERAL(SELECT ts,close,loaded_at FROM prices WHERE symbol=s.symbol
                AND ts < (($2::date+1)::timestamp AT TIME ZONE 'UTC') ORDER BY ts DESC LIMIT ${historyLimit})p`, [symbols, cutoff]),
        query<MeasuredRow & { price_through: string | null }>(`
            SELECT symbol,driver,b,se,low,high,days,reliable,effect,computed_at,price_through::text
            FROM measured_links WHERE symbol=ANY($1::text[])`, [portfolio.holdings.filter(isSecurity).map(h => h.symbol)])
    ]);
    const series = new Map<string, PricePoint[]>();
    for (const p of prices) {
        const rows = series.get(p.symbol) ?? [];
        rows.push({ date: p.ts.toISOString().slice(0, 10), close: p.close }); series.set(p.symbol, rows);
    }
    for (const rows of series.values()) rows.sort((a, b) => a.date.localeCompare(b.date));
    const times = [portfolio.asOf, ...prices.map(p => iso(p.loaded_at)), ...measurements.map(m => iso(m.computed_at))]
        .flatMap(s => s ? [Date.parse(s)] : []).filter(Number.isFinite);
    const asOf = times.length ? new Date(Math.max(...times)).toISOString() : null;
    return { holdings: portfolio.holdings, prices: series, cutoff, data: buildForecasts({ holdings: portfolio.holdings, measurements, prices: series, cutoff, asOf }) };
}
export async function forecasts(session: string): Promise<ForecastsResponse> { return (await loadForecasts(session)).data; }
export async function scenarioForecast(session: string, input: unknown): Promise<ScenarioForecast> {
    const request = validateScenario(input);
    return calculateScenario(await forecasts(session), request);
}

export interface MarketRow {
    ticker: string; event_ticker: string; title: string; event_title: string; close_time: Date;
    tags: string[]; ts: Date | null; yes_bid: number | null; yes_ask: number | null;
}
export const MAX_QUOTE_AGE_MS = 30 * 60 * 1000;
export function forecastMarket(row: MarketRow, now = Date.now()): ForecastMarket {
    let probability: number | null = null, spread: number | null = null;
    let probabilityNote = 'No valid recent bid–ask quote. Reload after the poller updates this market.';
    const time = row.ts?.getTime();
    if (time !== undefined && time <= now && now - time <= MAX_QUOTE_AGE_MS && row.yes_bid !== null && row.yes_ask !== null) {
        try { const quote = midpoint(row.yes_bid, row.yes_ask); probability = quote.p; spread = quote.spread;
            probabilityNote = 'Kalshi bid–ask midpoint. This is the market’s probability, not a Hedgehog prediction.'; }
        catch { /* Fail closed on crossed or invalid quotes. */ }
    }
    return { ticker: row.ticker, eventTicker: row.event_ticker, title: row.title, eventTitle: row.event_title,
        closeTime: row.close_time.toISOString(), probability, spread, probabilityNote, asOf: iso(row.ts),
        drivers: DRIVERS.filter(d => d.period === 'day' && d.tags.some(tag => row.tags.includes(tag))).map(d => d.key) };
}

async function marketsForHoldings(holdings: Holding[], marketTicker?: string): Promise<ForecastMarketsResponse> {
    const symbols = holdings.filter(isSecurity).map(h => h.symbol);
    if (!symbols.length) return { markets: [], asOf: null };
    const rows = await query<MarketRow>(`
        WITH relevant AS MATERIALIZED (
            SELECT series_ticker,array_agg(tag) AS tags FROM series_tags WHERE reviewed=true
            GROUP BY series_ticker HAVING bool_or(tag=ANY($1::text[]) OR tag IN(SELECT tag FROM stock_tags WHERE symbol=ANY($1::text[])))
        ), linked AS MATERIALIZED (
            SELECT m.ticker,m.event_ticker,m.title,e.title AS event_title,m.close_time,r.tags
            FROM relevant r JOIN markets m ON m.series_ticker=r.series_ticker JOIN events e ON e.ticker=m.event_ticker
            WHERE m.status='active' AND m.close_time>now() AND ($2::text IS NULL OR m.ticker=$2)
            ORDER BY m.close_time,m.ticker LIMIT 200
        ) SELECT m.*,q.ts,q.yes_bid,q.yes_ask FROM linked m
        LEFT JOIN LATERAL(SELECT ts,yes_bid,yes_ask FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)q ON true
        ORDER BY m.close_time,m.ticker`, [symbols, marketTicker ?? null]);
    const markets = rows.map(row => forecastMarket(row));
    const times = markets.flatMap(m => m.asOf ? [Date.parse(m.asOf)] : []);
    return { markets, asOf: times.length ? new Date(Math.max(...times)).toISOString() : null };
}
export async function forecastMarkets(session: string, snapshot?: Awaited<ReturnType<typeof getHoldings>>): Promise<ForecastMarketsResponse> {
    return marketsForHoldings((snapshot ?? await getHoldings(session)).holdings);
}

export function validateEventForecast(input: unknown): EventForecastRequest {
    const body = input as Partial<EventForecastRequest> | null;
    if (typeof body?.marketTicker !== 'string' || !/^[A-Z0-9][A-Z0-9._-]{0,149}$/.test(body.marketTicker))
        throw new Error('Choose a linked Kalshi market');
    const yes = validateScenario({ driver: body.driver, change: body.yesChange });
    const no = validateScenario({ driver: body.driver, change: body.noChange });
    return { marketTicker: body.marketTicker, driver: yes.driver, yesChange: yes.change, noChange: no.change };
}

export function combineEventForecast(market: ForecastMarket, yes: ScenarioForecast, no: ScenarioForecast): EventForecastResponse {
    // Never average forecasts of different portions of the portfolio.
    const sameCoverage = yes.holdings.map(h => h.symbol).sort().join('|') === no.holdings.map(h => h.symbol).sort().join('|');
    const p = market.probability;
    const expectedValue = p !== null && sameCoverage && yes.predictedValue !== null && no.predictedValue !== null
        ? cents(p * yes.predictedValue + (1 - p) * no.predictedValue) : null;
    return { market, yes, no, expectedValue,
        expectedChangeUsd: expectedValue === null ? null : cents(expectedValue - yes.coveredValue),
        asOf: market.asOf,
        notes: ['A conditional one-session scenario around the event, not a cumulative forecast through the market’s close date.',
            'Yes/no driver changes are your assumptions. Enter remaining net changes from current prices, allowing for expectations already priced in. Event odds alone do not establish a stock-price effect.',
            'Expected value = midpoint × yes value + (1 − midpoint) × no value. Individual event forecasts overlap and must not be added.',
            ...(p === null ? [market.probabilityNote] : []),
            ...(!sameCoverage ? ['The outcome scenarios cover different holdings, so a weighted value cannot be calculated. Use smaller shocks.'] : [])] };
}

export async function eventForecast(session: string, input: unknown): Promise<EventForecastResponse | null> {
    const request = validateEventForecast(input);
    const { data, holdings } = await loadForecasts(session);
    const market = (await marketsForHoldings(holdings, request.marketTicker)).markets[0];
    if (!market) return null;
    return combineEventForecast(market,
        calculateScenario(data, { driver: request.driver, change: request.yesChange }),
        calculateScenario(data, { driver: request.driver, change: request.noChange }));
}
