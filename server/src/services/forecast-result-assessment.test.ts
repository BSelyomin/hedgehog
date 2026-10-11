import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool, aiPool } from '../db.ts';
import { buildForecasts } from './forecast-model.ts';
import { predictEventResult, rankForecastEvents } from './event-predictions.ts';
import { assessmentRequest, FORECAST_INSTRUCTIONS, FORECAST_SCHEMA, type ForecastAssessmentContext } from './forecast-assessment.ts';
import { contentHash } from './ai-cache.ts';
import { forecastResultAssessment } from './forecast-result-assessment.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { digest } from '../auth/session.ts';
import { completedPriceDate } from './price-date.ts';

const originalQuery = pool.query, originalConnect = aiPool.connect, originalFetch = globalThis.fetch;
const names = ['SNOWFLAKE_ACCOUNT_URL', 'SNOWFLAKE_PAT', 'SNOWFLAKE_CORTEX_MODEL'];
const originalEnv = names.map(name => process.env[name]);
const records = new Map<string, { value: unknown; created_at: Date }>();
let context: ForecastAssessmentContext, session: string, caseNumber = 0, fetches: number, confidence: number, sourceText: string;
let pause: Promise<void> | undefined;
beforeEach(() => {
    session = `60000000-0000-0000-0000-${String(++caseNumber).padStart(12, '0')}`;
    records.clear(); fetches = 0; confidence = 65; sourceText = 'A tentative reaction assumption, with uncertain effects.'; pause = undefined;
    process.env.SNOWFLAKE_ACCOUNT_URL = 'https://forecast-test.snowflakecomputing.com';
    process.env.SNOWFLAKE_PAT = 'local-test-value'; process.env.SNOWFLAKE_CORTEX_MODEL = 'test-model';
    const cutoff = completedPriceDate(), asOf = new Date().toISOString(), holdings = [{ symbol: 'AAA', valueUsd: 1000 }];
    const prices = new Map([['SPY', [{ date: cutoff, close: 100 }]]]);
    const measurements = [{ symbol: 'AAA', driver: 'SPY', b: 1.5, se: .1, low: 1.304, high: 1.696,
        days: 250, reliable: true, effect: .015, price_through: cutoff, computed_at: new Date() }];
    const data = buildForecasts({ holdings, prices, measurements, cutoff, asOf });
    const closeTime = new Date(Date.now() + 7 * 86400000).toISOString();
    const event = rankForecastEvents([{ ticker: 'E', seriesTicker: 'TESTPOLICY', title: 'Policy decision', category: 'Economics',
        tags: ['fed-rates'], linkedSymbols: ['AAA'], closeTime, eventTime: closeTime, eventTimeSource: 'close' }], data, holdings)[0];
    const rows = Array.from({ length: 12 }, (_, i) => ({ ticker: `E-M${i}`, event_ticker: 'E', series_ticker: 'TESTPOLICY',
        title: `Policy result ${i}`, event_title: 'Policy decision', close_time: new Date(closeTime), tags: ['fed-rates'],
        ts: new Date(), yes_bid: .6, yes_ask: .8, strike_type: null, floor_strike: null, cap_strike: null, linked_symbols: ['AAA'] }));
    event.outcomes = rows.map(row => { const result = predictEventResult(row, data, prices, cutoff);
        return { ...result.market, result: result.result, linkedSymbols: ['AAA'], seriesTicker: row.series_ticker }; });
    event.sourceEvents = [{ ticker: 'E', title: 'Policy decision', seriesTicker: 'TESTPOLICY', url: 'https://kalshi.com/markets/kx/m/e' }];
    context = { events: { events: [event], totalValue: 1000, candidateEvents: 1, notes: [], asOf }, model: { data, holdings, prices, cutoff } };
    const execute = async (sql: string, args: unknown[] = []) => {
        const key = `${args[0]}:${args[1]}`;
        let result: unknown[] = [];
        if (sql.startsWith('SELECT value,created_at')) result = records.has(key) ? [records.get(key)] : [];
        else if (sql.startsWith('INSERT INTO ai_cache')) {
            const record = { value: JSON.parse(String(args[2])), created_at: new Date() }; records.set(key, record); result = [record];
        } else if (sql.startsWith('DELETE FROM ai_cache')) records.delete(key);
        else if (sql.includes('SELECT * FROM holdings') && args[0] === session) result = [{ symbol: 'AAA', value_usd: '1000', updated_at: new Date() }];
        else if (sql.includes('SELECT s.symbol,p.ts')) result = ['AAA', 'SPY'].map(symbol => ({ symbol, ts: new Date(cutoff), close: 100, loaded_at: new Date() }));
        else if (sql.includes('SELECT symbol,driver,b,se')) result = measurements;
        else if (sql.includes('GROUP BY e.ticker,r.tags')) result = [{ ticker: 'E', series_ticker: 'TESTPOLICY', title: 'Policy decision',
            description: '', category: 'Economics', tags: ['fed-rates'], linked_symbols: ['AAA'], close_time: new Date(closeTime),
            occurrence_time: null, expected_expiration_time: null, strike_date: null }];
        else if (sql.includes('SELECT m.ticker,m.event_ticker,m.series_ticker')) result = rows;
        return { rows: result, rowCount: result.length };
    };
    pool.query = execute as typeof pool.query;
    aiPool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof aiPool.connect;
    globalThis.fetch = async (_url, options) => {
        fetches++;
        const payload = JSON.parse(String(options?.body)), input = JSON.parse(payload.messages[1].content);
        assert.equal(payload.response_format.type, 'json_schema');
        assert.equal(input.markets.length, 1); assert.equal(input.jointContext.required, false);
        assert.equal(input.contracts.length, 1); assert.equal(input.contracts[0].marketTicker, input.markets[0].marketTicker);
        const schema = payload.response_format.json_schema.schema;
        assert.deepEqual(schema.properties.selectedMarketTicker.enum, [input.markets[0].marketTicker]);
        assert.deepEqual(schema.properties.assumptions.items.properties.driver.enum, input.markets[0].allowedDrivers);
        assert.ok(!payload.messages[0].content.includes('Evaluate ALL contracts'));
        await pause;
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
            selectedMarketTicker: input.markets[0].marketTicker, text: sourceText, sourceIds: ['event-0'],
            assumptions: [{ marketTicker: input.markets[0].marketTicker, driver: 'SPY', change: 1, confidence }], jointForecasts: []
        }) } }] });
    };
});
afterEach(() => {
    pool.query = originalQuery; aiPool.connect = originalConnect; globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (originalEnv[i] === undefined) delete process.env[name]; else process.env[name] = originalEnv[i]; });
});

it('estimates a selected contract outside the eight representatives only after an explicit action', async () => {
    const family = context.events.events[0];
    const representatives = assessmentRequest(family, context.model.data, context.model.holdings).input.markets.map(m => m.marketTicker);
    const ticker = family.outcomes.find(m => !representatives.includes(m.ticker))!.ticker;
    assert.equal((await forecastResultAssessment(session, ticker, 'read', context))!.status, 'not-requested'); assert.equal(fetches, 0);
    const ready = (await forecastResultAssessment(session, ticker, 'start', context))!;
    assert.equal(ready.status, 'ready'); assert.equal(ready.predictions![0].result.changeUsd, 15);
    assert.equal(ready.predictions![0].result.confidence, 65); assert.deepEqual(ready.predictions![0].result.gainingStocks, ['AAA']);
    assert.equal(ready.predictions![0].market.probability, .7); assert.equal(fetches, 1);
    assert.deepEqual(await forecastResultAssessment(session, ticker, 'read', context), ready);
    await forecastResultAssessment(session, ticker, 'start', context); assert.equal(fetches, 1);
});

it('keeps a cached assumption across quote and sibling changes but invalidates changed holdings or coefficients', async () => {
    const ticker = 'E-M11';
    await forecastResultAssessment(session, ticker, 'start', context);
    context.events.events[0].outcomes[0].title = 'Updated sibling';
    context.events.events[0].outcomes.find(m => m.ticker === ticker)!.probability = .3;
    const cached = (await forecastResultAssessment(session, ticker, 'start', context))!;
    assert.equal(fetches, 1); assert.equal(cached.predictions![0].market.probability, .3);
    context.model.data.drivers[0].holdings[0].sensitivity.b = 2;
    assert.equal((await forecastResultAssessment(session, ticker, 'read', context))!.status, 'not-requested');
    assert.equal((await forecastResultAssessment(session, ticker, 'start', context))!.predictions![0].result.changeUsd, 20); assert.equal(fetches, 2);
    context.model.holdings[0].valueUsd = 2000; context.model.data.drivers[0].holdings[0].valueUsd = 2000; context.model.data.totalValue = 2000;
    assert.equal((await forecastResultAssessment(session, ticker, 'start', context))!.predictions![0].result.changeUsd, 40); assert.equal(fetches, 3);
});

const legacyInstructions = FORECAST_INSTRUCTIONS + ' This is an explicitly selected individual result. Return exactly one assumption for its marketTicker if it has allowedDrivers and no supported change. Keep jointForecasts empty. The other contracts are context only; do not substitute a combined forecast for this conditional result.';
it('reuses a valid individual estimate saved with the previous family prompt', async () => {
    const ticker = 'E-M11';
    await forecastResultAssessment(session, ticker, 'start', context);
    const saved = [...records.values()][0]; records.clear();
    const { identity: portfolio } = assessmentRequest(context.events.events[0], context.model.data, context.model.holdings, ticker);
    const identity = { ...portfolio, outcomes: portfolio.outcomes.filter(m => m.ticker === ticker), session };
    const hash = contentHash({ account: process.env.SNOWFLAKE_ACCOUNT_URL, model: process.env.SNOWFLAKE_CORTEX_MODEL,
        instructions: legacyInstructions, schema: FORECAST_SCHEMA, input: identity });
    records.set(`cortex-v1:${hash}`, saved);
    const ready = (await forecastResultAssessment(session, ticker, 'start', context))!;
    assert.equal(ready.status, 'ready'); assert.deepEqual(ready.predictions![0].result.gainingStocks, ['AAA']); assert.equal(fetches, 1);
});

it('keeps failures from the previous prompt stopped until the user explicitly retries', async () => {
    const ticker = 'E-M11';
    const { identity: portfolio } = assessmentRequest(context.events.events[0], context.model.data, context.model.holdings, ticker);
    const hash = contentHash({ session, marketTicker: ticker, groupKey: portfolio.groupKey,
        holdings: portfolio.holdings, measurements: portfolio.measurements, instructions: legacyInstructions,
        account: process.env.SNOWFLAKE_ACCOUNT_URL, model: process.env.SNOWFLAKE_CORTEX_MODEL });
    records.set(`forecast-result-failure-v1:${hash}`, { value: { reason: 'Previous rejected estimate.' }, created_at: new Date() });
    const failed = (await forecastResultAssessment(session, ticker, 'start', context))!;
    assert.equal(failed.status, 'unavailable'); assert.match(failed.reason!, /Previous rejected estimate/); assert.equal(fetches, 0);
    assert.equal((await forecastResultAssessment(session, ticker, 'retry', context))!.status, 'ready'); assert.equal(fetches, 1);
});

it('stops rejected results across ordinary reads and starts, with an isolated explicit retry', async () => {
    confidence = 101;
    assert.equal((await forecastResultAssessment(session, 'E-M11', 'start', context))!.status, 'unavailable');
    confidence = 65;
    await forecastResultAssessment(session, 'E-M11', 'read', context);
    await forecastResultAssessment(session, 'E-M11', 'start', context); assert.equal(fetches, 1);
    assert.equal((await forecastResultAssessment(session, 'E-M10', 'start', context))!.status, 'ready'); assert.equal(fetches, 2);
    assert.equal((await forecastResultAssessment(session, 'E-M11', 'retry', context))!.status, 'ready'); assert.equal(fetches, 3);
});

it('coalesces simultaneous selections and reports pending without GET starting inference', async () => {
    let release!: () => void; pause = new Promise(resolve => { release = resolve; });
    const first = forecastResultAssessment(session, 'E-M11', 'start', context);
    for (let i = 0; i < 20 && fetches === 0; i++) await new Promise<void>(resolve => setImmediate(resolve));
    const second = forecastResultAssessment(session, 'E-M11', 'start', context);
    assert.equal((await forecastResultAssessment(session, 'E-M11', 'read', context))!.status, 'pending');
    release(); const values = await Promise.all([first, second]);
    assert.equal(fetches, 1); assert.deepEqual(values[0], values[1]);
});

it('queues a first attempt while both inference slots are occupied without holding another database connection', async () => {
    let release!: () => void; pause = new Promise(resolve => { release = resolve; });
    const connect = aiPool.connect as () => Promise<import('pg').PoolClient>; let connections = 0;
    aiPool.connect = (async () => { connections++; return connect(); }) as typeof aiPool.connect;
    const first = forecastResultAssessment(session, 'E-M11', 'start', context);
    const second = forecastResultAssessment(session, 'E-M10', 'start', context);
    const queued = forecastResultAssessment(session, 'E-M9', 'start', context);
    for (let i = 0; i < 30 && fetches < 2; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(fetches, 2); assert.equal(connections, 2);
    assert.equal((await forecastResultAssessment(session, 'E-M9', 'read', context))!.status, 'pending');
    release(); const values = await Promise.all([first, second, queued]);
    assert.ok(values.every(value => value?.status === 'ready')); assert.equal(fetches, 3); assert.equal(connections, 3);
});

it('retains validated numbers when explanation text fails, and never estimates without a usable measurement', async () => {
    sourceText = 'Guaranteed gain of 999999 dollars.';
    const ready = (await forecastResultAssessment(session, 'E-M11', 'start', context))!;
    assert.equal(ready.status, 'ready'); assert.equal(ready.summary, null); assert.equal(ready.explanationStatus, 'hidden');
    assert.equal(ready.predictions![0].result.changeUsd, 15);
    context.model.data.drivers.forEach(d => { d.holdings = []; });
    const absent = (await forecastResultAssessment(session, 'E-M10', 'start', context))!;
    assert.equal(absent.status, 'unavailable'); assert.match(absent.reason!, /No reliable measured driver/); assert.equal(fetches, 1);
    assert.equal(await forecastResultAssessment(session, 'FOREIGN', 'start', context), null);
});

it('returns full current stock effects without AI when a previously unsupported result now has a measured scenario', async () => {
    context.model.prices.set('^GSPC', [{ date: context.model.cutoff, close: 5000 }]);
    const row = { ticker: 'E-M11', event_ticker: 'E', series_ticker: 'KXINXU', title: 'Index above the boundary', event_title: 'Index close',
        close_time: new Date(Date.now() + 86400000), tags: ['sp500'], ts: new Date(), yes_bid: .6, yes_ask: .8,
        strike_type: 'greater', floor_strike: 5050, cap_strike: null, linked_symbols: ['AAA'] };
    const prediction = predictEventResult(row, context.model.data, context.model.prices, context.model.cutoff);
    assert.equal(prediction.result.changeUsd, 15);
    context.events.events[0].outcomes[11] = { ...prediction.market, result: prediction.result, linkedSymbols: ['AAA'], seriesTicker: 'KXINXU' };
    const execute = pool.query as (sql: string, args: unknown[]) => Promise<unknown>;
    pool.query = (async (sql: string, args: unknown[]) => sql.includes('WHERE m.ticker=$2')
        ? { rows: [row], rowCount: 1 } : execute(sql, args)) as typeof pool.query;
    const ready = (await forecastResultAssessment(session, 'E-M11', 'start', context))!;
    assert.equal(ready.status, 'ready'); assert.equal(ready.predictions![0].result.changeUsd, 15);
    assert.equal(ready.predictions![0].stocks[0].direction, 'up'); assert.equal(fetches, 0);
});

it('protects result estimate routes with portfolio membership and CSRF while keeping GET read-only', async () => {
    const app = createApp();
    const headers = { cookie: `hedgehog_session=${session}`, 'x-hedgehog-request': '1', 'x-hedgehog-session': digest(session) };
    const path = '/forecasts/result/E-M11/assessment';
    assert.equal((await request(app, path, { headers })).body.status, 'not-requested'); assert.equal(fetches, 0);
    assert.equal((await request(app, path, { method: 'POST', body: {}, headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await request(app, path, { headers: { cookie: 'hedgehog_session=foreign' } })).status, 404);
    assert.equal((await request(app, '/forecasts/result/FOREIGN/assessment', { headers })).status, 404);
    const response = await request(app, path, { method: 'POST', body: {}, headers });
    assert.equal(response.status, 200); assert.equal(response.body.status, 'ready'); assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal((await request(app, path, { headers })).body.predictions[0].result.changeUsd, 15); assert.equal(fetches, 1);
});
