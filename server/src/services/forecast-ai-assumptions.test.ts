import { it } from 'vitest';
import assert from 'node:assert/strict';
import { assessmentRequest, assessmentPredictions, checkedAssessment, checkedAvailableAssessment, checkedForecastEstimate, assessmentRejectionReasons, FORECAST_PROMPT } from './forecast-assessment.ts';
import { buildForecasts } from './forecast-model.ts';
import { rankForecastEvents, predictEventResult } from './event-predictions.ts';
import { contentHash } from './ai-cache.ts';

function fixture() {
    const cutoff = '2026-10-09';
    const holdings = [{ symbol: 'AAA', valueUsd: 1000 }, { symbol: 'BBB', valueUsd: 2000 }, { symbol: 'NOISY', valueUsd: 500 }];
    const prices = new Map([['SPY', [{ date: cutoff, close: 100 }]], ['DGS2', [{ date: cutoff, close: 4 }]]]);
    const measurements = ['AAA', 'BBB'].flatMap(symbol => ['SPY', 'DGS2'].map(driver => {
        const b = driver === 'SPY' ? 1.5 : -.2, se = .01;
        return { symbol, driver, b, se, low: b - 1.96 * se, high: b + 1.96 * se, days: 250, reliable: true,
            effect: driver === 'SPY' ? .015 : .02, price_through: cutoff, computed_at: new Date('2026-10-10') };
    }));
    const data = buildForecasts({ holdings, prices, measurements, cutoff, asOf: '2026-10-10T00:00:00Z' });
    const event = rankForecastEvents([{ ticker: 'E', seriesTicker: 'KXFED', title: 'Fed policy decision', category: 'Economics',
        tags: ['fed-rates'], linkedSymbols: ['AAA', 'BBB', 'NOISY'], closeTime: '2026-11-01', eventTime: '2026-11-01', eventTimeSource: 'close' }], data, holdings)[0];
    const row = { ticker: 'M', event_ticker: 'E', series_ticker: 'KXFED', title: 'Policy cut', event_title: 'Fed decision',
        close_time: new Date('2026-11-01'), tags: ['fed-rates'], ts: new Date(), yes_bid: .6, yes_ask: .8,
        strike_type: null, floor_strike: null, cap_strike: null, linked_symbols: ['AAA', 'NOISY'] };
    const prediction = predictEventResult(row, data, prices, cutoff);
    event.outcomes = [{ ...prediction.market, result: prediction.result, linkedSymbols: row.linked_symbols }];
    event.preferredMarketTicker = 'M';
    event.sourceEvents = [{ ticker: 'E', title: 'Fed decision', seriesTicker: 'KXFED', url: 'https://kalshi.com/markets/kx/m/e' }];
    const request = assessmentRequest(event, data, holdings);
    const result = { selectedMarketTicker: 'M', text: 'A modest yield fall is a tentative assumption. The reaction is uncertain.', sourceIds: ['event-0'],
        assumptions: [{ marketTicker: 'M', driver: 'DGS2', change: -.25, confidence: 62 }] };
    return { data, event, request, result, holdings };
}
it('asks Snowflake to do its best and supplies driver units, measured move sizes and allowed choices', () => {
    const { request } = fixture();
    assert.ok(FORECAST_PROMPT.includes('Do your best') && FORECAST_PROMPT.includes('Do not stop'));
    assert.ok(FORECAST_PROMPT.includes('not a calibrated probability'));
    assert.deepEqual(request.input.markets[0].allowedDrivers, ['SPY', 'DGS2']);
    assert.equal(request.input.drivers.find(d => d.key === 'SPY')!.typicalDailyChange, 1);
    assert.equal(request.input.drivers.find(d => d.key === 'DGS2')!.unit, 'percentage-points');
});
it('validates generated assumptions and self-ratings, then calculates dollar effects using reviewed measured stocks only', () => {
    const { request, result, event, data } = fixture();
    const checked = checkedAssessment(result, request.input, request.sources)!; assert.ok(checked);
    const predicted = assessmentPredictions(event, data, checked.assumptions)[0];
    assert.equal(predicted.result.confidence, 62); assert.equal(predicted.result.basis, 'ai-assumption');
    assert.equal(predicted.result.changeUsd, 50); assert.equal(predicted.result.portfolioValueAssumingOthersFlat, 3550);
    assert.deepEqual(predicted.stocks.map(s => s.symbol), ['AAA']); assert.equal(predicted.scenario!.coveredValue, 1000);
    assert.equal(predicted.market.probability, .7); assert.notEqual(predicted.result.confidence, predicted.market.probability);
    assert.equal(predicted.result.reason, null);
});
it('rejects invented drivers, markets, confidence ranges, types, duplicate assumptions and invalid linear shocks', () => {
    const { request, result } = fixture();
    for (const changes of [{ driver: 'AAPL' }, { marketTicker: 'FOREIGN' }, { confidence: -1 }, { confidence: 101 },
        { confidence: '62' }, { confidence: 62.5 }, { change: '0.25' }, { change: NaN }, { change: Infinity },
        { driver: 'SPY', change: -100 }, { driver: 'DGS2', change: 10 }, { stockChange: 100 }]) {
        assert.equal(checkedAssessment({ ...result, assumptions: [{ ...result.assumptions[0], ...changes }] }, request.input, request.sources), null, JSON.stringify(changes));
    }
    assert.equal(checkedAssessment({ ...result, assumptions: [result.assumptions[0], result.assumptions[0]] }, request.input, request.sources), null);
    assert.equal(checkedAssessment({ ...result, assumptions: [] }, request.input, request.sources), null);
    assert.equal(checkedAssessment({ ...result, stockChange: 100 }, request.input, request.sources), null);
});
it('retains source and number checks while permitting the explicitly authorized assumption numbers', () => {
    const { request, result } = fixture();
    assert.ok(checkedAssessment({ ...result, text: 'Assuming -0.25 yield points; self-rated confidence 62.' }, request.input, request.sources));
    assert.equal(checkedAssessment({ ...result, text: 'This guarantees 999999 dollars.' }, request.input, request.sources), null);
    assert.equal(checkedAssessment({ ...result, sourceIds: [] }, request.input, request.sources), null);
    assert.equal(checkedAssessment({ ...result, sourceIds: ['invented'] }, request.input, request.sources), null);
    assert.equal(checkedAssessment({ ...result, text: 'Source https://invented.example' }, request.input, request.sources), null);
    assert.equal(checkedAssessment({ ...result, text: 'A'.repeat(3001) }, request.input, request.sources), null);
});
it('never overrides a supported result or fabricates coefficients when a stock is unmeasured', () => {
    const { request, result } = fixture();
    request.input.markets[0].result.changeUsd = 20;
    assert.equal(checkedAssessment(result, request.input, request.sources), null);
    assert.ok(checkedAssessment({ ...result, assumptions: [] }, request.input, request.sources));
    request.input.markets[0].result.changeUsd = null; request.input.markets[0].allowedDrivers = [];
    assert.equal(checkedAssessment(result, request.input, request.sources), null);
    assert.ok(checkedAssessment({ ...result, assumptions: [] }, request.input, request.sources));
});
it('keeps assumptions cached on quote changes but invalidates on any usable driver model or reviewed stock-scope change', () => {
    const { event, data, holdings } = fixture();
    const hash = contentHash(assessmentRequest(event, data, holdings).identity);
    event.outcomes[0].probability = .3;
    assert.equal(contentHash(assessmentRequest(event, data, holdings).identity), hash);
    data.drivers.find(d => d.key === 'SPY')!.holdings[0].sensitivity.b = 2;
    assert.notEqual(contentHash(assessmentRequest(event, data, holdings).identity), hash);
    data.drivers.find(d => d.key === 'SPY')!.holdings[0].sensitivity.b = 1.5;
    event.outcomes[0].linkedSymbols = ['BBB'];
    assert.notEqual(contentHash(assessmentRequest(event, data, holdings).identity), hash);
});

it('retains valid non-index estimates when another contract is missing or invalid, without admitting its numbers', () => {
    const { request, result } = fixture();
    request.input.markets.push({ ...request.input.markets[0], marketTicker: 'OTHER' });
    const response = { ...result, selectedMarketTicker: 'OTHER', assumptions: [result.assumptions[0],
        { ...result.assumptions[0], marketTicker: 'OTHER', confidence: 120 }] };
    assert.equal(checkedAssessment(response, request.input, request.sources), null);
    const partial = checkedAvailableAssessment(response, request.input, request.sources)!;
    assert.ok(partial); assert.equal(partial.partial, true); assert.equal(partial.selectedMarketTicker, 'M');
    assert.deepEqual(partial.assumptions, result.assumptions);
    assert.ok(checkedAvailableAssessment({ ...response, assumptions: result.assumptions }, request.input, request.sources));
    assert.equal(checkedAvailableAssessment({ ...response, text: 'Confidence is 120.' }, request.input, request.sources), null);
    assert.equal(checkedAvailableAssessment({ ...response, sourceIds: ['invented'] }, request.input, request.sources), null);
    assert.equal(checkedAvailableAssessment({ ...response, assumptions: [response.assumptions[1]] }, request.input, request.sources), null);
});

it('bounds generated assumptions while retaining the full non-index family for joint context', () => {
    const { event, data, holdings } = fixture();
    event.outcomes = Array.from({ length: 200 }, (_, i) => ({ ...event.outcomes[0], ticker: `MARKET-${i}` }));
    const request = assessmentRequest(event, data, holdings);
    assert.equal(request.input.markets.length, 8); assert.equal(request.input.contracts.length, 200);
});

it('diagnoses citation, unsupported prose, driver and confidence failures without disclosing rejected values', () => {
    const { request, result } = fixture();
    assert.deepEqual(assessmentRejectionReasons({ ...result, sourceIds: ['private-invalid-source'] }, request.input, request.sources), ['missing_or_unknown_source_ids']);
    assert.deepEqual(assessmentRejectionReasons({ ...result, text: 'Unjustified estimate of 999999.' }, request.input, request.sources), ['unsupported_summary_number']);
    const invalid = { ...result, assumptions: [{ ...result.assumptions[0], driver: 'private-invalid-driver', confidence: 101 }] };
    const reasons = assessmentRejectionReasons(invalid, request.input, request.sources);
    assert.ok(reasons.includes('assumption_driver_not_allowed') && reasons.includes('invalid_assumption_confidence'));
    assert.ok(!JSON.stringify(reasons).includes('private-invalid-driver'));
    assert.equal(checkedAvailableAssessment(invalid, request.input, request.sources), null);
    assert.equal(checkedAvailableAssessment({ ...result, text: 'Unjustified estimate of 999999.' }, request.input, request.sources), null);
});

it('hides unsupported explanation numbers while preserving independently validated estimates and measured stock effects', () => {
    const { request, result, event, data } = fixture();
    for (const text of ['Yield falls by 25 basis points.', 'This guarantees a gain of 999999 dollars.']) {
        const response = { ...result, text };
        assert.equal(checkedAvailableAssessment(response, request.input, request.sources), null);
        const checked = checkedForecastEstimate(response, request.input, request.sources)!;
        assert.ok(checked); assert.equal(checked.explanationStatus, 'hidden'); assert.equal(checked.summary, null);
        assert.ok(checked.explanationReason!.includes('unsupported_summary_number'));
        assert.equal(assessmentPredictions(event, data, checked.assumptions)[0].result.changeUsd, 50);
    }
    assert.equal(checkedForecastEstimate({ ...result, text: 'Guarantee of 999999 dollars.', assumptions: [{ ...result.assumptions[0], confidence: 120 }] }, request.input, request.sources), null);
    const noSources = checkedForecastEstimate({ ...result, sourceIds: ['invented'] }, request.input, request.sources)!;
    assert.equal(noSources.summary, null); assert.equal(noSources.explanationStatus, 'hidden');
});
