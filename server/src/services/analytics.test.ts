import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { exposure } from './exposure.ts';
import { moves } from './moves.ts';
import { completedPriceDate } from './price-date.ts';

const originalQuery = pool.query;
const now = new Date('2026-10-09T16:00:00Z'), prior = new Date('2026-10-08T16:00:00Z');
let symbols: string[], marketCount: number, missingQuotes: boolean, missingSpy: boolean, missingBeta: boolean;
let priceThrough: string | null, computedAt: Date, extraMeasured: boolean, marketTags: string[];
let bid: number, ask: number;
const calls: string[] = [];
beforeEach(() => {
    symbols = ['AAPL']; marketCount = 1; bid = .39; ask = .41; missingQuotes = false; missingSpy = false; missingBeta = false; priceThrough = null; computedAt = now; extraMeasured = false; marketTags = ['oil']; calls.length = 0;
    pool.query = (async (sql: string, values: unknown[] = []) => {
        calls.push(sql);
        let rows: unknown[] = [];
        if (sql.includes('SELECT * FROM holdings')) rows = symbols.map(symbol => ({ symbol, value_usd: '1000.00', updated_at: now }));
        // Simulate the previous race: an event read succeeds, but its final
        // market closes before the separate market query. The fixed code does
        // not perform this event read at all.
        else if (sql.includes('SELECT e.* FROM events')) rows = [{ ticker: 'OIL', title: 'Oil event', series_ticker: 'OIL-S', category: 'Energy' }];
        else if (sql.includes('SELECT m.*')) rows = Array.from({ length: marketCount }, (_, i) => ({
            ticker: `OIL-${i}`, event_ticker: 'OIL', event_title: 'Oil event', series_ticker: 'OIL-S', category: 'Energy',
            title: 'Oil market', subtitle: '', close_time: new Date('2099-01-01'), mutually_exclusive: false,
            ts: missingQuotes ? null : now, yes_bid: missingQuotes ? null : bid, yes_ask: missingQuotes ? null : ask,
            mid: missingQuotes ? null : (bid + ask) / 2, volume_24h: missingQuotes ? null : 1000, open_interest: missingQuotes ? null : 1000
        }));
        else if (sql.includes('SELECT series_ticker,tag')) rows = [{ series_ticker: 'OIL-S', tag: 'oil' }];
        else if (sql.includes('SELECT symbol,tag')) rows = symbols.map(symbol => ({ symbol, tag: 'oil' }));
        else if (sql.includes('SELECT symbols.symbol,p.ts,p.close')) rows = [...symbols, ...(missingSpy ? [] : ['SPY'])].flatMap(symbol => [
            { symbol, ts: now, close: 110, loaded_at: now, price_date: values[1] ?? '2026-10-09', has_latest: values[1] === null },
            { symbol, ts: prior, close: 100, loaded_at: prior, price_date: values[1] ?? '2026-10-09', has_latest: values[1] === null }
        ]);
        else if (sql.includes('SELECT symbol,b,se,days')) rows = missingBeta ? [] : symbols.flatMap(symbol => (extraMeasured ? ['SPY', 'CL=F'] : ['SPY']).map(driver => ({ symbol, driver, b: 1, se: .1, days: 250, low: .804, high: 1.196, reliable: true, computed_at: computedAt, price_through: priceThrough })));
        else if (sql.includes('current.mid AS current_mid')) rows = missingQuotes ? [] : Array.from({ length: marketCount }, (_, i) => ({
            ticker: `OIL-${i}`, title: 'Oil market', series_ticker: 'OIL-S', tags: marketTags, current_mid: .8, previous_mid: .4
        }));
        else if (sql.includes('SELECT max(')) rows = [{ ts: now }];
        return { rows, rowCount: rows.length };
    }) as typeof pool.query;
});
afterEach(() => { pool.query = originalQuery; });

it('returns exposure and moves instead of throwing when an event loses its last open market', async () => {
    marketCount = 0;
    const app = createApp();
    for (const path of ['/exposure', '/moves?date=2026-10-09']) {
        const result = await request(app, path);
        assert.equal(result.status, 200);
        if (path === '/exposure') assert.deepEqual(result.body.events, []);
        else assert.deepEqual(result.body.oddsMoves, []);
    }
    assert.ok(!calls.some(sql => sql.includes('SELECT e.* FROM events')));
});
it('batches large portfolio reads into a fixed number of queries and preserves exact move totals', async () => {
    symbols = Array.from({ length: 100 }, (_, i) => `S${i}`); marketCount = 200;
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.holdings.length, 100);
    assert.equal(result.total, 10000);
    assert.equal(result.fromMarket! + result.beyondMarket!, result.total);
    assert.equal(result.oddsMoves.length, 200);
    assert.equal(result.oddsMoves[0].changePoints, 40);
    assert.equal(calls.filter(sql => sql.includes('SELECT symbols.symbol,p.ts,p.close')).length, 1);
    assert.equal(calls.filter(sql => sql.includes('current.mid AS current_mid')).length, 1);
    assert.ok(calls.length <= 10, `Unexpected query fan-out: ${calls.length}`);
});
it('filters market reads to portfolio tags and never requires the AI cache for analytics', async () => {
    const result = await exposure('guest');
    assert.equal(result.events[0].title, 'Oil event');
    assert.equal(result.events[0].linkedValue, 1000);
    assert.equal(result.events[0].markets[0].probability, .4);
    const sql = calls.find(sql => sql.includes('SELECT m.*'))!;
    assert.ok(sql.includes('t.reviewed=true') && sql.includes('t.tag=ANY($1::text[])'));
    assert.ok(!calls.some(sql => sql.includes('ai_cache')));
});
it('returns unavailable quote values and omits unsupported odds moves', async () => {
    missingQuotes = true;
    const portfolio = await exposure('guest');
    assert.equal(portfolio.events[0].markets[0].probability, null);
    assert.equal(portfolio.events[0].markets[0].trust.total, null);
    assert.equal(portfolio.asOf, null);
    assert.deepEqual((await moves('guest', '2026-10-09', portfolio)).oddsMoves, []);
});
it('shows no probability, spread or trust for a market whose order book is empty', async () => {
    symbols = ['OIL-S'];
    const market = async () => (await exposure('guest')).events[0].markets[0];
    assert.deepEqual([(await market()).probability, (await market()).spread], [.4, .41 - .39]);
    // Nobody bidding and nobody offering: 0 and 1 would average to a 50% that no one posted.
    bid = 0; ask = 1;
    const empty = await market();
    assert.deepEqual([empty.probability, empty.spread, empty.trust.total, empty.trust.band, empty.trust.spreadCents], [null, null, null, null, null]);
    assert.equal(empty.asOf, now.toISOString());
    // An offer with no bid, or a bid with no offer, is still a quote.
    bid = 0; ask = .06;
    assert.equal((await market()).probability, .03);
    bid = .94; ask = 1;
    assert.equal((await market()).probability, .97);
});
it('returns an empty portfolio without scanning markets when no holdings exist', async () => {
    symbols = [];
    assert.deepEqual(await exposure('guest'), { holdings: [], totalValue: 0, byHolding: [], events: [], asOf: null,
        categories: { totalValue: 0, holdings: [], assetClasses: [], themes: [] } });
    assert.equal(calls.length, 1);
});

it('defaults the endpoint to the latest stored trading session instead of a weekend date', async () => {
    const result = await request(createApp(), '/moves');
    assert.equal(result.status, 200);
    assert.equal(result.body.date, '2026-10-09');
    assert.equal(result.body.requestedDate, null);
    assert.equal(result.body.total, 100);
    assert.ok(result.body.notes.some((n: string) => n.includes('latest stored trading session')));
});
it('preserves explicitly selected dates and explains missing weekend prices', async () => {
    const result = await moves('guest', '2026-10-10');
    assert.equal(result.date, '2026-10-10');
    assert.equal(result.requestedDate, '2026-10-10');
    assert.equal(result.total, null);
    assert.ok(result.holdings[0].unavailableReasons.some(n => n.includes('No completed AAPL closing price')));
});
it('shows the stock move without SPY history and leaves its market split unavailable', async () => {
    missingSpy = true;
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.total, 100);
    assert.equal(result.spyReturn, null);
    assert.equal(result.fromMarket, null);
    assert.equal(result.beyondMarket, null);
    assert.ok(result.notes.some(n => n.includes('SPY closing prices')));
});
it('uses measurement source dates instead of excluding every job that ran after midnight', async () => {
    priceThrough = '2026-10-09'; computedAt = new Date('2026-10-10T02:30:00Z');
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.holdings[0].beta, 1);
    assert.equal(result.fromMarket, 100);
});
it('rejects measurements whose source prices are later than the requested date', async () => {
    priceThrough = '2026-10-12';
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.holdings[0].beta, null);
    assert.equal(result.fromMarket, null);
});
it('keeps an unsupported beta null without hiding an available stock move', async () => {
    missingBeta = true;
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.holdings[0].beta, null);
    assert.equal(result.total, 100);
    assert.equal(result.fromMarket, null);
    assert.ok(result.holdings[0].unavailableReasons.some(n => n.includes('60 aligned daily returns')));
});
it('excludes in-progress daily candles in New York time across winter and summer', () => {
    assert.equal(completedPriceDate(new Date('2026-10-09T19:00:00Z')), '2026-10-08');
    assert.equal(completedPriceDate(new Date('2026-10-09T21:00:00Z')), '2026-10-09');
    assert.equal(completedPriceDate(new Date('2026-01-09T21:59:00Z')), '2026-01-08');
    assert.equal(completedPriceDate(new Date('2026-01-09T22:00:00Z')), '2026-01-09');
});

it('does not build exposure, read settled history or scan price freshness for Moves', async () => {
    const result = await moves('guest');
    assert.equal(result.total, 100);
    assert.equal(result.asOf, now.toISOString());
    assert.ok(!calls.some(sql => /settled_markets|SELECT m\.\*|max\(loaded_at\)|ai_cache/.test(sql)));
    assert.equal(calls.length, 5); // One guest holdings read plus four bounded data queries.
});
it('returns no holdings without running unrelated market or price queries', async () => {
    symbols = [];
    const result = await moves('guest');
    assert.deepEqual(result.holdings, []);
    assert.equal(result.total, null);
    assert.equal(calls.length, 1);
});
it('exposes safe stage timings and SQL counts for the actual browser request', async () => {
    const result = await request(createApp(), '/moves');
    const timing = String(result.headers['server-timing']);
    assert.equal(result.status, 200);
    assert.match(timing, /backend;dur=\d/);
    assert.match(timing, /holdings;dur=/);
    assert.match(timing, /prices;dur=/);
    assert.match(timing, /odds;dur=/);
    assert.match(timing, /sql_count;desc="5 queries"/);
    assert.ok(!timing.includes('SELECT') && !timing.includes('AAPL'));
});

it('preserves Direct, Measured and Related evidence without building the exposure map', async () => {
    symbols = ['AAPL', 'MSFT']; marketTags = ['AAPL', 'oil']; extraMeasured = true;
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.oddsMoves[0].links[0].type, 'Direct');
    assert.equal(result.oddsMoves[0].links[0].symbol, 'AAPL');
    assert.equal(result.oddsMoves[0].links[0].sensitivity, null);
    assert.equal(result.oddsMoves[0].links[1].type, 'Measured');
    assert.equal(result.oddsMoves[0].links[1].sensitivity?.driver, 'CL=F');
    priceThrough = '2026-10-12';
    const historical = await moves('guest', '2026-10-09');
    assert.equal(historical.oddsMoves[0].links[1].type, 'Related');
    assert.equal(historical.oddsMoves[0].links[1].sensitivity, null);
});
it('keeps query timing counts isolated across simultaneous requests', async () => {
    const app = createApp();
    const results = await Promise.all([request(app, '/moves'), request(app, '/moves?date=2026-10-09')]);
    for (const result of results) assert.match(String(result.headers['server-timing']), /sql_count;desc="5 queries"/);
});
