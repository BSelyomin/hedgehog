import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { cachedExposure, calendar } from './exposure.ts';

const originalQuery = pool.query, originalNow = Date.now;
let caseNumber = 0, owner: string, now: number, value: number, probability: number, timestamp: Date;
let marketFailure: boolean, authenticated: boolean, pauseMarket: (() => Promise<void>) | undefined;
const calls: string[] = [];
const count = (text: string) => calls.filter(sql => sql.includes(text)).length;
beforeEach(() => {
    owner = `30000000-0000-0000-0000-${String(++caseNumber).padStart(12, '0')}`;
    now = Date.parse('2026-10-10T16:00:00Z'); Date.now = () => now;
    value = 1000; probability = .4; timestamp = new Date(now);
    marketFailure = false; authenticated = true; pauseMarket = undefined; calls.length = 0;
    pool.query = (async (sql: string) => {
        calls.push(sql); let rows: unknown[] = [];
        if (sql.includes('FROM auth_sessions')) rows = authenticated ? [{ id: owner, email: 'cache@example.test', name: 'Cache tester', created_at: new Date(now), expires_at: new Date('2099-01-01') }] : [];
        else if (sql.includes('SELECT * FROM holdings')) rows = [{ symbol: 'AAPL', value_usd: String(value), updated_at: new Date('2026-10-01') }];
        else if (sql.includes('SELECT m.*')) {
            const fail = marketFailure;
            rows = [60, 4, 14].map(days => ({
                ticker: `CALL-${days}-AI`, event_ticker: `CALL-${days}`, event_title: `Apple earnings call in ${days} days`, event_description: '',
                series_ticker: 'AAPL-CALL', category: 'Mentions', title: 'Will Apple mention AI?', subtitle: 'AI', mutually_exclusive: false,
                close_time: new Date(now + (days + 1) * 86400000), occurrence_time: new Date(now + days * 86400000),
                ts: timestamp, yes_bid: probability - .01, yes_ask: probability + .01, mid: probability, volume_24h: 1000, open_interest: 1000
            }));
            await pauseMarket?.();
            if (fail) throw new Error('Market database read failed');
        } else if (sql.includes('SELECT series_ticker,tag')) rows = [{ series_ticker: 'AAPL-CALL', tag: 'AAPL' }];
        return { rows, rowCount: rows.length };
    }) as typeof pool.query;
});
afterEach(() => { pool.query = originalQuery; Date.now = originalNow; });

it('reuses one backend snapshot across F5 requests, every date window and All future dates', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    const first = await request(app, '/calendar?days=14', { headers });
    assert.equal(first.status, 200); assert.deepEqual(first.body.events.map((e: { ticker: string }) => e.ticker), ['CALL-4', 'CALL-14']);
    calls.length = 0;
    const again = await request(app, '/calendar?days=14', { headers });
    assert.deepEqual(again.body, first.body);
    for (const [days, expected] of [[1, 0], [7, 1], [14, 2], [30, 2], [90, 3]]) {
        const result = await request(app, `/calendar?days=${days}`, { headers });
        assert.equal(result.body.days, days); assert.equal(result.body.events.length, expected);
    }
    const all = await request(app, '/exposure', { headers });
    assert.equal(all.body.events.length, 3); assert.equal(all.body.totalValue, 1000);
    assert.equal(count('SELECT m.*'), 0); assert.equal(calls.length, 7);
    assert.match(String(again.headers['server-timing']), /exposure_cache_hit;dur=/);
    assert.match(String(all.headers['server-timing']), /sql_count;desc="1 queries"/);
    assert.equal(again.headers['cache-control'], 'no-store');
});

it('invalidates on changed holding contents even if their update timestamp is unchanged', async () => {
    assert.equal((await calendar(owner, 14)).events[0].linkedValue, 1000);
    value = 2000;
    assert.equal((await calendar(owner, 14)).events[0].linkedValue, 2000);
    assert.equal((await cachedExposure(owner)).totalValue, 2000); assert.equal(count('SELECT m.*'), 2);
});

it('keeps quotes and source timestamps until expiry, and Reload refreshes both endpoints', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    const first = await request(app, '/calendar?days=14', { headers });
    probability = .8; timestamp = new Date(now + 1000);
    assert.deepEqual((await request(app, '/calendar?days=14', { headers })).body, first.body);
    const fresh = await request(app, '/calendar?days=7', { headers: { ...headers, 'x-hedgehog-refresh': '1' } });
    assert.equal(fresh.body.events[0].markets[0].probability, .8); assert.equal(fresh.body.asOf, timestamp.toISOString());
    assert.equal((await request(app, '/exposure', { headers })).body.events[0].markets[0].probability, .8);
    assert.equal(count('SELECT m.*'), 2);
    probability = .6;
    await request(app, '/exposure', { headers: { ...headers, 'x-hedgehog-refresh': '1' } });
    assert.equal((await calendar(owner, 14)).events[0].markets[0].probability, .6);
    assert.equal(count('SELECT m.*'), 3);
    now += 300_000; await calendar(owner, 14); assert.equal(count('SELECT m.*'), 3);
    now += 3_299_999; await calendar(owner, 14); assert.equal(count('SELECT m.*'), 3);
    now++; await calendar(owner, 14); assert.equal(count('SELECT m.*'), 4);
});

it('coalesces simultaneous windows and clones snapshots for each consumer', async () => {
    const [week, fortnight, all] = await Promise.all([calendar(owner, 7), calendar(owner, 14), cachedExposure(owner)]);
    assert.equal(count('SELECT m.*'), 1);
    week.events[0].markets[0].probability = .99; week.events[0].links[0].valueUsd = -1;
    assert.equal(fortnight.events[0].markets[0].probability, .4);
    assert.equal(all.events.find(e => e.ticker === 'CALL-4')?.links[0].valueUsd, 1000);
    assert.equal((await calendar(owner, 7)).events[0].markets[0].probability, .4);
});

it('keeps matching portfolios isolated by owner and still validates authentication', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}; hedgehog_auth=${'b'.repeat(64)}` };
    assert.equal((await request(app, '/calendar', { headers })).status, 200);
    assert.equal((await request(app, '/calendar', { headers })).status, 200);
    assert.equal(count('SELECT m.*'), 1); assert.equal(count('FROM auth_sessions'), 2);
    await calendar(`${owner}-other`, 14); assert.equal(count('SELECT m.*'), 2);
    authenticated = false;
    assert.equal((await request(app, '/calendar', { headers })).status, 401); assert.equal(count('SELECT m.*'), 2);
});

it('does not cache errors or retry failed reads within a request', async () => {
    marketFailure = true;
    await assert.rejects(calendar(owner, 14), /Market database/); assert.equal(count('SELECT m.*'), 1);
    marketFailure = false;
    assert.equal((await calendar(owner, 14)).events.length, 2); assert.equal(count('SELECT m.*'), 2);
});

it('prevents an older in-flight build from overwriting an explicit refresh', async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    pauseMarket = () => { started(); return new Promise<void>(resolve => { release = resolve; }); };
    const old = calendar(owner, 14); await waiting;
    pauseMarket = undefined; probability = .8;
    const fresh = await calendar(owner, 14, true); assert.equal(fresh.events[0].markets[0].probability, .8);
    release(); assert.equal((await old).events[0].markets[0].probability, .4);
    assert.equal((await calendar(owner, 14)).events[0].markets[0].probability, .8); assert.equal(count('SELECT m.*'), 2);
});

it('does not evict a fresh snapshot when a superseded build fails', async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    pauseMarket = () => { started(); return new Promise<void>(resolve => { release = resolve; }); };
    marketFailure = true; const old = calendar(owner, 14); const rejection = assert.rejects(old, /Market database/); await waiting;
    pauseMarket = undefined; marketFailure = false; probability = .8;
    await calendar(owner, 14, true); release(); await rejection;
    assert.equal((await calendar(owner, 14)).events[0].markets[0].probability, .8); assert.equal(count('SELECT m.*'), 2);
});

it('bounds retained portfolio snapshots and evicts the oldest', async () => {
    await calendar(owner, 14);
    for (let i = 0; i < 32; i++) await calendar(`${owner}-${i}`, 14);
    const builds = count('SELECT m.*'); await calendar(owner, 14); assert.equal(count('SELECT m.*'), builds + 1);
});

it('rebuilds across the New York date boundary even before the one-hour expiry', async () => {
    now = Date.parse('2026-10-11T03:59:00Z'); timestamp = new Date(now);
    await calendar(owner, 14);
    now += 60_000; await calendar(owner, 14);
    assert.equal(count('SELECT m.*'), 2);
});

it('recalculates a rolling date window without rebuilding the underlying snapshot', async () => {
    const fixtureQuery = pool.query;
    pool.query = (async (sql: string, values: unknown[]) => {
        const result = await fixtureQuery(sql, values);
        if (sql.includes('SELECT m.*')) result.rows.find(row => row.event_ticker === 'CALL-14').occurrence_time = new Date(now + 14 * 86400000 + 30_000);
        return result;
    }) as typeof pool.query;
    assert.equal((await calendar(owner, 14)).events.length, 1);
    now += 60_000;
    assert.equal((await calendar(owner, 14)).events.length, 2); assert.equal(count('SELECT m.*'), 1);
});

it('rejects invalid date windows before building a snapshot', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    for (const days of ['0', '91', '1.5', 'bad']) assert.equal((await request(app, `/calendar?days=${days}`, { headers })).status, 400);
    assert.equal(calls.length, 0);
});

it('invalidates when imported brokerage values change without a manual holding edit', async () => {
    const names = ['SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY', 'SNAPTRADE_ENCRYPTION_KEY', 'SNAPTRADE_MODE', 'APP_URL'];
    const saved = names.map(name => process.env[name]), manualQuery = pool.query; let importedValue = 500;
    try {
        process.env.SNAPTRADE_CLIENT_ID = 'fixture-client'; process.env.SNAPTRADE_CONSUMER_KEY = 'fixture-key';
        process.env.SNAPTRADE_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
        process.env.SNAPTRADE_MODE = 'sandbox'; process.env.APP_URL = 'http://localhost:3000';
        pool.query = (async (sql: string, values: unknown[]) => {
            if (sql.includes('FROM brokerage_holdings')) {
                calls.push(sql);
                return { rows: [{ symbol: 'AAPL', value_usd: String(importedValue), updated_at: new Date('2026-10-01') }], rowCount: 1 };
            }
            return manualQuery(sql, values);
        }) as typeof pool.query;
        const account = `user:${owner}`;
        assert.equal((await calendar(account, 14)).events[0].linkedValue, 1500);
        importedValue = 800;
        assert.equal((await calendar(account, 14)).events[0].linkedValue, 1800); assert.equal(count('SELECT m.*'), 2);
    } finally {
        pool.query = manualQuery;
        names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
    }
});
