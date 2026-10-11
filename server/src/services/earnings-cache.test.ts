import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { earnings, earningsList } from './earnings.ts';

const originalQuery = pool.query, originalNow = Date.now;
let caseNumber = 0, owner: string, now: number, value: number, probability: number, timestamp: Date;
let marketFailure: boolean, historyFailure: boolean, authenticated: boolean;
const calls: string[] = [];
const count = (text: string) => calls.filter(sql => sql.includes(text)).length;
beforeEach(() => {
    owner = `10000000-0000-0000-0000-${String(++caseNumber).padStart(12, '0')}`;
    now = Date.parse('2026-10-10T16:00:00Z'); Date.now = () => now;
    value = 1000; probability = .4; timestamp = new Date(now); marketFailure = false; historyFailure = false; authenticated = true; calls.length = 0;
    pool.query = (async (sql: string) => {
        calls.push(sql); let rows: unknown[] = [];
        if (sql.includes('FROM auth_sessions')) rows = authenticated ? [{ id: owner, email: 'cache@example.test', name: 'Cache tester', created_at: new Date(now), expires_at: new Date('2099-01-01') }] : [];
        else if (sql.includes('SELECT * FROM holdings')) rows = [{ symbol: 'AAPL', value_usd: String(value), updated_at: new Date('2026-10-01') }];
        else if (sql.includes('SELECT m.*')) {
            if (marketFailure) throw new Error('Market database read failed');
            rows = [{ ticker: 'CALL-AI', event_ticker: 'CALL', event_title: 'What will Apple say during its next earnings call?', event_description: '', series_ticker: 'AAPL-CALL', category: 'Mentions',
                title: 'Will Apple mention AI?', subtitle: 'AI', close_time: new Date('2099-01-01'), occurrence_time: new Date('2098-12-31'), mutually_exclusive: false,
                ts: timestamp, yes_bid: probability - .01, yes_ask: probability + .01, mid: probability, volume_24h: 1000, open_interest: 1000 }];
        } else if (sql.includes('SELECT series_ticker,tag')) rows = [{ series_ticker: 'AAPL-CALL', tag: 'AAPL' }];
        else if (sql.includes('SELECT symbol,name FROM companies')) rows = [{ symbol: 'AAPL', name: 'Apple' }];
        else if (sql.includes('FROM earnings_reports')) {
            if (historyFailure) throw new Error('Report history read failed');
            rows = [{ filing_date: '2026-07-30', source_url: 'https://www.sec.gov/Archives/edgar/data/320193/test-index.htm' }];
        } else if (sql.includes('FROM prices WHERE symbol=$1')) rows = [{ date: '2026-07-29', close: 200 }, { date: '2026-07-31', close: 210 }];
        return { rows, rowCount: rows.length };
    }) as typeof pool.query;
});
afterEach(() => { pool.query = originalQuery; Date.now = originalNow; });

it('reuses one server snapshot for list/detail and repeated browser-refresh requests', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    const list = await request(app, '/earnings', { headers });
    const detail = await request(app, '/earnings/AAPL', { headers });
    assert.equal(list.status, 200); assert.equal(detail.status, 200); assert.equal(count('SELECT m.*'), 1);
    assert.equal(count('FROM earnings_reports'), 1); assert.equal(list.body.companies[0].name, 'Apple');
    assert.equal(detail.body.history[0].move, 210 / 200 - 1);
    calls.length = 0;
    const nextList = await request(app, '/earnings', { headers });
    const nextDetail = await request(app, '/earnings/AAPL', { headers });
    assert.deepEqual(nextList.body, list.body); assert.deepEqual(nextDetail.body, detail.body);
    assert.equal(count('SELECT m.*'), 0); assert.equal(count('FROM earnings_reports'), 0);
    assert.equal(calls.length, 2); // One holdings check per request, no exposure/history rebuild.
    assert.match(String(nextList.headers['server-timing']), /earnings_cache_hit;dur=/);
    assert.match(String(nextDetail.headers['server-timing']), /earnings_detail_cache_hit;dur=/);
    assert.match(String(nextDetail.headers['server-timing']), /sql_count;desc="1 queries"/);
    assert.equal(nextDetail.headers['cache-control'], 'no-store');
});

it('checks holding contents on every request instead of relying on timestamps or browser invalidation', async () => {
    const first = await earnings(owner, 'AAPL'); assert.equal(first.position?.valueUsd, 1000);
    value = 2000;
    const second = await earnings(owner, 'AAPL'); assert.equal(second.position?.valueUsd, 2000);
    assert.equal(count('SELECT m.*'), 2); assert.equal(count('FROM earnings_reports'), 2);
    assert.equal((await earningsList(owner)).companies[0].valueUsd, 2000); assert.equal(count('SELECT m.*'), 2);
});

it('preserves original quote timestamps until expiry and explicitly refreshes both endpoints through one snapshot', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    await request(app, '/earnings', { headers });
    const first = await request(app, '/earnings/AAPL', { headers });
    probability = .8; timestamp = new Date(now + 1000);
    assert.deepEqual((await request(app, '/earnings/AAPL', { headers })).body, first.body);
    await request(app, '/earnings', { headers: { ...headers, 'x-hedgehog-refresh': '1' } });
    const fresh = await request(app, '/earnings/AAPL', { headers });
    assert.equal(fresh.body.events[0].markets[0].probability, .8); assert.equal(fresh.body.asOf, timestamp.toISOString());
    assert.equal(count('SELECT m.*'), 2);
    now += 300_000; await request(app, '/earnings', { headers }); assert.equal(count('SELECT m.*'), 2);
    now += 3_299_999; await request(app, '/earnings/AAPL', { headers }); assert.equal(count('SELECT m.*'), 2);
    now++; await request(app, '/earnings', { headers }); assert.equal(count('SELECT m.*'), 3);
});

it('coalesces simultaneous list/company builds and clones cached payloads for each consumer', async () => {
    const [list, a, b] = await Promise.all([earningsList(owner), earnings(owner, 'AAPL'), earnings(owner, 'AAPL')]);
    assert.equal(count('SELECT m.*'), 1); assert.equal(count('FROM earnings_reports'), 1);
    a.position!.valueUsd = -1; a.events[0].markets[0].probability = .99;
    assert.equal(b.position?.valueUsd, 1000); assert.equal(b.events[0].markets[0].probability, .4);
    assert.equal((await earnings(owner, 'AAPL')).position?.valueUsd, 1000); assert.equal(list.companies[0].valueUsd, 1000);
});

it('keeps portfolios isolated even when their holding contents match', async () => {
    await earningsList(owner); await earningsList(`${owner}-other`);
    assert.equal(count('SELECT m.*'), 2); await earningsList(owner); assert.equal(count('SELECT m.*'), 2);
});

it('does not cache failed builds or histories and never retries them within a request', async () => {
    marketFailure = true;
    await assert.rejects(earningsList(owner), /Market database/); assert.equal(count('SELECT m.*'), 1);
    marketFailure = false; await earningsList(owner); assert.equal(count('SELECT m.*'), 2);
    historyFailure = true;
    await assert.rejects(earnings(owner, 'AAPL'), /Report history/); assert.equal(count('FROM earnings_reports'), 1);
    historyFailure = false; assert.ok((await earnings(owner, 'AAPL')).history);
    assert.equal(count('SELECT m.*'), 2); assert.equal(count('FROM earnings_reports'), 2);
});

it('continues validating authentication before serving a cached private response', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}; hedgehog_auth=${'a'.repeat(64)}` };
    assert.equal((await request(app, '/earnings', { headers })).status, 200);
    assert.equal((await request(app, '/earnings', { headers })).status, 200);
    assert.equal(count('SELECT m.*'), 1); assert.equal(count('FROM auth_sessions'), 2);
    authenticated = false;
    assert.equal((await request(app, '/earnings', { headers })).status, 401); assert.equal(count('SELECT m.*'), 1);
});

it('bounds retained portfolios and evicts older snapshots', async () => {
    await earningsList(owner);
    for (let i = 0; i < 32; i++) await earningsList(`${owner}-${i}`);
    const builds = count('SELECT m.*'); await earningsList(owner); assert.equal(count('SELECT m.*'), builds + 1);
});

it('invalidates cached earnings when imported brokerage values change independently of manual holdings', async () => {
    const names = ['SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY', 'SNAPTRADE_ENCRYPTION_KEY', 'SNAPTRADE_MODE', 'APP_URL'];
    const saved = names.map(name => process.env[name]);
    const manualQuery = pool.query; let importedValue = 500;
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
        assert.equal((await earnings(account, 'AAPL')).position?.valueUsd, 1500);
        importedValue = 800;
        assert.equal((await earnings(account, 'AAPL')).position?.valueUsd, 1800);
        assert.equal(count('SELECT m.*'), 2);
    } finally {
        pool.query = manualQuery;
        names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
    }
});
