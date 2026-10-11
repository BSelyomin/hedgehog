import { it } from 'vitest';
import assert from 'node:assert/strict';
import { groupForecastCandidates } from './forecast-groups.ts';
import { rankForecastEvents, predictEventResult, type EventCandidate } from './event-predictions.ts';
import { buildForecasts } from './forecast-model.ts';
import { assessmentRequest, checkedAssessment } from './forecast-assessment.ts';
import { contentHash } from './ai-cache.ts';

const cutoff = '2026-10-09';
function candidate(ticker: string, seriesTicker: string, closeTime = '2026-10-12T20:00:00Z'): EventCandidate {
    return { ticker, seriesTicker, closeTime, title: 'S&P odds and prices', category: 'Indices', tags: ['sp500'], linkedSymbols: ['AAA'], eventTime: closeTime, eventTimeSource: 'close' };
}
function fixture() {
    const holdings = [{ symbol: 'AAA', valueUsd: 1000 }, { symbol: 'BBB', valueUsd: 500 }];
    const prices = new Map([['SPY', [{ date: cutoff, close: 500 }]], ['^GSPC', [{ date: cutoff, close: 5000 }]]]);
    const measurements = [{ symbol: 'AAA', driver: 'SPY', b: 1.5, se: .1, low: 1.304, high: 1.696, reliable: true,
        days: 250, effect: .015, computed_at: new Date('2026-10-10'), price_through: cutoff }];
    const data = buildForecasts({ holdings, prices, measurements, cutoff, asOf: '2026-10-10T00:00:00Z' });
    const row = { ticker: 'M', event_ticker: 'E', series_ticker: 'KXINX', title: '5100 to 5200', event_title: 'S&P range', close_time: new Date('2026-10-12T20:00:00Z'),
        tags: ['sp500'], ts: new Date(), yes_bid: .6, yes_ask: .8, strike_type: 'between', floor_strike: 5100, cap_strike: 5200, linked_symbols: ['AAA'] };
    return { holdings, prices, data, row };
}
it('combines all verified S&P forms across times while preserving every dated member and other underlyings', () => {
    const groups = groupForecastCandidates([candidate('RANGE', 'KXINX'), candidate('ODDS', 'KXINXU'), candidate('UP', 'KXINXDUD'),
        candidate('LATER', 'KXINXU', '2026-10-13T20:00:00Z'), candidate('EARLIER', 'KXINXU', '2026-10-12T19:00:00Z'), candidate('OTHER', 'KXNASDAQ100')]);
    assert.equal(groups.length, 2); assert.equal(groups[0].members.length, 5);
    assert.equal(groups[0].linkedSymbols.length, 1); assert.equal(groups[0].title, 'S&P 500 index');
    assert.equal(groups[0].groupKey, 'level:SPY'); assert.equal(groups[0].ticker, 'EARLIER');
    assert.equal(groups[0].members.at(-1)!.ticker, 'LATER');
    assert.equal(new Set(groups[0].members.map(m => m.closeTime)).size, 3);
    assert.equal(groupForecastCandidates([...groups[0].members].reverse())[0].ticker, groups[0].ticker);
});
it('does not combine earnings, policy-rate and Treasury-yield events merely because their tags match', () => {
    const events = [candidate('FED', 'KXFED'), candidate('YIELD', 'KXUST2AD'), candidate('EPS', 'EARNINGS')];
    events.forEach(e => { e.tags = ['fed-rates']; e.title = 'Same topic'; });
    assert.equal(groupForecastCandidates(events).length, 3);
});
it('leaves room for other events when hundreds of S&P times are ranked before the top-20 limit', () => {
    const { data, holdings } = fixture();
    const indexEvents = Array.from({ length: 250 }, (_, i) => candidate(`SP-${i}`, 'KXINXU', new Date(Date.UTC(2026, 9, 12 + i, 20)).toISOString()));
    const otherEvents = Array.from({ length: 25 }, (_, i) => ({ ...candidate(`COMPANY-${i}`, `COMPANY-SERIES-${i}`), title: `Company result ${i}` }));
    const ranked = rankForecastEvents(groupForecastCandidates([...indexEvents, ...otherEvents]), data, holdings).slice(0, 20);
    assert.equal(ranked.length, 20); assert.equal(ranked.filter(e => e.title === 'S&P 500 index').length, 1);
    assert.equal(ranked.filter(e => e.ticker.startsWith('COMPANY-')).length, 19);
    assert.equal(ranked.find(e => e.title === 'S&P 500 index')!.dailySensitivityUsd, 15);
});
it('ranks grouped exposure once and converts index points into a measured SPY proxy return', () => {
    const { holdings, data, prices, row } = fixture();
    const group = groupForecastCandidates([candidate('E', 'KXINX'), candidate('E2', 'KXINXU')]);
    const ranked = rankForecastEvents(group, data, holdings); assert.equal(ranked[0].dailySensitivityUsd, 15); assert.equal(ranked[0].linkedValue, 1000);
    const result = predictEventResult(row, data, prices, cutoff);
    assert.equal(result.result.targetLevel, 5150); assert.equal(result.result.reference!.value, 5000);
    assert.equal(result.result.reference!.unit, 'points'); assert.equal(result.result.changeUsd, 45);
    assert.equal(result.result.portfolioValueAssumingOthersFlat, 1545); assert.equal(result.stocks[0].direction, 'up');
    assert.ok(Math.abs(result.stocks[0].returnEstimate - .045) < 1e-12);
    assert.ok(result.notes.some(n => n.includes('Proxy scenario')));
    assert.equal(result.market.probability, .7);
});
it('requires the actual index reference, never divides index strikes by the SPY ETF price', () => {
    const { data, prices, row } = fixture(); prices.delete('^GSPC');
    assert.equal(predictEventResult(row, data, prices, cutoff).result.changeUsd, null);
});
it('keeps AI identity stable for live odds/prices, and changes it for holdings, models or contract membership', () => {
    const { data, holdings, prices, row } = fixture();
    const event = rankForecastEvents(groupForecastCandidates([candidate('E', 'KXINX')]), data, holdings)[0];
    const prediction = predictEventResult(row, data, prices, cutoff);
    event.groupKey = 'level:SPY:2026-10-12'; event.outcomes = [{ ...prediction.market, result: prediction.result }];
    event.sourceEvents = [{ ticker: 'E', seriesTicker: 'KXINX', title: 'S&P range', url: 'https://kalshi.com/markets/kx/m/e' }];
    event.prices = [{ symbol: '^GSPC', value: 5000, date: cutoff, url: 'https://finance.yahoo.com/quote/%5EGSPC/history/' }];
    const original = assessmentRequest(event, data, holdings);
    const hash = contentHash(original.identity);
    event.outcomes[0].probability = .1; event.outcomes[0].result.changeUsd = 999; event.prices[0].value = 4999;
    assert.equal(contentHash(assessmentRequest(event, data, holdings).identity), hash);
    assert.equal(original.input.markets[0].result.changeUsd, 45);
    assert.equal(original.input.prices[0].value, 5000);
    const result = { selectedMarketTicker: 'M', text: 'The modeled contribution is 45 dollars.', sourceIds: ['event-0'], assumptions: [] };
    assert.ok(checkedAssessment(result, original.input, original.sources));
    assert.equal(checkedAssessment({ ...result, text: 'Guaranteed 47 dollars.' }, original.input, original.sources), null);
    assert.equal(checkedAssessment({ ...result, selectedMarketTicker: 'INVENTED' }, original.input, original.sources), null);
    assert.equal(checkedAssessment({ ...result, sourceIds: [] }, original.input, original.sources), null);
    assert.equal(checkedAssessment({ ...result, sourceIds: ['invented'] }, original.input, original.sources), null);
    assert.equal(checkedAssessment({ ...result, text: 'Read https://invented.example' }, original.input, original.sources), null);
    holdings[0].valueUsd *= 2;
    assert.notEqual(contentHash(assessmentRequest(event, data, holdings).identity), hash);
    holdings[0].valueUsd /= 2; data.drivers.find(d => d.key === 'SPY')!.holdings[0].sensitivity.b = 2;
    assert.notEqual(contentHash(assessmentRequest(event, data, holdings).identity), hash);
    data.drivers.find(d => d.key === 'SPY')!.holdings[0].sensitivity.b = 1.5;
    event.outcomes.push({ ...event.outcomes[0], ticker: 'NEW' });
    assert.notEqual(contentHash(assessmentRequest(event, data, holdings).identity), hash);
});
