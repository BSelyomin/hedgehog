import { it } from 'vitest';
import assert from 'node:assert/strict';
import { buildForecasts } from './forecast-model.ts';
import { rankForecastEvents, predictEventResult, assumedEventResult, type EventCandidate, type ResultMarketRow } from './event-predictions.ts';

const cutoff = '2026-10-09';
function fixture() {
    const holdings = [{ symbol: 'AAA', valueUsd: 1000 }, { symbol: 'BBB', valueUsd: 2000 }, { symbol: 'CCC', valueUsd: 500 }];
    const prices = new Map(['SPY', 'AAA', 'BBB', 'CCC', 'DGS2', 'DGS10'].map(symbol => [symbol,
        [{ date: '2026-10-08', close: symbol.startsWith('DGS') ? 4 : 100 }, { date: cutoff, close: symbol.startsWith('DGS') ? 4 : 101 }]]));
    const measurements = ['AAA', 'BBB'].flatMap(symbol => ['SPY', 'DGS2', 'DGS10'].map(driver => {
        const b = driver === 'SPY' ? 1 : symbol === 'AAA' ? -.2 : .1, se = .01;
        return { symbol, driver, b, se, low: b - 1.96 * se, high: b + 1.96 * se, days: 250, reliable: true,
            effect: driver === 'SPY' ? .01 : .02, price_through: cutoff, computed_at: new Date('2026-10-10T02:00:00Z') };
    }));
    return { holdings, prices, data: buildForecasts({ holdings, prices, measurements, cutoff, asOf: '2026-10-10T02:00:00Z' }) };
}
function candidate(ticker = 'YIELD', changes: Partial<EventCandidate> = {}): EventCandidate {
    return { ticker, seriesTicker: 'KXUST2AD', title: 'Treasury result', category: 'Economics', tags: ['fed-rates'],
        linkedSymbols: ['AAA', 'BBB', 'CCC'], eventTime: '2026-11-01', eventTimeSource: 'close', closeTime: '2026-11-01', ...changes };
}
function market(changes: Partial<ResultMarketRow> = {}): ResultMarketRow {
    return { ticker: 'YIELD-M', event_ticker: 'YIELD', series_ticker: 'KXUST2AD', title: '4.26% or above', event_title: 'Treasury result',
        close_time: new Date('2026-11-01'), tags: ['fed-rates'], ts: new Date(), yes_bid: .6, yes_ask: .8,
        strike_type: 'greater', floor_strike: 4.25, cap_strike: null, linked_symbols: ['AAA', 'BBB', 'CCC'], ...changes };
}
it('ranks every candidate by gross daily sensitivity rather than reach, chronology or netting signs', () => {
    const { data, holdings } = fixture();
    const candidates = Array.from({ length: 250 }, (_, i) => candidate(`SMALL-${i}`, { linkedSymbols: ['AAA'] }));
    candidates.push(candidate('BIG', { eventTime: '2026-12-01' }));
    const ranked = rankForecastEvents(candidates, data, holdings);
    assert.equal(ranked[0].ticker, 'BIG'); assert.equal(ranked[0].dailySensitivityUsd, 60);
    assert.equal(ranked[0].linkedValue, 3500); assert.deepEqual(ranked[0].unmeasuredSymbols, ['CCC']);
});
it('uses the verified result driver ahead of an incorrectly shared stock-market topic', () => {
    const { data, holdings } = fixture(); data.drivers.find(d => d.key === 'SPY')!.holdings.forEach(h => h.sensitivity.typicalEffect = .9);
    assert.equal(rankForecastEvents([candidate('E', { tags: ['sp500'] })], data, holdings)[0].driver, 'DGS2');
});
it('withholds incomplete rankings and never invents sensitivity for topic-only stocks', () => {
    const { data, holdings } = fixture(); data.drivers.find(d => d.key === 'DGS2')!.holdings[0].sensitivity.typicalEffect = null;
    const ranked = rankForecastEvents([candidate(), candidate('UNMEASURED', { linkedSymbols: ['CCC'] })], data, holdings);
    assert.equal(ranked[0].dailySensitivityUsd, null); assert.equal(ranked[1].linkedValue, 500);
    assert.deepEqual(ranked[1].measuredSymbols, []);
});
it('projects opposite stock directions using stored strikes and yield-point units, without netting away stock risk', () => {
    const { data, prices } = fixture(); const result = predictEventResult(market(), data, prices, cutoff);
    assert.equal(result.result.targetLevel, 4.25); assert.equal(result.market.probability, .7);
    assert.equal(result.stocks.find(s => s.symbol === 'AAA')!.changeUsd, -50);
    assert.equal(result.stocks.find(s => s.symbol === 'BBB')!.changeUsd, 50);
    assert.deepEqual(result.result.gainingStocks, ['BBB']); assert.deepEqual(result.result.losingStocks, ['AAA']);
    assert.equal(result.result.portfolioValueAssumingOthersFlat, 3500); assert.equal(result.scenario!.coveredValue, 3000);
    assert.ok(result.notes.some(n => n.includes('not the full yes or no')));
    assert.ok(result.notes.some(n => n.includes('excluded holding at its current value')));
    assert.deepEqual(result.result.evidence, { driver: 'DGS2', change: .25, unit: 'percentage-points',
        observations: 250, measuredAt: '2026-10-10T02:00:00.000Z', referenceUrl: result.result.reference!.url });
    for (const stock of result.stocks) assert.equal(stock.changeUsd, stock.currentValue * stock.sensitivity.b * result.result.evidence!.change);
});
it('restricts modeled contributions to reviewed event-linked holdings and supports below and bounded results', () => {
    const { data, prices } = fixture();
    const below = predictEventResult(market({ strike_type: 'less', floor_strike: null, cap_strike: 3.75, linked_symbols: ['AAA'] }), data, prices, cutoff);
    assert.equal(below.result.changeUsd, 50); assert.equal(below.result.portfolioValueAssumingOthersFlat, 3550);
    assert.deepEqual(below.result.gainingStocks, ['AAA']); assert.equal(below.stocks.length, 1);
    const range = predictEventResult(market({ series_ticker: 'KXUST10AD', strike_type: 'between', floor_strike: 4, cap_strike: 4.5 }), data, prices, cutoff);
    assert.equal(range.result.driver, 'DGS10'); assert.equal(range.result.targetLevel, 4.25);
    assert.ok(range.result.label.includes('midpoint of the result range'));
});
it('does not substitute policy rates, futures, unverified Treasury series or title text for measured results', () => {
    const { data, prices } = fixture();
    for (const series_ticker of ['KXFED', 'KXWTIW', 'KXUST2MAX', 'KXPYTHUS2Y']) {
        const result = predictEventResult(market({ series_ticker }), data, prices, cutoff);
        assert.equal(result.result.changeUsd, null); assert.equal(result.stocks.length, 0);
    }
    assert.equal(predictEventResult(market({ floor_strike: null }), data, prices, cutoff).result.changeUsd, null);
    assert.equal(predictEventResult(market({ strike_type: 'between', cap_strike: 4 }), data, prices, cutoff).result.changeUsd, null);
});
it('hides stale or future driver levels and keeps conditional scenarios separate from stale odds', () => {
    const { data, prices } = fixture();
    prices.set('DGS2', [{ date: '2026-09-01', close: 4 }, { date: '2099-01-01', close: 4 }]);
    assert.equal(predictEventResult(market(), data, prices, cutoff).result.changeUsd, null);
    prices.set('DGS2', [{ date: cutoff, close: 4 }]);
    const result = predictEventResult(market({ ts: new Date(Date.now() - 31 * 60000) }), data, prices, cutoff);
    assert.equal(result.market.probability, null); assert.notEqual(result.result.changeUsd, null);
});
it('identifies missing outcome mappings, strikes, prices and measurements separately', () => {
    const { data, prices } = fixture();
    const unsupported = predictEventResult(market({ series_ticker: 'KXFED' }), data, prices, cutoff);
    assert.equal(unsupported.result.unavailableReason, 'outcome-mapping');
    assert.deepEqual(unsupported.scenarioDrivers!.map(d => d.key), ['SPY', 'DGS2', 'DGS10']);
    assert.equal(predictEventResult(market({ floor_strike: null }), data, prices, cutoff).result.unavailableReason, 'missing-strike');
    prices.delete('DGS2');
    const missing = predictEventResult(market(), data, prices, cutoff);
    assert.equal(missing.result.unavailableReason, 'missing-reference');
    assert.ok(missing.result.reason!.includes('DGS2') && missing.result.reason!.includes('reloading alone'));
    const unmeasured = predictEventResult(market({ linked_symbols: ['CCC'] }), data, prices, cutoff);
    assert.equal(unmeasured.result.unavailableReason, 'no-measurement');
    assert.deepEqual(unmeasured.scenarioDrivers, []); assert.equal(unmeasured.result.changeUsd, null);
});
it('calculates unsupported event results only from explicit assumptions and reviewed linked measurements', () => {
    const { data, prices } = fixture(); const row = market({ series_ticker: 'KXFED', linked_symbols: ['AAA', 'CCC'] });
    assert.equal(predictEventResult(row, data, prices, cutoff).result.changeUsd, null);
    const result = assumedEventResult(row, data, { driver: 'DGS2', change: -.25 });
    assert.equal(result.result.basis, 'user-assumption'); assert.deepEqual(result.result.assumption, { driver: 'DGS2', change: -.25 });
    assert.equal(result.result.changeUsd, 50); assert.equal(result.result.portfolioValueAssumingOthersFlat, 3550);
    assert.equal(result.result.targetLevel, null); assert.equal(result.result.reference, null);
    assert.deepEqual(result.stocks.map(s => s.symbol), ['AAA']);
    assert.deepEqual(result.result.gainingStocks, ['AAA']); assert.equal(result.scenario!.coveredValue, 1000);
    assert.equal(result.scenarioDrivers!.find(d => d.key === 'DGS2')!.coveredValue, 1000);
    assert.ok(result.notes.some(note => note.includes('your assumption')));
});
it('keeps assumptions independent of missing references or odds and never fills an unmeasured result with zero', () => {
    const { data } = fixture();
    const result = assumedEventResult(market({ ts: null }), data, { driver: 'SPY', change: 2 });
    assert.equal(result.market.probability, null); assert.equal(result.result.changeUsd, 60);
    const unmeasured = assumedEventResult(market({ linked_symbols: ['CCC'] }), data, { driver: 'SPY', change: 2 });
    assert.equal(unmeasured.result.changeUsd, null); assert.equal(unmeasured.result.portfolioValueAssumingOthersFlat, null);
    assert.equal(unmeasured.result.unavailableReason, 'no-measurement');
    assert.throws(() => assumedEventResult(market(), data, { driver: 'SPY', change: -100 }));
    assert.throws(() => assumedEventResult(market(), data, { driver: 'DGS2', change: NaN }));
});
it('distinguishes an invalid linear shock from a valid zero-change assumption', () => {
    const { data } = fixture(), row = market({ linked_symbols: ['AAA'] });
    const invalid = assumedEventResult(row, data, { driver: 'DGS2', change: 10 });
    assert.equal(invalid.result.changeUsd, null); assert.equal(invalid.result.unavailableReason, 'scenario-range');
    assert.ok(invalid.result.reason!.includes('smaller assumption'));
    const flat = assumedEventResult(row, data, { driver: 'DGS2', change: 0 });
    assert.equal(flat.result.changeUsd, 0); assert.equal(flat.result.portfolioValueAssumingOthersFlat, data.totalValue);
    assert.equal(flat.result.reason, null); assert.equal(flat.stocks[0].direction, 'unchanged');
});
