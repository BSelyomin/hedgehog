import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { cachedMoves } from './moves-cache.ts';
import type { MovePrice } from './move-data.ts';

const originalQuery = pool.query, originalNow = Date.now;
const PRICE_SQL = 'SELECT symbols.symbol,p.ts,p.close';
const calls: string[] = [];
const count = (text: string) => calls.filter(sql => sql.includes(text)).length;
let caseNumber = 0, owner: string, now: number, value: number, stockClose: number, odds: number, latestSession: string;
let hasHoldings: boolean, authenticated: boolean, priceFailure: boolean, missingPrices: boolean, pausePrices: (() => Promise<void>) | undefined;
beforeEach(() => {
    owner = `40000000-0000-0000-0000-${String(++caseNumber).padStart(12, '0')}`;
    now = Date.parse('2026-10-10T16:00:00Z'); Date.now = () => now;
    value = 1000; stockClose = 110; odds = .8; latestSession = '2026-10-09';
    hasHoldings = true; authenticated = true; priceFailure = false; missingPrices = false; pausePrices = undefined; calls.length = 0;
    pool.query = (async (sql: string, values: unknown[] = []) => {
        calls.push(sql); let rows: unknown[] = [];
        if (sql.includes('FROM auth_sessions')) rows = authenticated ? [{ id: owner, email: 'cache@example.test', name: 'Cache tester', created_at: new Date(now), expires_at: new Date('2099-01-01') }] : [];
        else if (sql.includes('SELECT * FROM holdings')) rows = hasHoldings ? [{ symbol: 'AAPL', value_usd: String(value), updated_at: new Date('2026-10-01') }] : [];
        else if (sql.includes(PRICE_SQL)) {
            const date = String(values[1] ?? latestSession), back = ({ '1 day': 1, '7 days': 7, '1 month': 30, '3 months': 90 } as Record<string, number>)[String(values[4])];
            const prior = new Date(Date.parse(date) - back * 86400000), fail = priceFailure;
            rows = ['AAPL', 'SPY'].flatMap<MovePrice>(symbol => missingPrices
                ? [{ symbol, role: null, ts: null, close: null, loaded_at: null, price_date: date, has_latest: false }]
                : [{ symbol, role: 'end', ts: new Date(date), close: symbol === 'AAPL' ? stockClose : 110, loaded_at: new Date(now), price_date: date, has_latest: values[1] === null },
                    { symbol, role: 'start', ts: prior, close: 100, loaded_at: new Date(now), price_date: date, has_latest: values[1] === null }]);
            await pausePrices?.();
            if (fail) throw new Error('Price database read failed');
        } else if (sql.includes('SELECT symbol,b,se,days')) rows = [{ symbol: 'AAPL', driver: 'SPY', b: 1, se: .1, days: 250, low: .804, high: 1.196, reliable: true, effect: .01, computed_at: new Date('2026-10-01'), price_through: '2026-10-01' }];
        else if (sql.includes('current.mid AS current_mid')) rows = [{ ticker: 'APPLE-AI', title: 'Will Apple mention AI?', series_ticker: 'AAPL-CALL', event_ticker: 'APPLE-CALL', event_title: 'Apple earnings call', tags: ['AAPL'], current_mid: odds, previous_mid: .4, current_ts: new Date('2026-10-09T19:00:00Z'), previous_ts: new Date('2026-10-08T19:00:00Z') }];
        return { rows, rowCount: rows.length };
    }) as typeof pool.query;
});
afterEach(() => { pool.query = originalQuery; Date.now = originalNow; });

it('reuses Moves across F5 with only a current holdings check and preserves exact totals/source dates', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    const first = await request(app, '/moves?range=day', { headers });
    assert.equal(first.status, 200); assert.equal(first.body.date, '2026-10-09'); assert.equal(first.body.requestedDate, null);
    assert.equal(first.body.total, 90.91); assert.equal(first.body.fromMarket + first.body.beyondMarket, first.body.total);
    assert.equal(first.body.holdings[0].sourceDate, '2026-10-09'); assert.equal(first.body.holdings[0].previousDate, '2026-10-08');
    assert.equal(first.body.movedEvents[0].markets[0].changePoints, 40); assert.equal(calls.length, 6);
    calls.length = 0;
    const again = await request(app, '/moves?range=day', { headers });
    assert.deepEqual(again.body, first.body); assert.equal(calls.length, 1);
    assert.match(String(again.headers['server-timing']), /moves_cache_hit;dur=/);
    assert.match(String(again.headers['server-timing']), /sql_count;desc="1 queries"/);
    assert.equal(again.headers['cache-control'], 'no-store');
});

it('keeps latest-session and explicit dates separate, and normalizes the legacy day query', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    for (const path of ['/moves', '/moves?date=2026-10-09', '/moves?date=2026-10-08']) assert.equal((await request(app, path, { headers })).status, 200);
    assert.equal(count(PRICE_SQL), 3);
    const alias = await request(app, '/moves?day=2026-10-08', { headers });
    assert.equal(alias.body.date, '2026-10-08'); assert.equal(alias.body.requestedDate, '2026-10-08'); assert.equal(count(PRICE_SQL), 3);
    assert.equal((await cachedMoves(owner)).requestedDate, null);
});

it('caches each of the four ranges independently without changing its starting close', async () => {
    for (const range of ['day', 'week', 'month', 'quarter'] as const) {
        const first = await cachedMoves(owner, undefined, range), again = await cachedMoves(owner, undefined, range);
        assert.equal(first.range, range); assert.deepEqual(again, first);
        assert.equal(first.oddsWindow?.from.slice(0, 10), first.startDate);
    }
    assert.equal(count(PRICE_SQL), 4);
    assert.equal((await cachedMoves(owner, undefined, 'week')).startDate, '2026-10-02');
    assert.equal(count(PRICE_SQL), 4);
});

it('invalidates changed holding values even when their update timestamp stays the same', async () => {
    const first = await cachedMoves(owner); value = 2000;
    const changed = await cachedMoves(owner);
    assert.equal(changed.holdings[0].valueUsd, 2000); assert.equal(changed.total, 181.82);
    assert.equal(changed.fromMarket! + changed.beyondMarket!, changed.total);
    assert.equal(first.holdings[0].valueUsd, 1000); assert.equal(count(PRICE_SQL), 2);
});

it('keeps prices/odds/asOf unchanged until expiry or the page Reload header', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    const first = await request(app, '/moves', { headers });
    stockClose = 120; odds = .6; now += 1000;
    assert.deepEqual((await request(app, '/moves', { headers })).body, first.body);
    const fresh = await request(app, '/moves', { headers: { ...headers, 'x-hedgehog-refresh': '1' } });
    assert.equal(fresh.body.total, 166.67); assert.equal(fresh.body.movedEvents[0].markets[0].changePoints, 20);
    assert.equal(fresh.body.asOf, new Date(now).toISOString()); assert.equal(count(PRICE_SQL), 2);
    assert.match(String(fresh.headers['server-timing']), /moves_build;dur=/);
    stockClose = 130; now += 300_000;
    assert.equal((await cachedMoves(owner)).total, 230.77); assert.equal(count(PRICE_SQL), 3);
});

it('resolves a newly loaded latest session on Reload without changing an explicit historical date', async () => {
    now = Date.parse('2026-10-12T22:00:00Z');
    await cachedMoves(owner); await cachedMoves(owner, '2026-10-08');
    latestSession = '2026-10-12';
    assert.equal((await cachedMoves(owner)).date, '2026-10-09');
    assert.equal((await cachedMoves(owner, undefined, 'day', true)).date, '2026-10-12');
    assert.equal((await cachedMoves(owner, '2026-10-08')).date, '2026-10-08'); assert.equal(count(PRICE_SQL), 3);
});

it('rebuilds when another day becomes eligible for completed closes, before TTL expires', async () => {
    now = Date.parse('2026-10-12T20:59:00Z'); latestSession = '2026-10-09';
    assert.equal((await cachedMoves(owner)).date, '2026-10-09');
    now += 60_000; latestSession = '2026-10-12';
    assert.equal((await cachedMoves(owner)).date, '2026-10-12'); assert.equal(count(PRICE_SQL), 2);
});

it('shares simultaneous builds and clones private payloads for each consumer', async () => {
    const [a, b] = await Promise.all([cachedMoves(owner), cachedMoves(owner)]); assert.equal(count(PRICE_SQL), 1);
    a.holdings[0].valueUsd = -1; a.movedEvents[0].markets[0].to = .99;
    assert.equal(b.holdings[0].valueUsd, 1000); assert.equal(b.movedEvents[0].markets[0].to, .8);
    assert.equal((await cachedMoves(owner)).holdings[0].valueUsd, 1000);
});

it('isolates portfolio owners and validates authentication before reading cached data', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}; hedgehog_auth=${'c'.repeat(64)}` };
    assert.equal((await request(app, '/moves', { headers })).status, 200);
    assert.equal((await request(app, '/moves', { headers })).status, 200);
    assert.equal(count(PRICE_SQL), 1); assert.equal(count('FROM auth_sessions'), 2);
    await cachedMoves(`${owner}-other`); assert.equal(count(PRICE_SQL), 2);
    authenticated = false;
    assert.equal((await request(app, '/moves', { headers })).status, 401); assert.equal(count(PRICE_SQL), 2);
});

it('never caches or retries a failed build within the request', async () => {
    priceFailure = true;
    await assert.rejects(cachedMoves(owner), /Price database/); assert.equal(count(PRICE_SQL), 1);
    priceFailure = false; assert.equal((await cachedMoves(owner)).total, 90.91); assert.equal(count(PRICE_SQL), 2);
});

it('prevents late old responses from replacing a newer refreshed snapshot', async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    pausePrices = () => { started(); return new Promise<void>(resolve => { release = resolve; }); };
    const old = cachedMoves(owner); await waiting;
    pausePrices = undefined; stockClose = 120;
    assert.equal((await cachedMoves(owner, undefined, 'day', true)).total, 166.67);
    release(); assert.equal((await old).total, 90.91);
    assert.equal((await cachedMoves(owner)).total, 166.67); assert.equal(count(PRICE_SQL), 2);
});

it('does not remove a fresh snapshot when a superseded producer fails', async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    pausePrices = () => { started(); return new Promise<void>(resolve => { release = resolve; }); };
    priceFailure = true; const old = cachedMoves(owner), rejection = assert.rejects(old, /Price database/); await waiting;
    pausePrices = undefined; priceFailure = false; stockClose = 120;
    await cachedMoves(owner, undefined, 'day', true); release(); await rejection;
    assert.equal((await cachedMoves(owner)).total, 166.67); assert.equal(count(PRICE_SQL), 2);
});

it('bounds retained snapshots and evicts the oldest', async () => {
    await cachedMoves(owner);
    for (let i = 0; i < 32; i++) await cachedMoves(`${owner}-${i}`);
    const builds = count(PRICE_SQL); await cachedMoves(owner); assert.equal(count(PRICE_SQL), builds + 1);
});

it('caches valid unavailable data without fabricating a number, until explicitly reloaded', async () => {
    missingPrices = true;
    const first = await cachedMoves(owner); assert.equal(first.total, null); assert.equal(first.asOf, null);
    missingPrices = false;
    assert.deepEqual(await cachedMoves(owner), first); assert.equal(count(PRICE_SQL), 1);
    assert.equal((await cachedMoves(owner, undefined, 'day', true)).total, 90.91);
});

it('handles empty portfolios without scanning prices, and rebuilds when holdings are added', async () => {
    hasHoldings = false; assert.deepEqual((await cachedMoves(owner)).holdings, []);
    await cachedMoves(owner); assert.equal(count(PRICE_SQL), 0);
    hasHoldings = true; assert.equal((await cachedMoves(owner)).total, 90.91); assert.equal(count(PRICE_SQL), 1);
});

it('rejects invalid dates and ranges before querying a portfolio', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    for (const query of ['date=2026-02-30', 'date=bad', 'range=year', 'range=day&range=week']) assert.equal((await request(app, `/moves?${query}`, { headers })).status, 400);
    assert.equal(calls.length, 0);
});

it('invalidates when imported brokerage values change independently of manual holdings', async () => {
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
        assert.equal((await cachedMoves(account)).holdings[0].valueUsd, 1500);
        importedValue = 800;
        assert.equal((await cachedMoves(account)).holdings[0].valueUsd, 1800); assert.equal(count(PRICE_SQL), 2);
    } finally {
        pool.query = manualQuery;
        names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
    }
});
