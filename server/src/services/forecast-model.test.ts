import { it } from 'vitest';
import assert from 'node:assert/strict';
import { valueForecast, quantile, MIN_FORECAST_RETURNS } from '../math/forecast.ts';
import { buildForecasts, calculateScenario, dailyChanges, validateScenario, type ForecastInputs } from './forecast-model.ts';
import { combineEventForecast, forecastMarket, validateEventForecast } from './forecasts.ts';
import type { MeasuredRow } from './matching.ts';

const cutoff = '2026-10-09';
function measurement(driver = 'SPY', b = 1.5, se = .1): MeasuredRow & { price_through: string | null } {
    return { symbol: 'AAPL', driver, b, se, low: b - 1.96 * se, high: b + 1.96 * se, days: 250,
        reliable: true, effect: .015, computed_at: new Date('2026-10-10T02:00:00Z'), price_through: cutoff };
}
function fixture(): ForecastInputs {
    let spy = 100, stock = 100;
    const spyPrices = [], stockPrices = [], yields = [];
    for (let i = 0; i <= 180; i++) {
        const date = new Date(Date.parse(cutoff) - (180 - i) * 86400000).toISOString().slice(0, 10);
        const r = i % 2 ? .01 : -.01; spy *= 1 + r; stock *= 1 + r * 1.5;
        spyPrices.push({ date, close: spy }); stockPrices.push({ date, close: stock }); yields.push({ date, close: i % 2 ? 4.1 : 4 });
    }
    return { holdings: [{ symbol: 'AAPL', valueUsd: 1000 }, { symbol: 'HOME', assetType: 'property', valueUsd: 2000 }],
        prices: new Map([['SPY', spyPrices], ['AAPL', stockPrices], ['DGS2', yields]]),
        measurements: [measurement(), measurement('DGS2', -.2, .02)], cutoff, asOf: '2026-10-10T02:00:00Z' };
}
function market(probability = .8) {
    return forecastMarket({ ticker: 'OIL-M', event_ticker: 'OIL', title: 'Oil outcome', event_title: 'Oil event',
        close_time: new Date('2026-11-01'), tags: ['oil'], ts: new Date('2026-10-10T12:00:00Z'), yes_bid: probability, yes_ask: probability }, Date.parse('2026-10-10T12:01:00Z'));
}

it('uses percent return inputs and matches rounded holding and portfolio values', () => {
    const result = calculateScenario(buildForecasts(fixture()), { driver: 'SPY', change: 2 });
    assert.equal(result.changeUsd, 30); assert.equal(result.predictedValue, 1030); assert.equal(result.coveredValue, 1000);
    assert.equal(result.holdings.reduce((s, h) => s + h.changeUsd, 0), result.changeUsd);
    assert.equal(result.excluded[0].symbol, 'HOME');
});
it('uses yield percentage points without another division by 100 and orders negative-shock bounds', () => {
    const data = buildForecasts(fixture());
    const rise = calculateScenario(data, { driver: 'DGS2', change: .25 });
    const fall = calculateScenario(data, { driver: 'DGS2', change: -.25 });
    assert.equal(rise.changeUsd, -50); assert.equal(fall.changeUsd, 50);
    assert.ok(fall.sensitivityBounds!.low <= fall.predictedValue! && fall.sensitivityBounds!.high >= fall.predictedValue!);
    assert.ok(fall.notes.some(note => note.includes('Treasury yield')));
});
it('shows no figure for noisy or future measurements, retaining valid after-midnight source dates', () => {
    const input = fixture(); input.measurements[0].se = 2;
    assert.equal(calculateScenario(buildForecasts(input), { driver: 'SPY', change: 1 }).predictedValue, null);
    input.measurements[0] = { ...measurement(), price_through: '2026-10-12' };
    assert.equal(buildForecasts(input).drivers[0].holdings.length, 0);
    input.measurements[0] = measurement();
    assert.equal(buildForecasts(input).drivers[0].holdings.length, 1);
});
it('rejects a legacy measurement from after the source session and keeps unrelated holdings unmeasured', () => {
    const input = fixture(); input.measurements[0].price_through = null;
    input.holdings.push({ symbol: 'NO-DATA', valueUsd: 500 });
    const data = buildForecasts(input);
    assert.equal(data.drivers[0].coveredValue, 0);
    assert.ok(data.baseline.excluded.some(h => h.symbol === 'NO-DATA'));
});
it('keeps zero shocks valid, flags extrapolation and suppresses negative linear values', () => {
    const data = buildForecasts(fixture());
    assert.equal(calculateScenario(data, { driver: 'SPY', change: 0 }).predictedValue, 1000);
    assert.ok(calculateScenario(data, { driver: 'SPY', change: 20 }).notes.some(n => n.includes('extrapolates')));
    const invalid = calculateScenario(data, { driver: 'SPY', change: -90 });
    assert.equal(invalid.predictedValue, null); assert.ok(invalid.excluded.some(h => h.symbol === 'AAPL'));
});
it('does not bridge missing price endpoints into a daily return', () => {
    const prices = new Map([['SPY', [{ date: '2026-10-07', close: 100 }, { date: '2026-10-08', close: 101 }, { date: cutoff, close: 102 }]],
        ['AAPL', [{ date: '2026-10-07', close: 100 }, { date: cutoff, close: 110 }]]]);
    assert.equal(dailyChanges(prices, ['AAPL']).rows.length, 0);
});
it('ignores future price endpoints before choosing the source session', () => {
    const input = fixture();
    input.prices.get('SPY')!.push({ date: '2026-10-12', close: 999 });
    input.prices.get('AAPL')!.push({ date: '2026-10-12', close: 999 });
    assert.equal(buildForecasts(input).baseline.priceDate, cutoff);
});
it('does not bridge an invalid SPY session or create forecasts from numeric overflow', () => {
    const input = fixture();
    const prices = new Map([['SPY', [{ date: '2026-10-07', close: 100 }, { date: '2026-10-08', close: NaN }, { date: cutoff, close: 102 }]],
        ['AAPL', [{ date: '2026-10-07', close: 100 }, { date: '2026-10-08', close: 105 }, { date: cutoff, close: 110 }]]]);
    assert.equal(dailyChanges(prices, ['AAPL']).rows.length, 0);
    input.measurements[0] = measurement('SPY', 1e308, 0);
    assert.equal(calculateScenario(buildForecasts(input), { driver: 'SPY', change: 2 }).predictedValue, null);
    assert.equal(valueForecast(Array(180).fill(1e308), 1000).predictedValue, null);
});
it('builds portfolio uncertainty from aligned aggregate returns, preserving cross-holding offsets', () => {
    const input = fixture(), spy = input.prices.get('SPY')!;
    let close = 100;
    input.prices.set('OFFSET', spy.map((p, i) => {
        if (i > 0) close *= 1 - (i % 2 ? .015 : -.015);
        return { date: p.date, close };
    }));
    input.holdings = [{ symbol: 'AAPL', valueUsd: 1000 }, { symbol: 'OFFSET', valueUsd: 1000 }];
    const result = buildForecasts(input);
    assert.equal(result.baseline.coveredValue, 2000);
    assert.deepEqual(result.baseline.estimated80Range, { low: 2000, high: 2000 });
});
it('requires a training, model-selection and independent validation sample', () => {
    assert.equal(valueForecast(Array(MIN_FORECAST_RETURNS - 1).fill(.001), 1000).predictedValue, null);
    const forecast = valueForecast(Array(180).fill(.001), 1000);
    assert.equal(forecast.method, 'rolling-mean'); assert.equal(forecast.predictedValue, 1001);
    assert.equal(forecast.validation!.days, 60); assert.equal(forecast.validation!.rmseUsd, 0);
    assert.deepEqual(forecast.estimated80Range, { low: 1001, high: 1001 });
});
it('selects no change for alternating noise instead of inventing a directional edge', () => {
    const forecast = valueForecast(Array.from({ length: 180 }, (_, i) => i % 2 ? .01 : -.01), 1000);
    assert.equal(forecast.method, 'no-change'); assert.equal(forecast.predictedValue, 1000);
    assert.deepEqual(forecast.estimated80Range, { low: 990, high: 1010 });
});
it('does not use the final audit returns to choose a model and reports a regime-change failure', () => {
    const forecast = valueForecast([...Array(120).fill(.001), ...Array(60).fill(-.001)], 1000);
    assert.equal(forecast.method, 'rolling-mean'); assert.equal(forecast.predictedValue, 999);
    assert.ok(forecast.validation!.rmseUsd > forecast.validation!.noChangeRmseUsd);
    assert.ok(forecast.notes.some(n => n.includes('underperformed')));
});
it('weights yes/no covered values with the bid–ask midpoint, including probabilities zero and one', () => {
    const data = buildForecasts(fixture()), yes = calculateScenario(data, { driver: 'SPY', change: 2 }), no = calculateScenario(data, { driver: 'SPY', change: -2 });
    const result = combineEventForecast(market(), yes, no);
    assert.equal(result.expectedValue, 1018); assert.equal(result.expectedChangeUsd, 18);
    assert.equal(combineEventForecast(market(0), yes, no).expectedValue, 970);
    assert.equal(combineEventForecast(market(1), yes, no).expectedValue, 1030);
    assert.ok(result.notes.some(n => n.includes('assumptions')));
});
it('refuses to weight different portfolio coverage or unavailable odds', () => {
    const data = buildForecasts(fixture()), yes = calculateScenario(data, { driver: 'SPY', change: 2 }), no = calculateScenario(data, { driver: 'SPY', change: -90 });
    assert.equal(combineEventForecast(market(), yes, no).expectedValue, null);
    assert.equal(combineEventForecast({ ...market(), probability: null }, yes, yes).expectedValue, null);
});
it('rejects missing, stale, future and crossed quotes and derives probability directly from bid and ask', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const row = { ticker: 'M', event_ticker: 'E', title: 'Market', event_title: 'Event', tags: ['fed-rates'], close_time: new Date('2026-11-01'), ts: new Date(now), yes_bid: .6, yes_ask: .8 };
    assert.ok(Math.abs(forecastMarket(row, now).probability! - .7) < 1e-10);
    assert.deepEqual(forecastMarket(row, now).drivers, ['DGS2']);
    for (const change of [{ ts: null }, { ts: new Date(now - 31 * 60000) }, { ts: new Date(now + 60000) }, { yes_bid: .9 }])
        assert.equal(forecastMarket({ ...row, ...change }, now).probability, null);
});
it('validates finite inputs, supported daily drivers and ticker syntax', () => {
    for (const body of [null, { driver: 'SPY', change: NaN }, { driver: 'SPY', change: -100 }, { driver: 'DGS2', change: 11 }, { driver: 'MORTGAGE30US', change: .25 }, { driver: 'SPY', change: '1' }])
        assert.throws(() => validateScenario(body));
    assert.deepEqual(validateScenario({ driver: 'DGS2', change: -.25 }), { driver: 'DGS2', change: -.25 });
    assert.throws(() => validateEventForecast({ marketTicker: '../x', driver: 'SPY', yesChange: 1, noChange: -1 }));
    assert.throws(() => quantile([1, 2], NaN));
});
