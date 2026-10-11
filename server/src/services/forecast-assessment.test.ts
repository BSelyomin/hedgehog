import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool, aiPool } from '../db.ts';
import { forecastAssessment, forecastAssessments, retryForecastAssessment } from './forecast-assessment.ts';
import { rankedForecasts } from './ranked-forecasts.ts';
import { completedPriceDate } from './price-date.ts';

const originalQuery = pool.query, originalConnect = aiPool.connect, originalFetch = globalThis.fetch;
const names = ['SNOWFLAKE_ACCOUNT_URL', 'SNOWFLAKE_PAT', 'SNOWFLAKE_CORTEX_MODEL'];
const originalEnv = names.map(name => process.env[name]);
const records = new Map<string, { value: unknown; created_at: Date }>();
const failureRecords = new Map<string, { value: unknown; created_at: Date }>();
let value = 1000, probability = .7, fetches = 0, unsupportedGroups = 0, confidence = 55;
let releaseProviders: (() => void)[] = [];
beforeEach(() => {
    records.clear(); failureRecords.clear(); value = 1000; probability = .7; fetches = 0; unsupportedGroups = 0; confidence = 55; releaseProviders = [];
    process.env.SNOWFLAKE_ACCOUNT_URL = 'https://forecast-test.snowflakecomputing.com';
    process.env.SNOWFLAKE_PAT = 'local-test-value'; process.env.SNOWFLAKE_CORTEX_MODEL = 'test-model';
    const execute = async (sql: string, args: unknown[] = []) => {
        let rows: unknown[] = []; const cutoff = completedPriceDate(), key = `${args[0]}:${args[1]}`;
        const storage = args[0] === 'forecast-failure-v1' ? failureRecords : records;
        if (sql.startsWith('SELECT value,created_at')) rows = storage.has(key) ? [storage.get(key)] : [];
        else if (sql.startsWith('DELETE FROM ai_cache')) storage.delete(key);
        else if (sql.startsWith('INSERT INTO ai_cache')) { const row = { value: JSON.parse(String(args[2])), created_at: new Date() }; storage.set(key, row); rows = [row]; }
        else if (sql.includes('SELECT * FROM holdings') && args[0] !== 'foreign') rows = [{ symbol: 'AAA', value_usd: String(value), updated_at: new Date() }];
        else if (sql.includes('SELECT s.symbol,p.ts')) rows = ['SPY', 'AAA', '^GSPC'].map(symbol => ({ symbol, ts: new Date(cutoff), close: symbol === '^GSPC' ? 5000 : 100, loaded_at: new Date() }));
        else if (sql.includes('SELECT symbol,driver,b,se')) rows = [{ symbol: 'AAA', driver: 'SPY', b: 1.5, se: .1, low: 1.304, high: 1.696, days: 250, reliable: true, effect: .015, price_through: cutoff, computed_at: new Date() }];
        else if (unsupportedGroups && sql.includes('GROUP BY e.ticker,r.tags')) rows = Array.from({ length: unsupportedGroups }, (_, i) => ({ ticker: `FED-${i}`, series_ticker: `TEST-POLICY-${i}`, title: `Policy decision ${i}`, description: 'Federal Reserve decision', category: 'Economics',
            tags: ['fed-rates'], linked_symbols: ['AAA'], close_time: new Date(Date.parse(cutoff) + (4 + i) * 86400000), occurrence_time: null, expected_expiration_time: null, strike_date: null }));
        else if (unsupportedGroups && sql.includes('SELECT m.ticker,m.event_ticker,m.series_ticker')) rows = Array.from({ length: unsupportedGroups }, (_, i) => ({ ticker: `FED-${i}-M`, event_ticker: `FED-${i}`, series_ticker: `TEST-POLICY-${i}`, title: 'Policy cut', event_title: `Policy decision ${i}`,
            tags: ['fed-rates'], linked_symbols: ['AAA'], close_time: new Date(Date.parse(cutoff) + (4 + i) * 86400000), ts: new Date(), yes_bid: probability - .1, yes_ask: probability + .1, strike_type: null, floor_strike: null, cap_strike: null }));
        else if (sql.includes('GROUP BY e.ticker,r.tags')) rows = ['KXINX', 'KXINXU', 'KXINXDUD'].map((series, i) => ({ ticker: `${series}-E`, series_ticker: series, title: 'S&P close', description: '', category: 'Indices',
            tags: ['sp500'], linked_symbols: ['AAA'], close_time: new Date(Date.parse(cutoff) + (4 + i) * 86400000 + 20 * 3600000), occurrence_time: null, expected_expiration_time: null, strike_date: null }));
        else if (sql.includes('SELECT m.ticker,m.event_ticker,m.series_ticker')) rows = ['KXINX', 'KXINXU', 'KXINXDUD'].map((series, i) => ({ ticker: `${series}-M`, event_ticker: `${series}-E`, series_ticker: series, title: 'S&P result', event_title: 'S&P close',
            tags: ['sp500'], linked_symbols: ['AAA'], close_time: new Date(Date.parse(cutoff) + (4 + i) * 86400000 + 20 * 3600000), ts: new Date(), yes_bid: probability - .1, yes_ask: probability + .1,
            strike_type: series === 'KXINX' ? 'between' : 'greater', floor_strike: 5100, cap_strike: series === 'KXINX' ? 5200 : null }));
        return { rows, rowCount: rows.length };
    };
    pool.query = execute as typeof pool.query;
    aiPool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof aiPool.connect;
    globalThis.fetch = async (_url, options) => {
        fetches++;
        const payload = JSON.parse(String(options?.body));
        assert.ok(payload.messages[0].content.includes('must never be added or averaged'));
        assert.equal(payload.response_format.type, 'json_schema');
        const input = JSON.parse(payload.messages[1].content);
        const jointForecasts = input.jointContext.required ? [{ horizonMarketTicker: input.jointContext.horizonMarketTicker,
            driver: input.jointContext.allowedDrivers[0], change: 1, confidence: 48,
            evidenceMarketTickers: input.contracts.filter((m: { probabilityPoints: number | null }) => m.probabilityPoints !== null)
                .map((m: { marketTicker: string }) => m.marketTicker) }] : [];
        const assumptions = input.markets.filter((m: { result: { changeUsd: number | null }; allowedDrivers: string[] }) => m.result.changeUsd === null && m.allowedDrivers.length)
            .map((m: { marketTicker: string }) => ({ marketTicker: m.marketTicker, driver: 'SPY', change: 2, confidence }));
        if (assumptions.length) {
            assert.ok(payload.messages[0].content.includes('make your best reasonable assumption'));
            assert.equal(input.drivers[0].unit, 'percent'); assert.equal(input.drivers[0].typicalDailyChange, 1);
        }
        await new Promise<void>(resolve => { releaseProviders.push(resolve); });
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ selectedMarketTicker: input.markets[0].marketTicker,
            text: assumptions.length ? 'A modest market rise is a tentative assumption for this outcome; uncertainty remains high.' : 'This range supports a positive measured portfolio contribution using a market proxy. Other risks remain unmodeled.',
            sourceIds: input.sources.filter((s: { id: string }) => ['event-0', 'price-0'].includes(s.id)).map((s: { id: string }) => s.id), assumptions, jointForecasts }) } }] });
    };
});
afterEach(() => {
    pool.query = originalQuery; aiPool.connect = originalConnect; globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (originalEnv[i] === undefined) delete process.env[name]; else process.env[name] = originalEnv[i]; });
});
async function finish() {
    for (let i = 0; i < 20 && !releaseProviders.length; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(releaseProviders.length); const releases = releaseProviders; releaseProviders = []; releases.forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 10));
}
it('consolidates markets with prices, exposes sourced changes/odds and does not wait for slow Snowflake inference', async () => {
    const grouped = await rankedForecasts('owner-a');
    assert.equal(grouped.candidateEvents, 3); assert.equal(grouped.groupedEvents, 1); assert.equal(grouped.events.length, 1);
    const event = grouped.events[0]; assert.equal(event.linkedValue, 1000); assert.equal(event.dailySensitivityUsd, 15);
    assert.equal(event.outcomes.length, 3); assert.equal(event.prices!.find(p => p.symbol === '^GSPC')!.value, 5000);
    assert.notEqual(event.timeRange!.from, event.timeRange!.to); assert.equal(new Set(event.outcomes.map(m => m.closeTime)).size, 3);
    assert.equal(event.outcomes[0].closeTime, event.timeRange!.from); assert.equal(event.outcomes.at(-1)!.closeTime, event.timeRange!.to);
    assert.equal(event.outcomes.find(m => m.ticker === 'KXINX-M')!.result.changeUsd, 45);
    assert.equal((await forecastAssessment('owner-a', event.ticker))!.status, 'pending');
    assert.equal((await forecastAssessment('owner-a', event.ticker))!.status, 'pending'); assert.equal(fetches, 1);
    await finish();
    const ready = (await forecastAssessment('owner-a', event.ticker))!;
    assert.equal(ready.status, 'ready'); assert.equal(ready.selectedMarketTicker, 'KXINX-M');
    assert.equal(ready.summary!.sources.length, 2); assert.equal(records.size, 1);
    assert.equal(ready.jointPrediction!.contextContracts, 3); assert.equal(ready.jointPrediction!.contextTimes, 3);
    assert.equal(ready.jointPrediction!.result.changeUsd, 15); assert.equal(ready.jointPrediction!.result.confidence, 48);
    assert.equal(ready.jointPrediction!.horizon.marketTicker, 'KXINX-M');
    probability = .3;
    assert.equal((await forecastAssessment('owner-a', event.ticker))!.generatedAt, ready.generatedAt); assert.equal(fetches, 1);
    assert.equal((await forecastAssessments('owner-a')).assessments[0].assessment.jointPrediction!.result.changeUsd, 15);
    assert.ok(Math.abs((await rankedForecasts('owner-a')).events[0].outcomes[0].probability! - .3) < 1e-12);
    value = 2000;
    assert.equal((await forecastAssessment('owner-a', event.ticker))!.status, 'pending');
    await finish(); assert.equal(fetches, 2); assert.equal((await forecastAssessment('owner-a', event.ticker))!.status, 'ready');
    assert.equal(records.size, 2);
});
it('isolates saved assessments by session and supports unconfigured or foreign portfolios', async () => {
    const event = (await rankedForecasts('owner-b')).events[0];
    assert.equal((await forecastAssessment('owner-b', event.ticker))!.status, 'pending'); await finish();
    assert.equal((await forecastAssessment('owner-c', event.ticker))!.status, 'pending'); await finish(); assert.equal(fetches, 2);
    assert.equal(await forecastAssessment('foreign', event.ticker), null);
    delete process.env.SNOWFLAKE_PAT;
    const missing = (await forecastAssessment('owner-b', event.ticker))!;
    assert.equal(missing.status, 'unavailable'); assert.equal(missing.summary, null); assert.equal(fetches, 2);
});

it('automatically predicts unsupported results with a best-effort assumption and separate self-rated confidence', async () => {
    unsupportedGroups = 1;
    const pending = await forecastAssessments('auto-owner');
    assert.equal(pending.assessments.length, 1); assert.equal(pending.assessments[0].assessment.status, 'pending');
    await finish();
    const ready = (await forecastAssessments('auto-owner')).assessments[0].assessment;
    assert.equal(ready.status, 'ready'); assert.equal(ready.assumptions![0].confidence, 55);
    const predicted = ready.predictions![0];
    assert.equal(predicted.result.basis, 'ai-assumption'); assert.equal(predicted.result.confidence, 55);
    assert.equal(predicted.result.changeUsd, 30); assert.equal(predicted.result.portfolioValueAssumingOthersFlat, 1030);
    assert.equal(predicted.market.probability, .7); assert.equal(predicted.stocks[0].direction, 'up');
    assert.ok(predicted.notes.some(note => note.includes('uncalibrated')));
    probability = .3;
    const cached = (await forecastAssessments('auto-owner')).assessments[0].assessment;
    assert.equal(fetches, 1); assert.equal(cached.generatedAt, ready.generatedAt);
    assert.equal(cached.predictions![0].result.confidence, 55);
    assert.ok(Math.abs(cached.predictions![0].market.probability! - .3) < 1e-12);
    value = 2000;
    assert.equal((await forecastAssessments('auto-owner')).assessments[0].assessment.status, 'pending');
    await finish();
    assert.equal((await forecastAssessments('auto-owner')).assessments[0].assessment.predictions![0].result.changeUsd, 60);
    assert.equal(fetches, 2); assert.deepEqual((await forecastAssessments('foreign')).assessments, []);
});
it('bounds background concurrency to the dedicated AI pool and completes queued groups on later polls', async () => {
    unsupportedGroups = 6;
    const initial = await forecastAssessments('queue-owner');
    assert.equal(initial.assessments.length, 6); assert.ok(initial.assessments.every(item => item.assessment.status === 'pending'));
    assert.equal(fetches, 2); assert.equal(releaseProviders.length, 2);
    for (let cohort = 1; cohort <= 3; cohort++) {
        await finish();
        const next = await forecastAssessments('queue-owner');
        assert.equal(next.assessments.filter(item => item.assessment.status === 'ready').length, cohort * 2);
        if (cohort < 3) for (let i = 0; i < 20 && releaseProviders.length < 2; i++) await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.equal(fetches, 6);
});
it('queues forecasts while another AI job uses the dedicated pool instead of submitting connections that time out', async () => {
    unsupportedGroups = 1;
    const original = Object.getOwnPropertyDescriptor(aiPool, 'totalCount');
    Object.defineProperty(aiPool, 'totalCount', { configurable: true, get: () => aiPool.options.max });
    try {
        const queued = await forecastAssessments('pool-busy-owner');
        assert.equal(queued.assessments[0].assessment.status, 'pending'); assert.equal(fetches, 0);
    } finally {
        if (original) Object.defineProperty(aiPool, 'totalCount', original); else Reflect.deleteProperty(aiPool, 'totalCount');
    }
    assert.equal((await forecastAssessments('pool-busy-owner')).assessments[0].assessment.status, 'pending');
    await finish();
    assert.equal((await forecastAssessments('pool-busy-owner')).assessments[0].assessment.status, 'ready'); assert.equal(fetches, 1);
});
it('does not cache an invalid confidence response or regenerate guesses on every retry', async () => {
    unsupportedGroups = 1; confidence = 120;
    assert.equal((await forecastAssessments('invalid-confidence-owner')).assessments[0].assessment.status, 'pending');
    await finish();
    const failed = (await forecastAssessments('invalid-confidence-owner')).assessments[0].assessment;
    assert.equal(failed.status, 'unavailable'); assert.equal(failed.predictions, undefined); assert.equal(records.size, 0);
    assert.equal(fetches, 1);
    assert.equal((await forecastAssessments('invalid-confidence-owner')).assessments[0].assessment.status, 'unavailable');
    assert.equal(fetches, 1);
});

it('exposes sanitized authorization failures without scheduling automatic retries or caching failed results', async () => {
    unsupportedGroups = 1;
    globalThis.fetch = async () => { fetches++; return new Response('private provider body', { status: 403 }); };
    assert.equal((await forecastAssessments('forbidden-provider')).assessments[0].assessment.status, 'pending');
    await new Promise(resolve => setTimeout(resolve, 10));
    const failed = (await forecastAssessments('forbidden-provider')).assessments[0].assessment;
    assert.equal(failed.status, 'unavailable'); assert.ok(failed.reason!.includes('HTTP 403'));
    assert.ok(failed.reason!.includes('PAT')); assert.ok(!failed.reason!.includes('private provider body'));
    assert.equal(failed.retryAt, undefined); assert.equal(records.size, 0); assert.equal(fetches, 1);
});

it('persists a stopped status for rate limiting without scheduling further provider calls', async () => {
    unsupportedGroups = 1;
    globalThis.fetch = async () => { fetches++; return new Response('private body', { status: 429 }); };
    await forecastAssessments('rate-limited-provider');
    await new Promise(resolve => setTimeout(resolve, 10));
    const failed = (await forecastAssessments('rate-limited-provider')).assessments[0].assessment;
    assert.equal(failed.status, 'unavailable'); assert.ok(failed.reason!.includes('HTTP 429'));
    assert.equal(failed.retryAt, undefined); assert.equal(records.size, 0); assert.equal(failureRecords.size, 1);
    await forecastAssessments('rate-limited-provider'); assert.equal(fetches, 1);
});

it('caches a validated non-index prediction despite an invalid sibling joint estimate and reuses it on quote changes', async () => {
    unsupportedGroups = 1;
    const provider = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        const response = await provider(...args), body = await response.json();
        const result = JSON.parse(body.choices[0].message.content);
        result.jointForecasts = [{ horizonMarketTicker: 'INVENTED', driver: 'SPY', change: 1, confidence: 50, evidenceMarketTickers: ['INVENTED', 'OTHER'] }];
        body.choices[0].message.content = JSON.stringify(result);
        return Response.json(body);
    };
    await forecastAssessments('partial-cache-owner'); await finish();
    const ready = (await forecastAssessments('partial-cache-owner')).assessments[0].assessment;
    assert.equal(ready.status, 'ready'); assert.ok(ready.reason!.includes('only validated'));
    assert.equal(ready.predictions![0].result.changeUsd, 30); assert.equal(ready.jointPrediction, undefined);
    assert.equal(records.size, 1); probability = .3;
    const cached = (await forecastAssessments('partial-cache-owner')).assessments[0].assessment;
    assert.equal(cached.generatedAt, ready.generatedAt); assert.equal(fetches, 1);
    assert.equal(cached.predictions![0].result.changeUsd, 30);
});

it('logs sending, safe response metadata, validated assumptions and cache hits without leaking provider content', async () => {
    unsupportedGroups = 1;
    const info = console.info, warn = console.warn, lines: string[] = [], provider = globalThis.fetch;
    console.info = console.warn = (...args: unknown[]) => { lines.push(JSON.stringify(args)); };
    globalThis.fetch = async (...args) => {
        const response = await provider(...args), body = await response.json();
        body.secret = 'untrusted-provider-secret';
        body.usage = { prompt_tokens: 123, completion_tokens: 45, secret: 'usage-secret' };
        return Response.json(body);
    };
    try {
        await forecastAssessments('private-log-owner'); await finish();
        assert.equal((await forecastAssessments('private-log-owner')).assessments[0].assessment.status, 'ready');
        const received = lines.join('\n');
        for (const stage of ['request_started', 'response_received', 'response_metadata', 'response_validated', 'cache_hit']) assert.ok(received.includes(stage), stage);
        assert.ok(received.includes('"completionTokens":45')); assert.ok(received.includes('"change":2'));
        for (const secret of ['untrusted-provider-secret', 'usage-secret', 'local-test-value', 'private-log-owner', 'AAA', 'A modest market rise']) assert.ok(!received.includes(secret), secret);
        const sent = lines.filter(line => line.includes('request_started')).length;
        await forecastAssessments('private-log-owner');
        assert.equal(lines.filter(line => line.includes('request_started')).length, sent);
        globalThis.fetch = async () => new Response('untrusted-error-secret', { status: 403 });
        await forecastAssessments('private-failed-owner'); await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(lines.some(line => line.includes('assessment_failed') && line.includes('HTTP 403')));
        assert.ok(!lines.join('\n').includes('untrusted-error-secret'));
    } finally { console.info = info; console.warn = warn; }
});

it('never retries a rejected quantitative estimate after time, odds, new contracts, page reads or a process restart; changed holdings permit a new assessment', async () => {
    unsupportedGroups = 1; confidence = 120;
    const provider = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        const response = await provider(...args), body = await response.json(), result = JSON.parse(body.choices[0].message.content);
        result.text = 'Invented gain of 999999 dollars.';
        body.choices[0].message.content = JSON.stringify(result); return Response.json(body);
    };
    await forecastAssessments('stopped-summary-owner'); await finish();
    assert.equal(failureRecords.size, 1); assert.equal(records.size, 0);
    const now = Date.now;
    const baseQuery = pool.query;
    try {
        Date.now = () => now() + 120000;
        probability = .2;
        pool.query = (async (sql: string, args: unknown[]) => {
            const response = await (baseQuery as Function)(sql, args);
            if (sql.includes('SELECT m.ticker,m.event_ticker,m.series_ticker')) response.rows.push({ ...response.rows[0], ticker: 'ADDED-CONTRACT' });
            return response;
        }) as typeof pool.query;
        for (let i = 0; i < 3; i++) {
            const stopped = (await forecastAssessment('stopped-summary-owner', 'FED-0'))!;
            assert.equal(stopped.status, 'unavailable'); assert.ok(stopped.reason!.includes('unsupported_summary_number'));
            assert.ok(stopped.reason!.includes('Automatic retries are stopped')); assert.equal(stopped.retryAt, undefined);
        }
        const modulePath = './forecast-assessment.ts?failure-cache-restart';
        const restarted = await import(modulePath);
        assert.equal((await restarted.forecastAssessment('stopped-summary-owner', 'FED-0')).status, 'unavailable');
        assert.equal(fetches, 1);
        value = 2000;
        assert.equal((await forecastAssessment('stopped-summary-owner', 'FED-0'))!.status, 'pending');
        await finish(); assert.equal(fetches, 2);
    } finally { Date.now = now; pool.query = baseQuery; }
});

it('keeps usable forecasts ready and cached when prose introduces an unsupported number', async () => {
    unsupportedGroups = 1;
    const provider = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        const response = await provider(...args), body = await response.json(), result = JSON.parse(body.choices[0].message.content);
        result.text = 'Invented gain of 999999 dollars.';
        body.choices[0].message.content = JSON.stringify(result); return Response.json(body);
    };
    await forecastAssessments('numeric-without-prose'); await finish();
    const ready = (await forecastAssessments('numeric-without-prose')).assessments[0].assessment;
    assert.equal(ready.status, 'ready'); assert.equal(ready.summary, null); assert.equal(ready.explanationStatus, 'hidden');
    assert.equal(ready.predictions![0].result.changeUsd, 30); assert.equal(ready.predictions![0].result.confidence, 55);
    assert.equal(failureRecords.size, 0); assert.equal(records.size, 1);
    probability = .2;
    const cached = (await forecastAssessments('numeric-without-prose')).assessments[0].assessment;
    assert.equal(cached.generatedAt, ready.generatedAt); assert.equal(cached.summary, null); assert.equal(fetches, 1);
});

it('retries a stopped estimate once only after an explicit owner action, while regular reads remain stopped', async () => {
    unsupportedGroups = 1; confidence = 120;
    await forecastAssessments('manual-retry-owner'); await finish();
    assert.equal((await forecastAssessment('manual-retry-owner', 'FED-0'))!.status, 'unavailable');
    assert.equal(fetches, 1); assert.equal(failureRecords.size, 1);
    assert.equal(await retryForecastAssessment('foreign', 'FED-0'), null); assert.equal(failureRecords.size, 1);
    confidence = 55;
    assert.equal((await forecastAssessment('manual-retry-owner', 'FED-0'))!.status, 'unavailable'); assert.equal(fetches, 1);
    assert.equal((await retryForecastAssessment('manual-retry-owner', 'FED-0'))!.status, 'pending'); await finish();
    assert.equal((await forecastAssessment('manual-retry-owner', 'FED-0'))!.status, 'ready'); assert.equal(fetches, 2);
    assert.equal(failureRecords.size, 0);
    assert.equal((await retryForecastAssessment('manual-retry-owner', 'FED-0'))!.status, 'ready'); assert.equal(fetches, 2);
});
