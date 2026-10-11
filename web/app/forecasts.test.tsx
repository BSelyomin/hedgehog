import { it } from 'vitest';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Forecasts, ForecastsContent, ScenarioResult, EventForecastResult, PortfolioResult, ForecastTable, OutcomeTable, AssessmentContent, ResultChange, ResultAssumption, assessedEvent, ResultEstimate, GroupPrediction } from './screens/forecasts';
import { buildForecasts } from '../../server/src/services/forecast-model';
import { rankForecastEvents, predictEventResult, assumedEventResult } from '../../server/src/services/event-predictions';
import { jointForecastPrediction } from '../../server/src/services/forecast-assessment';
import type { ForecastsResponse, ScenarioForecast, EventForecastResponse, RankedForecastEvent, ForecastAssessmentResponse } from '../../shared/types';

const data: ForecastsResponse = {
    asOf: '2026-10-10T02:00:00Z', totalValue: 1500,
    baseline: { horizon: 'next-trading-day', method: 'no-change', priceDate: '2026-10-09', coveredValue: 1000,
        predictedValue: 1000, changeUsd: 0, estimated80Range: { low: 990, high: 1010 }, observations: 180,
        validation: { days: 60, rmseUsd: 10, noChangeRmseUsd: 10 }, notes: ['Future coverage is unverified.'],
        excluded: [{ symbol: 'CASH', valueUsd: 500, reason: 'No daily price history.' }] },
    drivers: [{ key: 'SPY', label: 'Stock market (SPY)', unit: 'percent', coveredValue: 1000, holdings: [], historicalChangeRange: null, excluded: [] }]
};
const scenario: ScenarioForecast = { driver: 'SPY', change: 2, coveredValue: 1000, predictedValue: 1030, changeUsd: 30,
    sensitivityBounds: { low: 1026, high: 1034 }, holdings: [], excluded: data.baseline.excluded, notes: [], asOf: data.asOf };

it('renders the Forecasts page with reload and without fabricated values while loading', () => {
    const html = renderToStaticMarkup(<Forecasts/>);
    assert.ok(html.includes('<h1>Forecasts</h1>') && html.includes('>Reload</button>'));
    assert.ok(html.includes('Loading your data'));
    assert.ok(!html.includes('$1,000') && !html.includes('Historical event cards'));
    assert.ok(html.includes('Additional forecast tools') && !html.includes('Calculate scenario'));
});
it('paginates forecast families in tens with continuous ranks, a partial final page and bounds after data shrinks', () => {
    const events: RankedForecastEvent[] = Array.from({ length: 23 }, (_, index) => ({
        ticker: `GROUP${index + 1}`, title: `Forecast family ${index + 1}`, category: 'Economics',
        eventTime: '2026-11-01', eventTimeSource: 'close', closeTime: '2026-11-01',
        linkedValue: 1000, share: 1, dailySensitivityUsd: null, driver: null, driverLabel: null,
        measuredSymbols: [], unmeasuredSymbols: ['AAA'], preferredMarketTicker: null, outcomes: []
    }));
    const render = (page: number, rows = events) => renderToStaticMarkup(<ForecastTable events={rows} expanded={[]}
        onToggle={() => {}} page={page} onPageChange={() => {}}/>);
    const first = render(1), second = render(2), last = render(3);
    assert.equal((first.match(/scope="row"/g) ?? []).length, 10);
    assert.ok(first.includes('Showing 1–10 of 23 forecast groups') && !first.includes('Forecast family 11<'));
    assert.ok(first.includes('disabled="">Previous</button>') && !first.includes('disabled="">Next</button>'));
    assert.equal((second.match(/scope="row"/g) ?? []).length, 10);
    assert.ok(second.includes('Showing 11–20 of 23 forecast groups') && second.includes('mono">11. </span>Forecast family 11'));
    assert.ok(!second.includes('Forecast family 10<') && !second.includes('Forecast family 21<'));
    assert.equal((last.match(/scope="row"/g) ?? []).length, 3);
    assert.ok(last.includes('Showing 21–23 of 23 forecast groups') && last.includes('disabled="">Next</button>'));
    assert.ok(last.includes('aria-label="Forecast page"') && last.includes('value="3" selected=""'));
    const shrunk = render(3, events.slice(0, 4));
    assert.ok(shrunk.includes('Showing 1–4 of 4 forecast groups'));
    assert.equal((shrunk.match(/scope="row"/g) ?? []).length, 4);
    assert.ok(shrunk.includes('disabled="">Previous</button>') && shrunk.includes('disabled="">Next</button>'));
    assert.ok(!render(1, []).includes('aria-label="Forecast pages"'));
});
it('shows ranked measured exposure, result-specific directions and the partial-portfolio assumption', () => {
    const cutoff = '2026-10-09', holdings = [{ symbol: 'AAA', valueUsd: 1000 }, { symbol: 'BBB', valueUsd: 2000 }, { symbol: 'CASH', valueUsd: 500, assetType: 'cash' as const }];
    const prices = new Map([['SPY', [{ date: cutoff, close: 100 }]], ['DGS2', [{ date: cutoff, close: 4 }]]]);
    const models = buildForecasts({ holdings, prices, cutoff, asOf: data.asOf,
        measurements: ['AAA', 'BBB'].map(symbol => { const b = symbol === 'AAA' ? -.2 : .1; return { symbol, driver: 'DGS2', b, se: .01,
            low: b - .0196, high: b + .0196, days: 250, effect: .02, reliable: true, computed_at: new Date(data.asOf!), price_through: cutoff }; }) });
    const ranked = rankForecastEvents([{ ticker: 'E', seriesTicker: 'KXUST2AD', title: 'Treasury yield', category: 'Economics',
        tags: ['fed-rates'], linkedSymbols: ['AAA', 'BBB'], eventTime: '2026-11-01', eventTimeSource: 'close', closeTime: '2026-11-01' }], models, holdings);
    const list = renderToStaticMarkup(<ForecastTable events={ranked} expanded={['E']} onToggle={() => {}}/>);
    assert.ok(list.includes('aria-expanded="true"') && list.includes('Daily sensitivity') && list.includes('$60.00'));
    assert.ok(list.includes('<table') && !list.includes('forecast-ranked-list'));
    const result = predictEventResult({ ticker: 'M', event_ticker: 'E', series_ticker: 'KXUST2AD', title: 'Above 4.25%', event_title: 'Treasury yield',
        close_time: new Date('2026-11-01'), tags: ['fed-rates'], ts: new Date(), yes_bid: .6, yes_ask: .8,
        strike_type: 'greater', floor_strike: 4.25, cap_strike: null, linked_symbols: ['AAA', 'BBB'] }, models, prices, cutoff);
    const html = renderToStaticMarkup(<PortfolioResult result={result}/>);
    for (const label of ['Conditional measured estimate', 'market boundary', 'Stocks estimated to rise', 'Stocks estimated to fall',
        '↑ Up', '↓ Down', '$950.00', '$2,050.00', '$3,500.00', 'Other holdings stay', 'FRED source', '250 observations', 'not prediction intervals']) assert.ok(html.includes(label), label);
    const unsupported = predictEventResult({ ticker: 'M', event_ticker: 'E', series_ticker: 'KXFED', title: 'Rate cut', event_title: 'Fed',
        close_time: new Date('2026-11-01'), tags: ['fed-rates'], ts: null, yes_bid: null, yes_ask: null,
        strike_type: null, floor_strike: null, cap_strike: null, linked_symbols: ['AAA'] }, models, prices, cutoff);
    const empty = renderToStaticMarkup(<PortfolioResult result={unsupported}/>);
    assert.ok(empty.includes('cannot establish whether a stock goes up or down') && !empty.includes('↑ Up'));
});
it('labels the forecast horizon, uncertainty, validation, exclusions and explicit scenario assumptions', () => {
    const html = renderToStaticMarkup(<ForecastsContent data={data} markets={[]}/>);
    for (const label of ['Next trading-day value forecast', 'Estimated 80% value range', 'Independent validation',
        'Excluded holdings', 'No daily price history.', 'Calculate scenario', 'Assumed change', 'No linked open markets']) assert.ok(html.includes(label), label);
    assert.ok(html.includes('value=""') && html.includes('required=""'));
    assert.ok(!html.includes('Past reports') && !html.includes('Sample data'));
});
it('provides accessible event inputs and keeps probability separate from value forecasts', () => {
    const html = renderToStaticMarkup(<ForecastsContent data={data} markets={[{
        ticker: 'M', eventTicker: 'E', title: 'Outcome', eventTitle: 'Event', closeTime: '2026-11-01',
        probability: .8, spread: .02, drivers: ['SPY'], probabilityNote: 'Kalshi bid–ask midpoint.', asOf: data.asOf
    }]}/>);
    for (const label of ['id="forecast-market"', 'id="event-yes"', 'id="event-no"', '80.0%', 'Kalshi bid–ask midpoint',
        'remaining driver change', 'expectations already priced in']) assert.ok(html.includes(label), label);
});
it('shows coefficient bounds without representing them as prediction intervals', () => {
    const html = renderToStaticMarkup(<ScenarioResult result={scenario}/>);
    assert.ok(html.includes('$1,030.00') && html.includes('not a prediction interval'));
    assert.ok(html.includes('future moves are unknown'));
    assert.ok(renderToStaticMarkup(<ScenarioResult result={{ ...scenario, predictedValue: null, changeUsd: null }}/>).includes('Unavailable'));
});

it('displays measured calculation inputs and source evidence instead of the example-scenario label', () => {
    const html = renderToStaticMarkup(<ResultChange result={{ marketTicker: 'M', label: 'At the stored boundary', driver: 'DGS2',
        targetLevel: 4.25, reference: null, coveredValue: 1000, changeUsd: -50, portfolioValueAssumingOthersFlat: 950,
        gainingStocks: [], losingStocks: ['AAA'], reason: null, basis: 'market-level', evidence: { driver: 'DGS2', change: .25,
            unit: 'percentage-points', observations: 250, measuredAt: '2026-10-10T02:00:00Z', referenceUrl: 'https://fred.stlouisfed.org/series/DGS2' } }}/>);
    for (const text of ['measured sensitivity', '0.250 percentage points', '250 aligned observations', 'Reference price source']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('Example scenario'));
});

it('shows validated estimates and sources when AI prose is hidden, with retries available only as an explicit button', () => {
    const result = { marketTicker: 'M', label: 'Snowflake assumes SPY changes 2%', driver: 'SPY', targetLevel: null,
        reference: null, coveredValue: 1000, changeUsd: 30, portfolioValueAssumingOthersFlat: 1030,
        gainingStocks: ['AAA'], losingStocks: [], reason: null, basis: 'ai-assumption' as const, confidence: 55 };
    const event: RankedForecastEvent = { ticker: 'E', title: 'Annual Return: S&P 500 Total Return Vs. BTC?', category: 'Financials',
        eventTime: '2026-11-01', eventTimeSource: 'close', closeTime: '2026-11-01', linkedValue: 1000, share: 1,
        dailySensitivityUsd: 15, driver: 'SPY', driverLabel: 'SPY', measuredSymbols: ['AAA'], unmeasuredSymbols: [],
        preferredMarketTicker: 'M', sourceEvents: [{ ticker: 'E', title: 'Market rules', seriesTicker: 'TEST', url: 'https://kalshi.com/markets/test' }],
        outcomes: [{ ticker: 'M', eventTicker: 'E', title: 'Annual result', eventTitle: 'Annual return', closeTime: '2026-11-01',
            probability: .7, spread: .02, drivers: ['SPY'], probabilityNote: 'Bid–ask midpoint', asOf: data.asOf, result }] };
    const ready: ForecastAssessmentResponse = { status: 'ready', selectedMarketTicker: 'M', summary: null,
        generatedAt: data.asOf, asOf: data.asOf, explanationStatus: 'hidden', reason: 'AI explanation hidden (unsupported_summary_number).' };
    const html = renderToStaticMarkup(<AssessmentContent data={ready} event={event} onSelect={() => {}}/>);
    assert.ok(html.includes('$30.00') && html.includes('AI confidence: 55%') && html.includes('Market rules'));
    assert.ok(!html.includes('AI estimate unavailable') && !html.includes('999999'));
    const failed = { ...ready, status: 'unavailable' as const };
    const table = renderToStaticMarkup(<ForecastTable events={[event]} expanded={[]} onToggle={() => {}} onRetry={async () => {}} assessments={{ assessments: [{ eventTicker: 'E', assessment: failed }], asOf: data.asOf }}/>);
    assert.ok(table.includes('Retry estimate'));
    assert.ok(table.includes('<details class="forecast-disclosure"><summary>'));
    assert.ok(!table.includes('<details class="forecast-disclosure" open'));
    const readyTable = renderToStaticMarkup(<ForecastTable events={[event]} expanded={[]} onToggle={() => {}} assessments={{ assessments: [{ eventTicker: 'E', assessment: ready }], asOf: data.asOf }}/>);
    const compact = readyTable.match(/<details class="forecast-disclosure"><summary>([\s\S]*?)<\/summary>/)?.[1];
    assert.ok(compact);
    assert.ok(compact.includes('$30.00') && compact.includes('AI estimate') && compact.includes('Forecast details'));
    assert.ok(!compact.includes('AI confidence') && !compact.includes('unsupported_summary_number'));
    assert.ok(readyTable.indexOf('AI confidence: 55%') > readyTable.indexOf('</summary>'));
    assert.equal((readyTable.match(/class="forecast-column-help"/g) ?? []).length, 7);
    for (const label of ['Event family', 'Market closes', 'Daily sensitivity', 'Portfolio linked', 'Selected result odds', 'Portfolio forecast', 'Details']) {
        assert.ok(readyTable.includes(`aria-label="${label}: explanation"`));
    }
});
it('labels event values as conditional and displays the two outcome scenarios separately', () => {
    const result: EventForecastResponse = {
        market: { ticker: 'M', eventTicker: 'E', title: 'Outcome', eventTitle: 'Event', closeTime: '2026-11-01', probability: .8,
            spread: .02, drivers: ['SPY'], probabilityNote: 'Bid–ask midpoint', asOf: data.asOf },
        yes: scenario, no: { ...scenario, change: -2, predictedValue: 970, changeUsd: -30 }, expectedValue: 1018,
        expectedChangeUsd: 18, notes: ['Your outcome assumptions determine the price effect.'], asOf: data.asOf
    };
    const html = renderToStaticMarkup(<EventForecastResult result={result}/>);
    for (const label of ['Conditional on your assumptions', 'Probability-weighted covered value', '$1,018.00', 'If yes', 'If no',
        '$1,030.00', '$970.00', 'Your outcome assumptions']) assert.ok(html.includes(label), label);
});
it('shows one combined assessment with live sourced odds/change, source links and dated AI cache', () => {
    const event: RankedForecastEvent = { ticker: 'E', title: 'S&P 500 closing level', category: 'Indices', eventTime: '2026-10-12T20:00:00Z', eventTimeSource: 'close', closeTime: '2026-10-12T20:00:00Z',
        linkedValue: 1000, share: 1, dailySensitivityUsd: 15, driver: 'SPY', driverLabel: 'SPY', measuredSymbols: ['AAA'], unmeasuredSymbols: [], preferredMarketTicker: 'M',
        sourceEvents: [{ ticker: 'E', title: 'Range', seriesTicker: 'KXINX', url: 'https://kalshi.com/markets/kx/m/e' }, { ticker: 'E2', title: 'Threshold', seriesTicker: 'KXINXU', url: 'https://kalshi.com/markets/kx/m/e2' }],
        outcomes: [{ ticker: 'M', eventTicker: 'E', title: '5100 to 5200', eventTitle: 'Range', closeTime: '2026-10-12T20:00:00Z', probability: .7, spread: .02, drivers: ['SPY'], probabilityNote: 'Bid–ask midpoint', asOf: data.asOf,
            result: { marketTicker: 'M', label: 'At 5150 index points (midpoint of the result range)', driver: 'SPY', targetLevel: 5150, reference: null, coveredValue: 1000,
                changeUsd: 45, portfolioValueAssumingOthersFlat: 1045, gainingStocks: ['AAA'], losingStocks: [], reason: null } }] };
    const assessment: ForecastAssessmentResponse = { status: 'ready', selectedMarketTicker: 'M', summary: { text: 'A measured proxy scenario.', sources: [{ title: 'Range source', url: 'https://kalshi.com/markets/kx/m/e' }] }, generatedAt: data.asOf, reason: null, asOf: data.asOf };
    const html = renderToStaticMarkup(<AssessmentContent data={assessment} event={event} onSelect={() => {}}/>);
    for (const label of ['70.0%', '$45.00', 'View assessed result', 'Cached assessment', 'update separately', 'Range source', 'midpoint of the result range']) assert.ok(html.includes(label), label);
    const list = renderToStaticMarkup(<ForecastTable events={[event]} expanded={[]} onToggle={() => {}}/>);
    assert.ok(list.includes('2 related events') && list.includes('Selected result odds') && list.includes('70.0%'));
    assert.ok(list.includes('aria-expanded="false"') && !list.includes('Combined Snowflake assessment'));
    const missing = renderToStaticMarkup(<AssessmentContent data={{ ...assessment, status: 'unavailable', summary: null, reason: 'No valid sources.' }} event={event} onSelect={() => {}}/>);
    assert.ok(missing.includes('No valid sources.') && !missing.includes('$45.00'));
});
it('renders all event groups as vertical table rows and each dated result with its own odds/change', () => {
    const base: RankedForecastEvent = { ticker: 'SP', groupKey: 'level:SPY', title: 'S&P 500 index', category: 'Indices',
        eventTime: '2026-10-12T19:00:00Z', eventTimeSource: 'close', closeTime: '2026-10-12T19:00:00Z',
        timeRange: { from: '2026-10-12T19:00:00Z', to: '2026-10-13T20:00:00Z' }, linkedValue: 1000, share: .5, dailySensitivityUsd: 15,
        driver: 'SPY', driverLabel: 'Stock market', measuredSymbols: ['AAA'], unmeasuredSymbols: [], preferredMarketTicker: 'EARLY',
        outcomes: ['EARLY', 'LATER'].map((ticker, i) => ({ ticker, eventTicker: 'SP', title: 'Index result', eventTitle: 'S&P',
            closeTime: i ? '2026-10-13T20:00:00Z' : '2026-10-12T19:00:00Z', probability: i ? .3 : .7, spread: .02, drivers: ['SPY'], probabilityNote: 'Bid–ask midpoint', asOf: data.asOf,
            result: { marketTicker: ticker, label: 'At a specific index boundary', driver: 'SPY', targetLevel: 5100, reference: null, coveredValue: 1000,
                changeUsd: i ? -30 : 30, portfolioValueAssumingOthersFlat: i ? 970 : 1030, gainingStocks: i ? [] : ['AAA'], losingStocks: i ? ['AAA'] : [], reason: null } })) };
    const overview = renderToStaticMarkup(<ForecastTable events={[base, { ...base, ticker: 'OTHER', groupKey: 'other', title: 'Earnings' }]} expanded={[]} onToggle={() => {}}/>);
    assert.equal((overview.match(/scope="row"/g) ?? []).length, 2);
    assert.ok(overview.includes('S&amp;P 500 index') && overview.includes('Earnings') && overview.includes('through'));
    assert.ok(!overview.includes('role="tab') && !overview.includes('<aside'));
    const outcomes = renderToStaticMarkup(<OutcomeTable event={base} selected="EARLY" onSelect={() => {}}/>);
    assert.equal((outcomes.match(/scope="row"/g) ?? []).length, 2);
    for (const label of ['2026-10-12T19:00:00Z', '2026-10-13T20:00:00Z', '70.0%', '30.0%', '$30.00', '-$30.00', '↑ AAA', '↓ AAA', 'View stock effects']) assert.ok(outcomes.includes(label), label);
    assert.ok(!outcomes.includes('forecast-result-options') && !outcomes.includes('role="tab'));
    const expanded = renderToStaticMarkup(<ForecastTable events={[base]} expanded={['level:SPY']} onToggle={() => {}}/>);
    assert.ok(expanded.includes('Hide results') && expanded.includes('Dated result forecasts') && expanded.includes('Combined Snowflake assessment'));
});

it('shows the actual reason in result cells and offers an explicit inline measured assumption', () => {
    const cutoff = '2026-10-09', prices = new Map([['SPY', [{ date: cutoff, close: 100 }]]]);
    const models = buildForecasts({ holdings: [{ symbol: 'AAA', valueUsd: 1000 }], prices, cutoff, asOf: data.asOf,
        measurements: [{ symbol: 'AAA', driver: 'SPY', b: 1.5, se: .1, low: 1.304, high: 1.696, days: 250,
            reliable: true, effect: .015, computed_at: new Date(data.asOf!), price_through: cutoff }] });
    const row = { ticker: 'E-M', event_ticker: 'E', series_ticker: 'KXFED', title: 'Fed decision', event_title: 'Fed',
        close_time: new Date('2026-11-01'), tags: ['fed-rates'], ts: new Date(), yes_bid: .6, yes_ask: .8,
        strike_type: null, floor_strike: null, cap_strike: null, linked_symbols: ['AAA'] };
    const result = predictEventResult(row, models, prices, cutoff);
    const missing = renderToStaticMarkup(<ResultChange result={result.result}/>);
    assert.ok(missing.includes('Needs a driver assumption') && missing.includes('cannot establish whether a stock goes up or down'));
    assert.ok(!missing.includes('Unavailable'));
    const form = renderToStaticMarkup(<ResultAssumption data={result} onResult={() => {}}/>);
    for (const label of ['Calculate this result with your assumption', 'Calculate assumed result', 'required=""',
        'Enter your assumption', 'reviewed event-linked stocks only', '$1,000.00', 'not a Snowflake prediction']) assert.ok(form.includes(label), label);
    const assumed = assumedEventResult(row, models, { driver: 'SPY', change: 2 });
    const value = renderToStaticMarkup(<PortfolioResult result={assumed}/>);
    assert.ok(value.includes('Conditional on your assumption') && value.includes('$30.00') && value.includes('$1,030.00'));
    assert.ok(renderToStaticMarkup(<ResultChange result={assumed.result}/>).includes('Your assumption'));
    const unavailable = renderToStaticMarkup(<ResultAssumption data={{ ...result, scenarioDrivers: [] }} onResult={() => {}}/>);
    assert.ok(unavailable.includes('No measured scenario is available') && !unavailable.includes('Calculate assumed result'));
    const price = renderToStaticMarkup(<ResultChange result={{ ...result.result, unavailableReason: 'missing-reference', reason: 'Run the price job for DGS2.' }}/>);
    assert.ok(price.includes('Missing reference price') && price.includes('Run the price job for DGS2.'));
});

it('replaces the assumption-needed message with automatically loaded AI changes and separate confidence', () => {
    const cutoff = '2026-10-09', prices = new Map([['SPY', [{ date: cutoff, close: 100 }]]]);
    const models = buildForecasts({ holdings: [{ symbol: 'AAA', valueUsd: 1000 }], prices, cutoff, asOf: data.asOf,
        measurements: [{ symbol: 'AAA', driver: 'SPY', b: 1.5, se: .1, low: 1.304, high: 1.696, days: 250,
            reliable: true, effect: .015, computed_at: new Date(data.asOf!), price_through: cutoff }] });
    const row = { ticker: 'FED-M', event_ticker: 'FED', series_ticker: 'KXFED', title: 'Policy cut', event_title: 'Fed decision',
        close_time: new Date('2026-11-01'), tags: ['fed-rates'], ts: new Date(), yes_bid: .6, yes_ask: .8,
        strike_type: null, floor_strike: null, cap_strike: null, linked_symbols: ['AAA'] };
    const source = predictEventResult(row, models, prices, cutoff);
    const manual = assumedEventResult(row, models, { driver: 'SPY', change: 2 });
    const prediction = { ...manual, result: { ...manual.result, basis: 'ai-assumption' as const, confidence: 62, label: 'Snowflake assumes SPY changes 2%' } };
    const event: RankedForecastEvent = { ticker: 'FED', title: 'Fed decision', category: 'Economics', eventTime: '2026-11-01', eventTimeSource: 'close', closeTime: '2026-11-01',
        linkedValue: 1000, share: 1, dailySensitivityUsd: null, driver: null, driverLabel: null, measuredSymbols: [], unmeasuredSymbols: ['AAA'],
        preferredMarketTicker: 'FED-M', outcomes: [{ ...source.market, result: source.result, linkedSymbols: ['AAA'] }] };
    const assessment: ForecastAssessmentResponse = { status: 'ready', selectedMarketTicker: 'FED-M', summary: { text: 'A tentative market rise is assumed.', sources: [{ title: 'Fed market', url: 'https://kalshi.com/markets/kx/m/fed' }] },
        generatedAt: data.asOf, reason: null, asOf: data.asOf, assumptions: [{ marketTicker: 'FED-M', driver: 'SPY', change: 2, confidence: 62 }], predictions: [prediction] };
    const html = renderToStaticMarkup(<ForecastTable events={[event]} expanded={[]} onToggle={() => {}} assessments={{ asOf: data.asOf, assessments: [{ eventTicker: 'FED', assessment }] }}/>);
    for (const label of ['$30.00', '70.0%', 'AI assumption', 'AI confidence: 62%', 'self-rated, uncalibrated']) assert.ok(html.includes(label), label);
    assert.ok(!html.includes('Needs a driver assumption') && !html.includes('Enter a driver-change assumption'));
    const detail = renderToStaticMarkup(<PortfolioResult result={prediction}/>);
    assert.ok(detail.includes('Conditional on Snowflake') && detail.includes('62%') && detail.includes('separate from event odds'));
    const explanation = renderToStaticMarkup(<AssessmentContent data={assessment} event={event} onSelect={() => {}}/>);
    assert.ok(explanation.includes('AI confidence: 62%') && explanation.includes('Fed market') && explanation.includes('best-effort driver assumptions'));
    const outcomes = renderToStaticMarkup(<OutcomeTable event={assessedEvent(event, assessment)} selected="FED-M" onSelect={() => {}}/>);
    assert.ok(outcomes.includes('$30.00') && outcomes.includes('↑ AAA') && outcomes.includes('62%'));
    const pending = renderToStaticMarkup(<ForecastTable events={[event]} expanded={[]} onToggle={() => {}} assessments={{ asOf: data.asOf, assessments: [{ eventTicker: 'FED', assessment: { ...assessment, status: 'pending', summary: null, predictions: [] } }] }}/>);
    assert.ok(pending.includes('Snowflake estimating') && !pending.includes('$30.00') && !pending.includes('Needs a driver assumption'));
    const waitingDetails = renderToStaticMarkup(<ResultEstimate data={source} assessment={{ ...assessment, status: 'pending', predictions: [] }}/>);
    assert.ok(waitingDetails.includes('best-effort driver-change assumption') && waitingDetails.includes('self-rated confidence'));
    assert.ok(!waitingDetails.includes('Enter a driver-change assumption') && !waitingDetails.includes('$30.00'));
    const failed = renderToStaticMarkup(<ForecastTable events={[event]} expanded={[]} onToggle={() => {}} assessments={{ asOf: data.asOf, assessments: [{ eventTicker: 'FED', assessment: { ...assessment, status: 'unavailable', reason: 'Configure Snowflake Cortex.', predictions: [] } }] }}/>);
    assert.ok(failed.includes('AI estimate unavailable') && failed.includes('Configure Snowflake Cortex.') && !failed.includes('$30.00'));
    const zeroConfidence = renderToStaticMarkup(<ResultChange result={{ ...prediction.result, confidence: 0 }}/>);
    assert.ok(zeroConfidence.includes('AI confidence: 0%'));
});

it('shows the combined family prediction in the main row and keeps each time/target and contract odds separate', () => {
    const cutoff = '2026-10-09', prices = new Map([['SPY', [{ date: cutoff, close: 100 }]], ['^GSPC', [{ date: cutoff, close: 5000 }]]]);
    const models = buildForecasts({ holdings: [{ symbol: 'AAA', valueUsd: 1000 }], prices, cutoff, asOf: data.asOf,
        measurements: [{ symbol: 'AAA', driver: 'SPY', b: 1.5, se: .1, low: 1.304, high: 1.696, days: 250,
            reliable: true, effect: .015, computed_at: new Date(data.asOf!), price_through: cutoff }] });
    const event = rankForecastEvents([{ ticker: 'TEN', seriesTicker: 'KXINXU', title: 'S&P 500 index', category: 'Indices',
        tags: ['sp500'], linkedSymbols: ['AAA'], eventTime: '2026-10-12T14:00:00Z', eventTimeSource: 'close', closeTime: '2026-10-12T14:00:00Z' }], models, [{ symbol: 'AAA', valueUsd: 1000 }])[0];
    event.groupKey = 'level:SPY'; event.preferredMarketTicker = 'M-0';
    event.outcomes = [0, 1].map(i => {
        const prediction = predictEventResult({ ticker: `M-${i}`, event_ticker: i ? 'ELEVEN' : 'TEN', series_ticker: 'KXINXU',
            title: `Above ${i ? 7500 : 7000}`, event_title: 'S&P price', close_time: new Date(`2026-10-12T${i ? '15' : '14'}:00:00Z`),
            tags: ['sp500'], linked_symbols: ['AAA'], ts: new Date(), yes_bid: i ? .2 : .6, yes_ask: i ? .4 : .8,
            strike_type: 'greater', floor_strike: i ? 7500 : 7000, cap_strike: null }, models, prices, cutoff);
        return { ...prediction.market, result: prediction.result, linkedSymbols: ['AAA'] };
    });
    const joint = jointForecastPrediction(event, models, { driver: 'SPY', change: 1, confidence: 48,
        horizonMarketTicker: 'M-0', evidenceMarketTickers: ['M-0', 'M-1'] })!;
    const assessment: ForecastAssessmentResponse = { status: 'ready', selectedMarketTicker: 'M-0', summary: { text: 'Targets and times assessed together.',
        sources: [{ title: 'S&P source', url: 'https://kalshi.com/markets/kx/m/ten' }] }, generatedAt: data.asOf, reason: null, asOf: data.asOf,
        assumptions: [], predictions: [], jointPrediction: joint };
    const html = renderToStaticMarkup(<ForecastTable events={[event]} expanded={[]} onToggle={() => {}}
        assessments={{ asOf: data.asOf, assessments: [{ eventTicker: 'TEN', assessment }] }}/>);
    for (const label of ['Portfolio forecast', '$15.00', 'Combined forecast', 'AI confidence: 48%', '2 contracts across 2 times', 'Selected contract odds are separate', '70.0%']) assert.ok(html.includes(label), label);
    assert.ok(!html.includes('$600.00'));
    assert.match(html, /<td class="amount">70\.0%<span class="note">Above 7000/);
    const detail = renderToStaticMarkup(<GroupPrediction data={joint}/>);
    for (const label of ['Combined family forecast', '↑ Up', '$1,015.00', 'self-rated, uncalibrated', 'not a cumulative forecast', 'Current contract odds are displayed separately']) assert.ok(detail.includes(label), label);
    const individual = renderToStaticMarkup(<OutcomeTable event={event} selected="M-0" onSelect={() => {}}/>);
    for (const label of ['Above 7000', 'Above 7500', '2026-10-12T14:00:00.000Z', '2026-10-12T15:00:00.000Z', '70.0%', '30.0%', '$600.00', '$750.00']) assert.ok(individual.includes(label), label);
});
