import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool, aiPool } from '../db.ts';
import { cachedForecastAssessment as forecastAssessment, cachedForecastAssessments as forecastAssessments,
    cachedRetryForecastAssessment as retryForecastAssessment, cachedRankedForecasts as rankedForecasts,
    cachedForecasts, cachedForecastMarkets, cachedForecastResult } from './forecasts-cache.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { digest } from '../auth/session.ts';
import { completedPriceDate } from './price-date.ts';

const originalNow = Date.now;
const originalQuery = pool.query, originalConnect = aiPool.connect, originalFetch = globalThis.fetch;
const names = ['SNOWFLAKE_ACCOUNT_URL', 'SNOWFLAKE_PAT', 'SNOWFLAKE_CORTEX_MODEL'];
const originalEnv = names.map(name => process.env[name]);
const records = new Map<string, { value: unknown; created_at: Date }>();
const failureRecords = new Map<string, { value: unknown; created_at: Date }>();
let value = 1000, probability = .7, fetches = 0, unsupportedGroups = 0, confidence = 55;
let caseNumber = 0, owner: string, now: number, quoteTime: Date, referenceLevel: number, closeSoon: Date | null, priceFailure: boolean, hasHoldings: boolean, authenticated: boolean;
const calls: string[] = [];
const count = (text: string) => calls.filter(sql => sql.includes(text)).length;
let pauseRanks: (() => Promise<void>) | undefined;
let releaseProviders: (() => void)[] = [];
beforeEach(() => {
    owner = `50000000-0000-0000-0000-${String(++caseNumber).padStart(12, '0')}`;
    now = Date.parse('2026-10-10T16:00:00Z'); Date.now = () => now; quoteTime = new Date(now);
    closeSoon = null; referenceLevel = 5000; priceFailure = false; hasHoldings = true; authenticated = true; pauseRanks = undefined; calls.length = 0;
    records.clear(); failureRecords.clear(); value = 1000; probability = .7; fetches = 0; unsupportedGroups = 0; confidence = 55; releaseProviders = [];
    process.env.SNOWFLAKE_ACCOUNT_URL = 'https://forecast-test.snowflakecomputing.com';
    process.env.SNOWFLAKE_PAT = 'local-test-value'; process.env.SNOWFLAKE_CORTEX_MODEL = 'test-model';
    const execute = async (sql: string, args: unknown[] = []) => {
        calls.push(sql);
        if (priceFailure && sql.includes('SELECT s.symbol,p.ts')) throw new Error('Price database read failed');
        let rows: unknown[] = []; const cutoff = completedPriceDate(new Date(now)), key = `${args[0]}:${args[1]}`;
        const storage = args[0] === 'forecast-failure-v1' ? failureRecords : records;
        if (sql.startsWith('SELECT value,created_at')) rows = storage.has(key) ? [storage.get(key)] : [];
        else if (sql.startsWith('DELETE FROM ai_cache')) storage.delete(key);
        else if (sql.startsWith('INSERT INTO ai_cache')) { const row = { value: JSON.parse(String(args[2])), created_at: new Date(now) }; storage.set(key, row); rows = [row]; }
        else if (sql.includes('FROM auth_sessions')) rows = authenticated ? [{ id: owner, email: 'cache@example.test', name: 'Cache tester', created_at: new Date(now), expires_at: new Date('2099-01-01') }] : [];
        else if (sql.includes('SELECT * FROM holdings') && args[0] !== 'foreign' && hasHoldings) rows = [{ symbol: 'AAA', value_usd: String(value), updated_at: new Date(now) }];
        else if (sql.includes('SELECT s.symbol,p.ts')) rows = ['SPY', 'AAA', '^GSPC'].map(symbol => ({ symbol, ts: new Date(cutoff), close: symbol === '^GSPC' ? referenceLevel : 100, loaded_at: new Date(now) }));
        else if (sql.includes('SELECT symbol,driver,b,se')) rows = [{ symbol: 'AAA', driver: 'SPY', b: 1.5, se: .1, low: 1.304, high: 1.696, days: 250, reliable: true, effect: .015, price_through: cutoff, computed_at: new Date(now) }];
        else if (unsupportedGroups && sql.includes('GROUP BY e.ticker,r.tags')) rows = Array.from({ length: unsupportedGroups }, (_, i) => ({ ticker: `FED-${i}`, series_ticker: `TEST-POLICY-${i}`, title: `Policy decision ${i}`, description: 'Federal Reserve decision', category: 'Economics',
            tags: ['fed-rates'], linked_symbols: ['AAA'], close_time: closeSoon ?? new Date(Date.parse(cutoff) + (4 + i) * 86400000), occurrence_time: null, expected_expiration_time: null, strike_date: null }));
        else if (unsupportedGroups && sql.includes('SELECT m.ticker,m.event_ticker,m.series_ticker')) rows = Array.from({ length: unsupportedGroups }, (_, i) => ({ ticker: `FED-${i}-M`, event_ticker: `FED-${i}`, series_ticker: `TEST-POLICY-${i}`, title: 'Policy cut', event_title: `Policy decision ${i}`,
            tags: ['fed-rates'], linked_symbols: ['AAA'], close_time: closeSoon ?? new Date(Date.parse(cutoff) + (4 + i) * 86400000), ts: quoteTime, yes_bid: probability - .1, yes_ask: probability + .1, strike_type: null, floor_strike: null, cap_strike: null }));
        else if (sql.includes('GROUP BY e.ticker,r.tags')) rows = ['KXINX', 'KXINXU', 'KXINXDUD'].map((series, i) => ({ ticker: `${series}-E`, series_ticker: series, title: 'S&P close', description: '', category: 'Indices',
            tags: ['sp500'], linked_symbols: ['AAA'], close_time: closeSoon ?? new Date(Date.parse(cutoff) + (4 + i) * 86400000 + 20 * 3600000), occurrence_time: null, expected_expiration_time: null, strike_date: null }));
        else if (sql.includes('SELECT m.ticker,m.event_ticker,m.series_ticker')) rows = ['KXINX', 'KXINXU', 'KXINXDUD'].map((series, i) => ({ ticker: `${series}-M`, event_ticker: `${series}-E`, series_ticker: series, title: 'S&P result', event_title: 'S&P close',
            tags: ['sp500'], linked_symbols: ['AAA'], close_time: closeSoon ?? new Date(Date.parse(cutoff) + (4 + i) * 86400000 + 20 * 3600000), ts: quoteTime, yes_bid: probability - .1, yes_ask: probability + .1,
            strike_type: series === 'KXINX' ? 'between' : 'greater', floor_strike: 5100, cap_strike: series === 'KXINX' ? 5200 : null }));
        if (sql.includes('SELECT m.ticker,m.event_ticker,m.series_ticker') && args[1]) {
            if (/^KXINX-M-\d+$/.test(String(args[1]))) rows = [{ ...rows[0] as object, ticker: args[1] }];
            else rows = rows.filter(row => (row as { ticker: string }).ticker === args[1]);
        }
        if (sql.includes('ORDER BY m.close_time,m.ticker')) rows = [{ ticker: 'KXINX-M', event_ticker: 'KXINX-E', title: 'S&P result', event_title: 'S&P close', close_time: closeSoon ?? new Date(now + 86400000), tags: ['sp500'], ts: quoteTime, yes_bid: probability - .1, yes_ask: probability + .1 }];
        if (sql.includes('GROUP BY e.ticker,r.tags')) await pauseRanks?.();
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
            assert.equal(input.drivers[0].unit, 'percent');
        }
        await new Promise<void>(resolve => { releaseProviders.push(resolve); });
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ selectedMarketTicker: input.markets[0].marketTicker,
            text: assumptions.length ? 'A modest market rise is a tentative assumption for this outcome; uncertainty remains high.' : 'This range supports a positive measured portfolio contribution using a market proxy. Other risks remain unmodeled.',
            sourceIds: input.sources.filter((s: { id: string }) => ['event-0', 'price-0'].includes(s.id)).map((s: { id: string }) => s.id), assumptions, jointForecasts }) } }] });
    };
});
afterEach(async () => {
    releaseProviders.forEach(release => release()); releaseProviders = [];
    await new Promise(resolve => setTimeout(resolve, 10)); Date.now = originalNow;
    pool.query = originalQuery; aiPool.connect = originalConnect; globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (originalEnv[i] === undefined) delete process.env[name]; else process.env[name] = originalEnv[i]; });
});
async function finish() {
    for (let i = 0; i < 20 && !releaseProviders.length; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(releaseProviders.length); const releases = releaseProviders; releaseProviders = []; releases.forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 10));
}

const paths = ['/forecasts', '/forecasts/events', '/forecasts/ranked-events', '/forecasts/result/KXINX-M', '/forecasts/assessments', '/forecasts/assessment/KXINX-E'];

it('caches every Forecasts GET across F5 while checking current holdings and preserving source data', async () => {
    delete process.env.SNOWFLAKE_PAT;
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` }, bodies: unknown[] = [];
    for (const path of paths) {
        const result = await request(app, path, { headers }); assert.equal(result.status, 200); bodies.push(result.body);
    }
    calls.length = 0;
    for (const [i, path] of paths.entries()) {
        const result = await request(app, path, { headers }); assert.deepEqual(result.body, bodies[i]);
        assert.match(String(result.headers['server-timing']), /forecasts_cache_hit;dur=/);
        assert.match(String(result.headers['server-timing']), /sql_count;desc="1 queries"/);
        assert.equal(result.headers['cache-control'], 'no-store');
    }
    assert.equal(calls.length, paths.length); assert.equal(fetches, 0);
});

it('shares short-history models between ranking, result detail and assessments without loading baseline history', async () => {
    delete process.env.SNOWFLAKE_PAT;
    await rankedForecasts(owner); await cachedForecastResult(owner, 'KXINX-M'); await forecastAssessments(owner);
    assert.equal(count('SELECT s.symbol,p.ts'), 1); assert.equal(count('GROUP BY e.ticker,r.tags'), 1);
    assert.ok(!calls.some(sql => sql.includes('LIMIT 321')));
    await cachedForecasts(owner); assert.equal(count('SELECT s.symbol,p.ts'), 2);
    await cachedForecasts(owner); assert.equal(count('SELECT s.symbol,p.ts'), 2);
});

it('invalidates changed holding contents without relying on ingestion timestamps', async () => {
    assert.equal((await rankedForecasts(owner)).totalValue, 1000); value = 2000;
    const changed = await rankedForecasts(owner); assert.equal(changed.totalValue, 2000);
    assert.equal(changed.events[0].outcomes.find(m => m.ticker === 'KXINX-M')!.result.changeUsd, 90);
    assert.equal(count('GROUP BY e.ticker,r.tags'), 2);
});

it('explicit Reload refreshes the shared snapshot but preserves successful persistent AI estimates', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    await request(app, '/forecasts/ranked-events', { headers });
    await forecastAssessments(owner); await finish(); const ready = await forecastAssessments(owner);
    probability = .3; now += 1000; quoteTime = new Date(now);
    assert.equal((await rankedForecasts(owner)).events[0].outcomes[0].probability, .7);
    const fresh = await request(app, '/forecasts/ranked-events', { headers: { ...headers, 'x-hedgehog-refresh': '1' } });
    assert.equal(fresh.status, 200); assert.ok(Math.abs(fresh.body.events[0].outcomes[0].probability - .3) < 1e-12);
    const next = await forecastAssessments(owner);
    assert.equal(next.assessments[0].assessment.generatedAt, ready.assessments[0].assessment.generatedAt);
    assert.equal(next.assessments[0].assessment.jointPrediction!.result.changeUsd, 15); assert.equal(fetches, 1);
    assert.equal(count('GROUP BY e.ticker,r.tags'), 2);
    assert.match(String(fresh.headers['server-timing']), /forecasts_build;dur=/);
    now += 300_000; await rankedForecasts(owner); assert.equal(count('GROUP BY e.ticker,r.tags'), 2);
    now += 899_999; await rankedForecasts(owner); assert.equal(count('GROUP BY e.ticker,r.tags'), 2);
    now += 2_400_001; await rankedForecasts(owner); assert.equal(count('GROUP BY e.ticker,r.tags'), 3);
});

it('never freezes pending AI results, and polling reuses the model/rank snapshot', async () => {
    const first = await forecastAssessments(owner); assert.equal(first.assessments[0].assessment.status, 'pending');
    const second = await forecastAssessments(owner); assert.equal(second.assessments[0].assessment.status, 'pending');
    assert.equal(fetches, 1); assert.equal(count('GROUP BY e.ticker,r.tags'), 1); assert.equal(count('SELECT s.symbol,p.ts'), 1);
    await finish(); const ready = await forecastAssessments(owner); assert.equal(ready.assessments[0].assessment.status, 'ready');
    calls.length = 0; assert.deepEqual(await forecastAssessments(owner), ready); assert.equal(calls.length, 1);
});

it('keeps stopped failures stopped on Reload/expiry and invalidates terminal status only on manual Retry estimate', async () => {
    unsupportedGroups = 1; confidence = 120;
    await forecastAssessments(owner); await finish();
    assert.equal((await forecastAssessments(owner)).assessments[0].assessment.status, 'unavailable');
    assert.equal((await forecastAssessment(owner, 'FED-0'))!.status, 'unavailable');
    await forecastAssessments(owner, true); now += 3_600_000;
    assert.equal((await forecastAssessments(owner)).assessments[0].assessment.status, 'unavailable'); assert.equal(fetches, 1);
    confidence = 55;
    const retry = await request(createApp(), '/forecasts/assessment/FED-0', { method: 'POST', body: {},
        headers: { cookie: `hedgehog_session=${owner}`, 'x-hedgehog-request': '1', 'x-hedgehog-session': digest(owner) } });
    assert.equal(retry.status, 200); assert.equal(retry.body.status, 'pending');
    assert.equal((await forecastAssessments(owner)).assessments[0].assessment.status, 'pending');
    await finish(); assert.equal((await forecastAssessments(owner)).assessments[0].assessment.status, 'ready');
    assert.equal((await forecastAssessment(owner, 'FED-0'))!.status, 'ready'); assert.equal(fetches, 2);
});

it('changed holdings allow a new AI assessment while unchanged quotes do not', async () => {
    unsupportedGroups = 1; await forecastAssessments(owner); await finish(); await forecastAssessments(owner);
    value = 2000;
    assert.equal((await forecastAssessments(owner)).assessments[0].assessment.status, 'pending');
    await finish();
    assert.equal((await forecastAssessments(owner)).assessments[0].assessment.predictions![0].result.changeUsd, 60); assert.equal(fetches, 2);
});

it('shares simultaneous ranking builds and isolates mutable payloads', async () => {
    const [a, b] = await Promise.all([rankedForecasts(owner), rankedForecasts(owner)]);
    assert.equal(count('GROUP BY e.ticker,r.tags'), 1); assert.equal(count('SELECT s.symbol,p.ts'), 1);
    a.events[0].outcomes[0].probability = .99; a.events[0].linkedValue = -1;
    assert.equal(b.events[0].linkedValue, 1000); assert.equal((await rankedForecasts(owner)).events[0].outcomes[0].probability, .7);
});

it('isolates owners and validates authentication before cached forecast reads', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}; hedgehog_auth=${'d'.repeat(64)}` };
    assert.equal((await request(app, '/forecasts/ranked-events', { headers })).status, 200);
    assert.equal((await request(app, '/forecasts/ranked-events', { headers })).status, 200);
    assert.equal(count('GROUP BY e.ticker,r.tags'), 1); assert.equal(count('FROM auth_sessions'), 2);
    await rankedForecasts(`${owner}-other`); assert.equal(count('GROUP BY e.ticker,r.tags'), 2);
    authenticated = false;
    assert.equal((await request(app, '/forecasts/ranked-events', { headers })).status, 401); assert.equal(count('GROUP BY e.ticker,r.tags'), 2);
});

it('does not cache failed model builds or retry within a read', async () => {
    priceFailure = true;
    await assert.rejects(rankedForecasts(owner), /Price database/); assert.equal(count('SELECT s.symbol,p.ts'), 1);
    priceFailure = false; assert.equal((await rankedForecasts(owner)).totalValue, 1000); assert.equal(count('SELECT s.symbol,p.ts'), 2);
});

it('prevents older in-flight ranking responses from overwriting a newer refresh', async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    pauseRanks = () => { started(); return new Promise<void>(resolve => { release = resolve; }); };
    const old = rankedForecasts(owner); await waiting;
    pauseRanks = undefined; referenceLevel = 10000;
    const change = (data: Awaited<ReturnType<typeof rankedForecasts>>) => data.events[0].outcomes.find(m => m.ticker === 'KXINX-M')!.result.changeUsd;
    const fresh = await rankedForecasts(owner, true); assert.equal(change(fresh), -727.5);
    release(); assert.equal(change(await old), 45); assert.equal(change(await rankedForecasts(owner)), -727.5);
});

it('coalesces concurrent explicit tool refreshes into one shared portfolio snapshot', async () => {
    await rankedForecasts(owner); calls.length = 0;
    await Promise.all([cachedForecasts(owner, true), cachedForecastMarkets(owner, true)]);
    await rankedForecasts(owner);
    assert.equal(count('SELECT s.symbol,p.ts'), 1); assert.equal(count('GROUP BY e.ticker,r.tags'), 1);
});

it('keeps individual assessment status live until it completes', async () => {
    assert.equal((await forecastAssessment(owner, 'KXINX-E'))!.status, 'pending');
    assert.equal((await forecastAssessment(owner, 'KXINX-E'))!.status, 'pending'); assert.equal(fetches, 1);
    await finish(); const ready = await forecastAssessment(owner, 'KXINX-E'); assert.equal(ready!.status, 'ready');
    calls.length = 0; assert.deepEqual(await forecastAssessment(owner, 'KXINX-E'), ready); assert.equal(calls.length, 1);
});

it('bounds retained per-market result reads without losing the shared model', async () => {
    await cachedForecastResult(owner, 'KXINX-M-0');
    for (let i = 1; i <= 128; i++) await cachedForecastResult(owner, `KXINX-M-${i}`);
    const results = count('m.ticker=$2'); await cachedForecastResult(owner, 'KXINX-M-0');
    assert.equal(count('m.ticker=$2'), results + 1); assert.equal(count('SELECT s.symbol,p.ts'), 1);
});

it('does not retain missing results and bounds cached portfolio snapshots', async () => {
    assert.equal(await cachedForecastResult(owner, 'FOREIGN'), null); const reads = count('m.ticker=$2');
    await cachedForecastResult(owner, 'FOREIGN'); assert.equal(count('m.ticker=$2'), reads + 1);
    await rankedForecasts(owner);
    for (let i = 0; i < 32; i++) await rankedForecasts(`${owner}-${i}`);
    const builds = count('GROUP BY e.ticker,r.tags'); await rankedForecasts(owner); assert.equal(count('GROUP BY e.ticker,r.tags'), builds + 1);
});

it('expires before a cached contract closes or its probability exceeds the existing quote-age limit', async () => {
    quoteTime = new Date(now - 29 * 60_000);
    assert.equal((await rankedForecasts(owner)).events[0].outcomes[0].probability, .7);
    now += 2 * 60_000;
    assert.equal((await rankedForecasts(owner)).events[0].outcomes[0].probability, null); assert.equal(count('GROUP BY e.ticker,r.tags'), 2);
    const account = `${owner}-close`; quoteTime = new Date(now); closeSoon = new Date(now + 60_000);
    await rankedForecasts(account); now += 60_000; await rankedForecasts(account);
    assert.equal(count('GROUP BY e.ticker,r.tags'), 4);
});

it('invalidates terminal unconfigured status when Snowflake configuration changes', async () => {
    delete process.env.SNOWFLAKE_PAT;
    assert.equal((await forecastAssessments(owner)).assessments[0].assessment.status, 'unavailable');
    process.env.SNOWFLAKE_PAT = 'local-test-value';
    assert.equal((await forecastAssessments(owner)).assessments[0].assessment.status, 'pending');
    await finish(); assert.equal((await forecastAssessments(owner)).assessments[0].assessment.status, 'ready');
});

it('advances the completed-price cutoff before the cache TTL expires', async () => {
    now = Date.parse('2026-10-12T20:59:00Z'); quoteTime = new Date(now);
    await rankedForecasts(owner); now += 60_000; await rankedForecasts(owner);
    assert.equal(count('SELECT s.symbol,p.ts'), 2);
});

it('invalidates imported brokerage changes independently of manual holdings', async () => {
    const settings = ['SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY', 'SNAPTRADE_ENCRYPTION_KEY', 'SNAPTRADE_MODE', 'APP_URL'];
    const saved = settings.map(name => process.env[name]), manualQuery = pool.query; let importedValue = 500;
    try {
        process.env.SNAPTRADE_CLIENT_ID = 'fixture-client'; process.env.SNAPTRADE_CONSUMER_KEY = 'fixture-key';
        process.env.SNAPTRADE_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
        process.env.SNAPTRADE_MODE = 'sandbox'; process.env.APP_URL = 'http://localhost:3000';
        pool.query = (async (sql: string, values: unknown[]) => {
            if (sql.includes('FROM brokerage_holdings')) {
                calls.push(sql); return { rows: [{ symbol: 'AAA', value_usd: String(importedValue), updated_at: new Date(now) }], rowCount: 1 };
            }
            return manualQuery(sql, values);
        }) as typeof pool.query;
        const account = `user:${owner}`;
        assert.equal((await rankedForecasts(account)).totalValue, 1500); importedValue = 800;
        assert.equal((await rankedForecasts(account)).totalValue, 1800); assert.equal(count('GROUP BY e.ticker,r.tags'), 2);
    } finally {
        pool.query = manualQuery;
        settings.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
    }
});
