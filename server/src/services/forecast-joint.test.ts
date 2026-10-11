import { it } from 'vitest';
import assert from 'node:assert/strict';
import { groupForecastCandidates, forecastFormat } from './forecast-groups.ts';
import { buildForecasts } from './forecast-model.ts';
import { rankForecastEvents, predictEventResult, type EventCandidate } from './event-predictions.ts';
import { assessmentRequest, checkedAssessment, checkedAvailableAssessment, jointForecastPrediction, FORECAST_INSTRUCTIONS } from './forecast-assessment.ts';
import { representativeOutcomes } from './forecast-context.ts';
import { contentHash } from './ai-cache.ts';

function candidate(ticker: string, title: string, seriesTicker = 'PRICE-FORMAT', closeTime = '2026-10-12T14:00:00Z'): EventCandidate {
    return { ticker, title, seriesTicker, closeTime, eventTime: closeTime, eventTimeSource: 'close', category: 'Indices',
        tags: ['sp500'], linkedSymbols: ['AAA', 'UNMEASURED'] };
}
function fixture(count = 4) {
    const cutoff = '2026-10-09', asOf = '2026-10-10T00:00:00Z';
    const holdings = [{ symbol: 'AAA', valueUsd: 1000 }, { symbol: 'UNMEASURED', valueUsd: 500 }];
    const prices = new Map([['SPY', [{ date: cutoff, close: 700 }]], ['^GSPC', [{ date: cutoff, close: 7000 }]]]);
    const data = buildForecasts({ holdings, prices, cutoff, asOf, measurements: [{ symbol: 'AAA', driver: 'SPY', b: 1.5,
        se: .1, low: 1.304, high: 1.696, days: 250, reliable: true, effect: .015, computed_at: new Date(asOf), price_through: cutoff }] });
    const group = groupForecastCandidates([candidate('TEN', 'S&P 500 price at 10 AM', 'KXINXU'),
        candidate('ELEVEN', 'S&P 500 price at 11 AM', 'KXINX', '2026-10-12T15:00:00Z')])[0];
    const event = rankForecastEvents([group], data, holdings)[0]; event.groupKey = group.groupKey;
    event.sourceEvents = group.members.map(m => ({ ticker: m.ticker, seriesTicker: m.seriesTicker, title: m.title, url: `https://kalshi.com/markets/kx/m/${m.ticker.toLowerCase()}` }));
    event.outcomes = Array.from({ length: count }, (_, i) => {
        const hour = i % 2 ? '15' : '14', floor = i % 3 ? 7500 : 7000, eventTicker = i % 2 ? 'ELEVEN' : 'TEN';
        const source = predictEventResult({ ticker: `M-${i}`, event_ticker: eventTicker, series_ticker: 'KXINXU',
            event_title: 'S&P price', title: `Above ${floor}`, close_time: new Date(`2026-10-12T${hour}:00:00Z`),
            ts: new Date(), yes_bid: i % 3 ? .2 : .6, yes_ask: i % 3 ? .4 : .8,
            strike_type: 'greater', floor_strike: floor, cap_strike: null, linked_symbols: ['AAA', 'UNMEASURED'], tags: ['sp500'] }, data, prices, cutoff);
        return { ...source.market, result: source.result, linkedSymbols: ['AAA', 'UNMEASURED'], seriesTicker: 'KXINXU',
            strike: { type: 'greater', floor, cap: null } };
    });
    const request = assessmentRequest(event, data, holdings);
    const result = { selectedMarketTicker: request.input.markets[0].marketTicker, text: 'The earlier and later price targets support a tentative market rise. Overlapping contracts provide limited independent evidence.',
        sourceIds: ['event-0', 'event-1'], assumptions: [], jointForecasts: [{ driver: 'SPY', change: 1, confidence: 48,
            horizonMarketTicker: request.input.jointContext.horizonMarketTicker!, evidenceMarketTickers: request.input.contracts.map(m => m.marketTicker) }] };
    return { data, holdings, event, request, result };
}

it('groups S&P price formats across series, times and numeric targets without granting a verified driver mapping', () => {
    const groups = groupForecastCandidates([candidate('A', 'S&P 500 above 7000 at 10 AM', 'OTHER-SP-FORM'),
        candidate('B', 'S and P 500 above 7500 at 11 AM', 'ANOTHER-SP-FORM', '2026-10-12T15:00:00Z'),
        candidate('C', 'S&P 500 range on October 13, 2026', 'KXINX')]);
    assert.equal(groups.length, 1); assert.equal(groups[0].members.length, 3); assert.equal(groups[0].groupKey, 'level:SPY');
    const separate = groupForecastCandidates([candidate('A', 'S&P 500 above 7000'), candidate('B', 'Will AAA join the S&P 500?'),
        candidate('C', 'Will S&P 500 be mentioned on an earnings call?'), candidate('D', 'Nasdaq above 7000')]);
    assert.equal(separate.length, 4);
});
it('groups repeated formats across dates/thresholds but keeps companies, metrics and Treasury tenors separate', () => {
    const rows = [candidate('A', 'Bitcoin above $70,000 on October 12, 2026 at 10 AM'),
        candidate('B', 'Bitcoin above $75,000 on October 13, 2026 at 11 AM', 'PRICE-FORMAT', '2026-10-13T15:00:00Z'),
        candidate('C', 'Ethereum above $70,000 on October 12, 2026 at 10 AM'),
        candidate('D', 'Bitcoin trading volume above $70,000 on October 12, 2026 at 10 AM'),
        candidate('E', '2-year Treasury yield above 4%'), candidate('F', '10-year Treasury yield above 4%')];
    const groups = groupForecastCandidates(rows);
    assert.equal(groups.length, 5); assert.deepEqual(groups[0].members.map(m => m.ticker), ['A', 'B']);
    assert.notEqual(forecastFormat(rows[4].title), forecastFormat(rows[5].title));
});
it('keeps numeric index identities and the S&P Global company distinct from S&P 500 level events', () => {
    const groups = groupForecastCandidates([candidate('SP', 'S&P 500 above 7000'), candidate('MID', 'S&P 400 above 7000'),
        candidate('SMALL', 'S&P 600 above 7000'), candidate('GLOBAL', 'S&P Global stock price above $500'),
        candidate('NDX', 'Nasdaq 100 above 7000'), candidate('OTHER-NDX', 'Nasdaq 50 above 7500')]);
    assert.equal(groups.length, 6); assert.equal(groups.filter(g => g.groupKey === 'level:SPY').length, 1);
});
it('sends every target/time as joint context and samples individual assumptions across horizons', () => {
    const { event, request } = fixture(200);
    assert.equal(request.input.contracts.length, 200); assert.equal(request.input.markets.length, 48);
    assert.equal(new Set(request.input.markets.map(m => m.closeTime)).size, 2);
    assert.deepEqual([...new Set(request.input.contracts.map(m => m.strike!.floor))].sort(), [7000, 7500]);
    assert.equal(request.input.jointContext.required, true, JSON.stringify({ context: request.input.jointContext, drivers: request.input.drivers, first: request.input.contracts[0] }));
    assert.ok(FORECAST_INSTRUCTIONS.includes('Evaluate ALL contracts') && FORECAST_INSTRUCTIONS.includes('do not automatically mean higher confidence'));
    event.outcomes.forEach((m, i) => { m.closeTime = new Date(Date.UTC(2026, 9, 12 + i)).toISOString(); });
    const sampled = representativeOutcomes(event);
    assert.equal(sampled.length, 48); assert.ok(sampled.includes(event.outcomes[0]) && sampled.includes(event.outcomes.at(-1)!));
});
it('computes one joint portfolio forecast from measured sensitivities, without summing contract effects or replacing them', () => {
    const { data, event, request, result } = fixture();
    const original = structuredClone(event.outcomes);
    const checked = checkedAssessment(result, request.input, request.sources)!; assert.ok(checked);
    const predicted = jointForecastPrediction(event, data, checked.jointAssumption)!;
    assert.equal(predicted.result.changeUsd, 15); assert.equal(predicted.result.portfolioValueAssumingOthersFlat, 1515);
    assert.equal(predicted.result.confidence, 48); assert.equal(predicted.contextContracts, 4); assert.equal(predicted.contextTimes, 2);
    assert.equal(predicted.horizon.closeTime, '2026-10-12T14:00:00.000Z');
    assert.deepEqual(predicted.stocks.map(s => s.symbol), ['AAA']); assert.equal(predicted.stocks[0].direction, 'up');
    assert.deepEqual(event.outcomes, original);
    assert.ok(predicted.notes.some(n => n.includes('not a cumulative forecast')));
    assert.ok(!('probability' in predicted));
});
it('rejects missing joint output, unsupported horizons, invented evidence and invalid joint confidence/shocks', () => {
    const { request, result } = fixture(), joint = result.jointForecasts[0];
    for (const changes of [{ horizonMarketTicker: 'M-1' }, { driver: 'INVENTED' }, { change: NaN }, { change: '1' },
        { change: -100 }, { confidence: 101 }, { confidence: 50.5 }, { confidence: '48' },
        { evidenceMarketTickers: ['M-0', 'INVENTED'] }, { evidenceMarketTickers: ['M-0', 'M-0'] },
        { evidenceMarketTickers: ['M-1', 'M-3'] }, { probability: .8 }]) {
        assert.equal(checkedAssessment({ ...result, jointForecasts: [{ ...joint, ...changes }] }, request.input, request.sources), null, JSON.stringify(changes));
    }
    assert.equal(checkedAssessment({ ...result, jointForecasts: [] }, request.input, request.sources), null);
    assert.equal(checkedAssessment({ ...result, jointForecasts: [joint, joint] }, request.input, request.sources), null);
    request.input.contracts.find(m => m.marketTicker === 'M-1')!.probabilityPoints = null;
    assert.equal(checkedAssessment(result, request.input, request.sources), null);
});
it('requires common reviewed measured holdings and multiple quotes before allowing a joint estimate', () => {
    const { event, data, holdings, result } = fixture();
    event.outcomes[1].linkedSymbols = ['OTHER'];
    const request = assessmentRequest(event, data, holdings);
    assert.equal(request.input.jointContext.required, false);
    assert.equal(checkedAssessment(result, request.input, request.sources), null);
    assert.ok(checkedAssessment({ ...result, jointForecasts: [] }, request.input, request.sources));
    event.outcomes.forEach((m, i) => { m.linkedSymbols = ['AAA']; if (i) m.probability = null; });
    assert.equal(assessmentRequest(event, data, holdings).input.jointContext.required, false);
});
it('keeps joint AI caching stable on quote changes but invalidates altered contract terms/times', () => {
    const { event, data, holdings } = fixture();
    const hash = contentHash(assessmentRequest(event, data, holdings).identity);
    event.outcomes.forEach(m => { m.probability = .1; m.spread = .09; m.result.changeUsd = 999; });
    assert.equal(contentHash(assessmentRequest(event, data, holdings).identity), hash);
    event.outcomes[0].closeTime = '2026-10-12T16:00:00Z';
    assert.notEqual(contentHash(assessmentRequest(event, data, holdings).identity), hash);
    event.outcomes[0].closeTime = '2026-10-12T14:00:00.000Z'; event.outcomes[0].strike!.floor = 7100;
    assert.notEqual(contentHash(assessmentRequest(event, data, holdings).identity), hash);
});

it('retains a valid combined estimate when individual output is invalid, while rejecting invalid combined-only output', () => {
    const { request, result } = fixture();
    const malformed = { ...result, assumptions: [{ marketTicker: 'INVENTED', driver: 'SPY', change: 1, confidence: 60 }] };
    const partial = checkedAvailableAssessment(malformed, request.input, request.sources)!;
    assert.ok(partial); assert.equal(partial.partial, true); assert.deepEqual(partial.assumptions, []);
    assert.equal(partial.jointAssumption!.confidence, 48);
    assert.equal(checkedAvailableAssessment({ ...malformed, jointForecasts: [{ ...result.jointForecasts[0], confidence: 120 }] }, request.input, request.sources), null);
});
