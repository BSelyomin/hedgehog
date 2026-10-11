import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { digest } from '../auth/session.ts';
import { completedPriceDate } from './price-date.ts';

const original = pool.query;
const owner = '11111111-1111-1111-1111-111111111111', stranger = '22222222-2222-2222-2222-222222222222';
const calls: { sql: string; values: unknown[] }[] = [];
let fail: boolean;
beforeEach(() => {
    fail = false; calls.length = 0;
    pool.query = (async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values }); if (fail) throw new Error('Database failure');
        let rows: unknown[] = [];
        const cutoff = completedPriceDate();
        if (sql.includes('SELECT * FROM holdings') && values[0] === owner) rows = [
            { symbol: 'AAPL', value_usd: '1000.00', updated_at: new Date() },
            { symbol: 'CASH', value_usd: '500.00', asset_type: 'cash', details: {}, updated_at: new Date() }
        ];
        else if (sql.includes('SELECT s.symbol,p.ts,p.close')) rows = ['SPY', 'AAPL'].flatMap(symbol => {
            let close = 100;
            return Array.from({ length: 181 }, (_, i) => {
                close *= 1 + (i % 2 ? .01 : -.01);
                return { symbol, ts: new Date(Date.parse(cutoff) - (180 - i) * 86400000), close, loaded_at: new Date() };
            });
        });
        else if (sql.includes('SELECT symbol,driver,b,se')) rows = [{ symbol: 'AAPL', driver: 'SPY', b: 1.5, se: .1,
            low: 1.304, high: 1.696, days: 250, reliable: true, effect: .015, computed_at: new Date(), price_through: cutoff }];
        else if (sql.includes('WITH relevant AS MATERIALIZED') && (values[0] as string[]).includes('AAPL') && (!values[1] || values[1] === 'OIL-M')) rows = [{
            ticker: 'OIL-M', event_ticker: 'OIL', title: 'Oil outcome', event_title: 'Oil event', close_time: new Date(Date.now() + 86400000),
            tags: ['oil'], ts: new Date(), yes_bid: .7, yes_ask: .9, mid: .01
        }];
        return { rows, rowCount: rows.length };
    }) as typeof pool.query;
});
afterEach(() => { pool.query = original; });
function call(path: string, body?: unknown, guest = owner, extra: Record<string, string> = {}) {
    return request(createApp(), path, { method: body === undefined ? 'GET' : 'POST', body,
        headers: { cookie: `hedgehog_session=${guest}`, 'x-hedgehog-request': '1', 'x-hedgehog-session': digest(guest), ...extra } });
}

it('serves a private value forecast with bounded batched reads and no AI/history-category work', async () => {
    const result = await call('/forecasts'); assert.equal(result.status, 200);
    assert.equal(result.body.totalValue, 1500); assert.equal(result.body.baseline.coveredValue, 1000);
    assert.ok(result.body.baseline.predictedValue !== null); assert.equal(result.body.baseline.excluded[0].symbol, 'CASH');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(calls.length, 3);
    assert.ok(calls.some(c => c.sql.includes('LIMIT 321')));
    assert.ok(!calls.some(c => /ai_cache|settled_markets/.test(c.sql)));
    assert.ok(!(calls.find(c => c.sql.includes('SELECT s.symbol'))!.values[0] as string[]).includes('CASH'));
});
it('calculates scenarios from the current owned portfolio and does not expose it to another guest', async () => {
    const body = { driver: 'SPY', change: 2 };
    const result = await call('/forecasts/scenario', body);
    assert.equal(result.status, 200); assert.equal(result.body.predictedValue, 1030);
    assert.equal((await call('/forecasts', undefined, stranger)).body.totalValue, 0);
    assert.equal((await call('/forecasts/scenario', body, stranger)).body.predictedValue, null);
});
it('returns 400 JSON errors for invalid inputs before reading forecasting data', async () => {
    for (const [path, body] of [['/forecasts/scenario', { driver: 'SPY', change: null }],
        ['/forecasts/event', { marketTicker: 'OIL-M', driver: 'SPY', yesChange: '2', noChange: -2 }]] as const) {
        const result = await call(path, body); assert.equal(result.status, 400); assert.equal(result.body.asOf, null);
    }
    assert.equal(calls.length, 0);
});
it('uses bid–ask midpoint and checks portfolio-linked market membership', async () => {
    const result = await call('/forecasts/event', { marketTicker: 'OIL-M', driver: 'SPY', yesChange: 2, noChange: -2 });
    assert.equal(result.status, 200); assert.equal(result.body.market.probability, .8); assert.equal(result.body.expectedValue, 1018);
    assert.equal((await call('/forecasts/event', { marketTicker: 'FOREIGN-M', driver: 'SPY', yesChange: 2, noChange: -2 })).status, 404);
    assert.deepEqual((await call('/forecasts/events', undefined, stranger)).body.markets, []);
    const sql = calls.find(c => c.sql.includes('WITH relevant'))!.sql;
    assert.ok(sql.includes('reviewed=true') && sql.includes('m.status=\'active\'') && sql.includes('m.ticker=$2'));
});
it('preserves CSRF and stale-session checks for calculation posts', async () => {
    assert.equal((await call('/forecasts/scenario', { driver: 'SPY', change: 1 }, owner, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await call('/forecasts/event', {}, owner, { 'x-hedgehog-session': digest(stranger) })).status, 409);
});
it('returns structured backend failures instead of non-JSON responses', async () => {
    fail = true;
    const result = await call('/forecasts'); assert.equal(result.status, 503);
    assert.equal(typeof result.body.error, 'string'); assert.equal(result.body.asOf, null);
});
