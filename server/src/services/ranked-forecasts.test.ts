import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { digest } from '../auth/session.ts';
import { completedPriceDate } from './price-date.ts';

const original = pool.query, owner = '11111111-1111-1111-1111-111111111111', other = '22222222-2222-2222-2222-222222222222';
const calls: { sql: string; values: unknown[] }[] = [];
let failed = false;
beforeEach(() => {
    calls.length = 0; failed = false;
    pool.query = (async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values }); if (failed) throw new Error('Database unavailable');
        const cutoff = completedPriceDate(); let rows: unknown[] = [];
        if (sql.includes('SELECT * FROM holdings') && values[0] === owner) rows = [{ symbol: 'AAA', value_usd: '1000', updated_at: new Date() }];
        else if (sql.includes('SELECT s.symbol,p.ts')) rows = ['SPY', 'AAA', 'DGS2'].map(symbol => ({ symbol, ts: new Date(cutoff), close: symbol === 'DGS2' ? 4 : 100, loaded_at: new Date() }));
        else if (sql.includes('SELECT symbol,driver,b,se')) rows = [{ symbol: 'AAA', driver: 'DGS2', b: -.2, se: .01, days: 250,
            low: -.2196, high: -.1804, reliable: true, effect: .02, price_through: cutoff, computed_at: new Date() }];
        else if (sql.includes('GROUP BY e.ticker,r.tags')) rows = Array.from({ length: 251 }, (_, i) => ({ ticker: `E${i}`, series_ticker: i === 250 ? 'KXUST2AD' : `OTHER-YIELD-${i}`, title: `Yield topic ${i}`, description: '', category: 'Economics',
            strike_date: null, tags: ['fed-rates'], linked_symbols: ['AAA'], close_time: new Date(Date.now() + (252 - i) * 86400000), occurrence_time: null, expected_expiration_time: null }));
        else if (sql.includes('SELECT m.ticker,m.event_ticker,m.series_ticker') && (!values[1] || values[1] === 'M')) rows = [{
            ticker: 'M', event_ticker: 'E250', series_ticker: 'KXUST2AD', title: 'Above 4.25%', event_title: 'Yield', close_time: new Date(Date.now() + 86400000),
            tags: ['fed-rates'], linked_symbols: ['AAA'], strike_type: 'greater', floor_strike: 4.25, cap_strike: null, ts: new Date(), yes_bid: .6, yes_ask: .8 }];
        return { rows, rowCount: rows.length };
    }) as typeof pool.query;
});
afterEach(() => { pool.query = original; });
function call(path: string, guest = owner, body?: unknown) {
    return request(createApp(), path, { method: body === undefined ? 'GET' : 'POST', body, headers: { cookie: `hedgehog_session=${guest}`, 'x-hedgehog-request': '1', 'x-hedgehog-session': digest(guest) } });
}
it('ranks all linked candidates before the top-20 limit and reads odds only for those events', async () => {
    const result = await call('/forecasts/ranked-events'); assert.equal(result.status, 200);
    assert.equal(result.body.candidateEvents, 251); assert.equal(result.body.events.length, 20); assert.equal(result.body.events[0].ticker, 'E250');
    assert.equal(result.body.events[0].outcomes[0].result.changeUsd, -50);
    assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(calls.length, 5);
    assert.ok(calls.some(c => c.sql.includes('LIMIT 2')));
    const candidates = calls.find(c => c.sql.includes('GROUP BY e.ticker,r.tags'))!;
    assert.ok(!candidates.sql.includes('LIMIT')); assert.ok(candidates.sql.includes('reviewed=true'));
    const quotes = calls.find(c => c.sql.includes('m.event_ticker=ANY'))!;
    assert.equal((quotes.values[0] as string[]).length, 20);
    assert.ok(!calls.some(c => /ai_cache|settled_markets|LIMIT 321/.test(c.sql)));
});
it('serves measured result directions and current portfolio value without a guessed conditional tail', async () => {
    const result = await call('/forecasts/result/M'); assert.equal(result.status, 200);
    assert.equal(result.body.result.portfolioValueAssumingOthersFlat, 950);
    assert.equal(result.body.stocks[0].direction, 'down'); assert.equal(result.body.market.probability, .7);
    assert.ok(result.body.result.label.includes('market boundary'));
    assert.ok(calls.at(-1)!.sql.includes('m.ticker=$2'));
});
it('isolates guest portfolios and returns 404 for foreign or unavailable market results', async () => {
    assert.deepEqual((await call('/forecasts/ranked-events', other)).body.events, []);
    assert.equal((await call('/forecasts/result/M', other)).status, 404);
    assert.equal((await call('/forecasts/result/FOREIGN')).status, 404);
});
it('returns JSON database errors instead of leaving either page request loading', async () => {
    failed = true;
    for (const path of ['/forecasts/ranked-events', '/forecasts/result/M']) {
        const result = await call(path); assert.equal(result.status, 503);
        assert.equal(typeof result.body.error, 'string'); assert.equal(result.body.asOf, null);
    }
});
it('supports private inline assumptions without AI, provider calls or long history queries', async () => {
    const result = await call('/forecasts/result/M', owner, { driver: 'DGS2', change: -.25 });
    assert.equal(result.status, 200); assert.equal(result.body.result.basis, 'user-assumption');
    assert.equal(result.body.result.changeUsd, 50); assert.equal(result.body.result.portfolioValueAssumingOthersFlat, 1050);
    assert.equal(result.body.scenarioDrivers[0].coveredValue, 1000);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.ok(!calls.some(c => /ai_cache|LIMIT 321/.test(c.sql)));
    assert.equal((await call('/forecasts/result/M', other, { driver: 'DGS2', change: -.25 })).status, 404);
    assert.equal((await call('/forecasts/result/FOREIGN', owner, { driver: 'DGS2', change: -.25 })).status, 404);
});
it('validates inline assumptions before reading the database and preserves CSRF protection', async () => {
    const result = await call('/forecasts/result/M', owner, { driver: 'DGS2', change: 'wrong' });
    assert.equal(result.status, 400); assert.equal(typeof result.body.error, 'string'); assert.equal(calls.length, 0);
    const blocked = await request(createApp(), '/forecasts/result/M', { method: 'POST', body: { driver: 'DGS2', change: -.25 }, headers: { cookie: `hedgehog_session=${owner}` } });
    assert.equal(blocked.status, 403); assert.equal(calls.length, 0);
});
