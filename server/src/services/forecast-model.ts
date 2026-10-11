import type { ForecastDriver, ForecastsResponse, Holding, ScenarioForecast, ScenarioRequest, ValueForecast } from '../../../shared/types.ts';
import { CONTROL, DRIVERS } from '../config/drivers.ts';
import type { PricePoint } from '../math/series.ts';
import { cents, FORECAST_TRAIN_DAYS, MIN_FORECAST_RETURNS, valueForecast } from '../math/forecast.ts';
import { isSecurity } from './asset-links.ts';
import { rankDrivers, reliableRow, type MeasuredRow } from './matching.ts';

export const driverLabels: Record<string, string> = {
    SPY: 'Stock market (SPY)', 'CL=F': 'Crude oil', DGS2: '2-year Treasury yield', DGS10: '10-year Treasury yield'
};
export interface ForecastInputs {
    holdings: Holding[];
    measurements: (MeasuredRow & { price_through: string | null })[];
    prices: Map<string, PricePoint[]>;
    cutoff: string;
    asOf: string | null;
}

// Intersect PRICE ENDPOINTS, without bridging missing SPY sessions. Otherwise a multi-day
// stock move could be mistaken for a one-day forecast observation.
export function dailyChanges(prices: Map<string, PricePoint[]>, symbols: string[], differences: string[] = []) {
    const control = new Map((prices.get(CONTROL) ?? []).map(p => [p.date, p.close]));
    const sessions = [...control.keys()].sort();
    const maps = symbols.map(s => new Map((prices.get(s) ?? []).map(p => [p.date, p.close])));
    const dates: string[] = [], rows: number[][] = [];
    for (let i = 1; i < sessions.length; i++) {
        const before = sessions[i - 1], after = sessions[i];
        if (![control.get(before), control.get(after)].every(p => typeof p === 'number' && Number.isFinite(p) && p > 0)) continue;
        const values = maps.map((m, j) => {
            const a = m.get(before), b = m.get(after);
            if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return NaN;
            return differences.includes(symbols[j]) ? b - a : a > 0 && b > 0 ? b / a - 1 : NaN;
        });
        if (values.every(Number.isFinite)) { dates.push(after); rows.push(values); }
    }
    return { dates, rows };
}

export function buildForecasts(input: ForecastInputs): ForecastsResponse {
    const { holdings } = input;
    const prices = new Map([...input.prices].map(([symbol, rows]) => [symbol,
        rows.filter(p => p.date <= input.cutoff).sort((a, b) => a.date.localeCompare(b.date))]));
    const priceDate = prices.get(CONTROL)?.filter(p => Number.isFinite(p.close) && p.close > 0).at(-1)?.date ?? null;
    const securities = holdings.filter(isSecurity);
    const valid = input.measurements.filter(m => reliableRow(m) && (m.price_through
        ? m.price_through <= (priceDate ?? input.cutoff)
        : m.computed_at.toISOString().slice(0, 10) <= (priceDate ?? input.cutoff)));
    const covered = securities.filter(h => {
        const latest = prices.get(h.symbol)?.at(-1);
        return latest?.date === priceDate && Number.isFinite(latest.close) && latest.close > 0
            && dailyChanges(prices, [h.symbol]).rows.length >= MIN_FORECAST_RETURNS;
    });
    const coveredValue = cents(covered.reduce((s, h) => s + h.valueUsd, 0));
    const baseline: ValueForecast = {
        ...valueForecast(covered.length ? dailyChanges(prices, covered.map(h => h.symbol)).rows.map(row =>
            row.reduce((sum, r, i) => sum + r * covered[i].valueUsd / coveredValue, 0)) : [], coveredValue),
        horizon: 'next-trading-day', priceDate, coveredValue,
        excluded: holdings.filter(h => !covered.includes(h)).map(h => ({ symbol: h.symbol, valueUsd: h.valueUsd,
            reason: isSecurity(h) ? 'Insufficient aligned history or no price for the latest SPY session.' : 'No daily market-price history for this asset.' }))
    };
    baseline.notes.push('Uses stored Yahoo Finance daily closes and fixed weights from your current dollar holdings, excluding dividends and future deposits or trades. This is a hypothetical portfolio, not your account’s historical performance.');
    baseline.notes.push(`The horizon is the next trading session after ${priceDate ?? 'the missing source session'}, anchored to your entered/imported holding values.`);
    const drivers: ForecastDriver[] = DRIVERS.filter(d => d.period === 'day').map(driver => {
        const modeled = securities.flatMap(h => {
            const m = valid.find(m => m.symbol === h.symbol && m.driver === driver.key);
            return m ? [{ symbol: h.symbol, valueUsd: h.valueUsd,
                sensitivity: { b: m.b, low: m.b - 1.96 * m.se, high: m.b + 1.96 * m.se,
                    days: m.days, driver: m.driver, computedAt: m.computed_at.toISOString(), typicalEffect: m.effect ?? null },
                lead: rankDrivers(h.symbol, valid)[0] ?? null }] : [];
        });
        const changes = dailyChanges(prices, [driver.key], driver.change === 'difference' ? [driver.key] : []).rows.map(row => row[0]);
        const scale = driver.change === 'return' ? 100 : 1;
        return { key: driver.key, label: driverLabels[driver.key] ?? driver.key,
            unit: driver.change === 'return' ? 'percent' : 'percentage-points', holdings: modeled,
            coveredValue: cents(modeled.reduce((s, h) => s + h.valueUsd, 0)),
            excluded: holdings.filter(h => !modeled.some(m => m.symbol === h.symbol)).map(h => ({ symbol: h.symbol, valueUsd: h.valueUsd,
                reason: isSecurity(h) ? `No reliable, source-date-valid ${driver.key} sensitivity.` : 'No stock-return sensitivity for this asset.' })),
            historicalChangeRange: changes.length >= FORECAST_TRAIN_DAYS ? { low: Math.min(...changes) * scale, high: Math.max(...changes) * scale } : null };
    });
    return { totalValue: cents(holdings.reduce((s, h) => s + h.valueUsd, 0)), baseline, drivers, asOf: input.asOf };
}

export function validateScenario(input: unknown): ScenarioRequest {
    const body = input as Partial<ScenarioRequest> | null;
    const driver = DRIVERS.find(d => d.period === 'day' && d.key === body?.driver);
    if (!driver) throw new Error('Choose a supported daily driver');
    if (typeof body?.change !== 'number' || !Number.isFinite(body.change)
        || (driver.change === 'return' ? body.change <= -100 || body.change > 100 : Math.abs(body.change) > 10))
        throw new Error(driver.change === 'return' ? 'Enter a percent change greater than -100 and at most 100' : 'Enter a yield change between -10 and 10 percentage points');
    return { driver: driver.key, change: body.change };
}

export function calculateScenario(data: ForecastsResponse, request: ScenarioRequest): ScenarioForecast {
    const driver = data.drivers.find(d => d.key === request.driver)!;
    const change = driver.unit === 'percent' ? request.change / 100 : request.change;
    const notes = ['A one-session driver contribution, calculated as value × measured sensitivity × entered driver change. Other contributions are held at zero; separate driver models overlap and must not be added.'];
    if (driver.key !== CONTROL) notes.push('The sensitivity was measured with SPY as a control. This scenario holds the stock-market return at zero. A Fed policy-rate change is not automatically the same change in a Treasury yield.');
    const invalid = driver.holdings.filter(h => {
        const value = h.valueUsd * (1 + h.sensitivity.b * change);
        return !Number.isFinite(cents(value)) || value < 0;
    });
    const holdings = driver.holdings.filter(h => !invalid.includes(h)).map(h => {
        const changeUsd = cents(h.valueUsd * h.sensitivity.b * change);
        return { symbol: h.symbol, valueUsd: h.valueUsd, changeUsd, predictedValue: cents(h.valueUsd + changeUsd), sensitivity: h.sensitivity };
    });
    const coveredValue = cents(holdings.reduce((s, h) => s + h.valueUsd, 0));
    const changeUsd = holdings.length ? cents(holdings.reduce((s, h) => s + h.changeUsd, 0)) : null;
    let low = 0, high = 0;
    for (const h of holdings) {
        const ends = [h.valueUsd * h.sensitivity.low * change, h.valueUsd * h.sensitivity.high * change];
        low += h.valueUsd + Math.min(...ends); high += h.valueUsd + Math.max(...ends);
    }
    const sensitivityBounds = holdings.length && low >= 0 && Number.isFinite(low) && Number.isFinite(high) ? { low: cents(low), high: cents(high) } : null;
    notes.push('Sensitivity bounds combine the fitted coefficient endpoints. They are not a portfolio 95% confidence interval and do not include unexplained future price moves.');
    if (!holdings.length) notes.push('No holdings support a numeric scenario for this driver. Missing sensitivities are not treated as zero.');
    const range = driver.historicalChangeRange;
    if (range && (request.change < range.low || request.change > range.high)) notes.push('The entered change is outside the recent observed daily driver range. This extrapolates the measured linear relationship.');
    return { driver: request.driver, change: request.change, coveredValue, changeUsd,
        predictedValue: changeUsd === null ? null : cents(coveredValue + changeUsd), sensitivityBounds, holdings,
        excluded: [...driver.excluded, ...invalid.map(h => ({ symbol: h.symbol, valueUsd: h.valueUsd, reason: 'This shock produces an invalid linear-model value; the estimate is unsupported.' }))],
        notes, asOf: data.asOf };
}
