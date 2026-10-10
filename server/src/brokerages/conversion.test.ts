import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { convertSnapTradeActivities } from './activities.ts';
import { convertSnapTradePositions, positionsToHoldings } from './positions.ts';
import { pool } from '../db.ts';
import { accountActivities } from './service.ts';
import { configuration, encryptSecret, signature } from './client.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { digest } from '../auth/session.ts';

const providerPosition = { instrument: { kind: 'stock', id: randomUUID(), symbol: 'AAPL', raw_symbol: 'AAPL', currency: 'USD', exchange: 'XNAS' },
    units: '10.5', price: '123.45', cost_basis: '118.2', currency: 'USD', cash_equivalent: false };
const providerActivity = { id: 'trade-1', type: 'BUY', symbol: { symbol: 'AAPL', raw_symbol: 'AAPL' },
    units: 10.5, price: 123.45, amount: -1296.225, currency: { code: 'USD', name: 'US Dollar' }, fee: 0,
    trade_date: '2026-06-01T14:30:00Z', settlement_date: '2026-06-02T00:00:00Z', description: 'Bought AAPL' };
const userId = randomUUID(), accountId = randomUUID(), token = 'c'.repeat(64);
const originalQuery = pool.query, originalConnect = pool.connect, originalFetch = globalThis.fetch;
const envNames = ['SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY', 'SNAPTRADE_ENCRYPTION_KEY', 'SNAPTRADE_MODE', 'APP_URL'];
const originalEnv = envNames.map(key => process.env[key]);
let owned = true;
const calls: { sql: string; values: unknown[] }[] = [];
beforeEach(() => {
    process.env.SNAPTRADE_CLIENT_ID = 'commercial-test'; process.env.SNAPTRADE_CONSUMER_KEY = 'test-key';
    process.env.SNAPTRADE_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64'); process.env.SNAPTRADE_MODE = 'sandbox'; process.env.APP_URL = 'http://localhost:3000';
    owned = true; calls.length = 0;
    const execute = async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        const rows = sql.includes('pg_try_advisory_lock') ? [{ locked: true }] :
            sql.includes('JOIN users') ? [{ id: userId, email: 'alex@example.com', name: 'Alex', created_at: new Date(), expires_at: new Date(Date.now() + 86400000) }] :
            sql.includes('SELECT a.id FROM brokerage_accounts') ? owned ? [{ id: accountId }] : [] :
            sql.includes('SELECT * FROM snaptrade_users') ? [{ provider_user_id: 'provider-user', encrypted_secret: encryptSecret('provider-secret', `${userId}:sandbox`), client_hash: configuration().clientHash }] : [];
        return { rows, rowCount: rows.length };
    };
    pool.query = execute as typeof pool.query;
    pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
});
afterEach(() => {
    pool.query = originalQuery; pool.connect = originalConnect; globalThis.fetch = originalFetch;
    envNames.forEach((name, i) => { if (originalEnv[i] === undefined) delete process.env[name]; else process.env[name] = originalEnv[i]; });
});
it('converts the documented decimal-string position into the internal holding contract', () => {
    const snapshot = convertSnapTradePositions({ results: [providerPosition], data_freshness: { as_of: '2026-06-02T14:30:00Z' } });
    assert.equal(snapshot.asOf, '2026-06-02T14:30:00.000Z');
    assert.deepEqual(positionsToHoldings(snapshot.positions), [{ symbol: 'AAPL', valueUsd: 1296.23 }]);
    assert.deepEqual(positionsToHoldings([...snapshot.positions, ...snapshot.positions]), [{ symbol: 'AAPL', valueUsd: 2592.46 }]);
});
it('does not convert trade history, unsupported positions or missing prices into current holdings', () => {
    assert.throws(() => convertSnapTradePositions({ data: [providerActivity], pagination: { offset: 0, limit: 100, total: 1 } }));
    for (const extra of [{ price: null }, { units: '-1' }, { currency: 'CAD' }, { cash_equivalent: true }]) {
        const snapshot = convertSnapTradePositions({ results: [{ ...providerPosition, ...extra }] });
        assert.deepEqual(positionsToHoldings(snapshot.positions), []);
    }
});
it('converts nested trade symbols and currencies while preserving signed amounts, zero fees and provider dates', () => {
    const converted = convertSnapTradeActivities({ data: [providerActivity], pagination: { offset: 0, limit: 100, total: 1 } });
    assert.deepEqual(converted.activities[0], { id: 'trade-1', type: 'BUY', symbol: 'AAPL', quantity: 10.5, price: 123.45, amount: -1296.225,
        currency: 'USD', fee: 0, tradeDate: '2026-06-01T14:30:00.000Z', settlementDate: '2026-06-02T00:00:00.000Z', description: 'Bought AAPL' });
    const cash = convertSnapTradeActivities({ data: [{ ...providerActivity, id: 'deposit', type: 'CONTRIBUTION', symbol: null, units: null, price: null, amount: 500, currency: { code: 'CAD' }, fee: null }], pagination: { offset: 0, limit: 100, total: 1 } });
    assert.equal(cash.activities[0].symbol, null); assert.equal(cash.activities[0].quantity, null); assert.equal(cash.activities[0].currency, 'CAD'); assert.equal(cash.activities[0].amount, 500);
});
it('keeps unavailable trade numbers and currency unknown instead of manufacturing values', () => {
    const activity = convertSnapTradeActivities({ data: [{ ...providerActivity, units: null, price: null, amount: null, fee: null, currency: null, trade_date: null }], pagination: { offset: 0, limit: 100, total: 1 } }).activities[0];
    for (const field of ['quantity', 'price', 'amount', 'fee', 'currency', 'tradeDate'] as const) assert.equal(activity[field], null);
    assert.throws(() => convertSnapTradeActivities({ data: [{ ...providerActivity, units: '10.5' }], pagination: { offset: 0, limit: 100, total: 1 } }));
    assert.throws(() => convertSnapTradeActivities({ data: [], pagination: { offset: -1, limit: 100, total: 0 } }));
    assert.throws(() => convertSnapTradeActivities({ results: [providerPosition] }));
});
it('reads and signs the requested activity page without modifying the portfolio', async () => {
    globalThis.fetch = async (url, init) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.pathname, `/api/v1/accounts/${accountId}/activities`); assert.equal(parsed.searchParams.get('offset'), '100'); assert.equal(parsed.searchParams.get('limit'), '100');
        assert.equal(new Headers(init?.headers).get('Signature'), signature(parsed.pathname, parsed.search.slice(1), null, 'test-key'));
        return Response.json({ data: [providerActivity], pagination: { offset: 100, limit: 100, total: 101 } });
    };
    const response = await accountActivities(userId, accountId, 100, 100);
    assert.equal(response.source, 'SnapTrade'); assert.equal(response.asOf, null); assert.equal(response.activities[0].amount, -1296.225); assert.ok(response.fetchedAt);
    assert.ok(!calls.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql)));
    assert.ok(calls.some(c => c.sql.includes('SELECT a.id FROM brokerage_accounts') && c.values[0] === userId && c.values[1] === 'sandbox'));
});
it('rejects foreign accounts and invalid activity query parameters before calling SnapTrade', async () => {
    owned = false;
    globalThis.fetch = async () => { throw new Error('Provider should not be called'); };
    await assert.rejects(accountActivities(userId, accountId, 0, 100), /account not found/);
    const headers = { cookie: `hedgehog_auth=${token}`, 'x-hedgehog-session': digest(token) };
    for (const query of ['offset=-1', 'limit=0', 'limit=1001', 'offset=1.5', 'offset[x]=1']) {
        const response = await request(createApp(), `/brokerages/accounts/${accountId}/activities?${query}`, { headers }); assert.equal(response.status, 400);
    }
});
