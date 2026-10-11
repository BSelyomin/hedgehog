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
let bid: number, ask: number, latestClose: number | null;
const calls: string[] = [];
let priceValues: unknown[] = [], priceSql = '';
beforeEach(() => {
    symbols = ['AAPL']; marketCount = 1; bid = .39; ask = .41; latestClose = null; priceValues = []; priceSql = ''; missingQuotes = false; missingSpy = false; missingBeta = false; priceThrough = null; computedAt = now; extraMeasured = false; marketTags = ['oil']; calls.length = 0;
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
        else if (sql.includes('SELECT symbols.symbol,p.ts,p.close')) { priceValues = values; priceSql = sql; rows = [...symbols, ...(missingSpy ? [] : ['SPY'])].flatMap(symbol => [
            { symbol, role: 'end', ts: now, close: 110, loaded_at: now, price_date: values[1] ?? '2026-10-09', has_latest: values[1] === null },
            { symbol, role: 'start', ts: prior, close: 100, loaded_at: prior, price_date: values[1] ?? '2026-10-09', has_latest: values[1] === null },
            // The value entered is read as of the latest stored close. The database sends that close
            // separately only when the window ends before it, which a test asks for with latestClose.
            ...(latestClose === null ? [] : [{ symbol, role: 'latest', ts: new Date('2026-10-12T16:00:00Z'), close: latestClose, loaded_at: now, price_date: values[1] ?? '2026-10-09', has_latest: values[1] === null }])
        ]); }
        else if (sql.includes('SELECT symbol,b,se,days')) rows = missingBeta ? [] : symbols.flatMap(symbol => (extraMeasured ? ['SPY', 'CL=F'] : ['SPY']).map(driver => ({ symbol, driver, b: 1, se: .1, days: 250, low: .804, high: 1.196, reliable: true, computed_at: computedAt, price_through: priceThrough })));
        else if (sql.includes('current.mid AS current_mid')) rows = missingQuotes ? [] : Array.from({ length: marketCount }, (_, i) => ({
            ticker: `OIL-${i}`, title: 'Oil market', series_ticker: 'OIL-S', event_ticker: 'OIL', event_title: 'Oil event', tags: marketTags, current_mid: .8, previous_mid: .4, current_ts: now, previous_ts: prior
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
        else assert.deepEqual([result.body.movedEvents, result.body.settledEvents], [[], []]);
    }
    assert.ok(!calls.some(sql => sql.includes('SELECT e.* FROM events')));
});
it('batches large portfolio reads into a fixed number of queries and preserves exact move totals', async () => {
    symbols = Array.from({ length: 100 }, (_, i) => `S${i}`); marketCount = 200;
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.holdings.length, 100);
    // Each holding is worth 1,000 at the last close of 110, so it was worth 909.09 at 100.
    assert.equal(result.total, 9091);
    assert.deepEqual([result.startValue, result.endValue], [90909, 100000]);
    assert.equal(result.fromMarket! + result.beyondMarket!, result.total);
    // The 200 markets belong to one event: it is listed once, with its biggest movers and the count.
    assert.equal(result.movedEvents.length, 1);
    assert.deepEqual([result.movedEvents[0].moved, result.movedEvents[0].markets.length], [200, 3]);
    assert.equal(result.movedEvents[0].markets[0].changePoints, 40);
    assert.equal(calls.filter(sql => sql.includes('FROM relevant_series s JOIN settled_markets')).length, 1);
    assert.equal(calls.filter(sql => sql.includes('SELECT symbols.symbol,p.ts,p.close')).length, 1);
    assert.equal(calls.filter(sql => sql.includes('current.mid AS current_mid')).length, 1);
    assert.ok(calls.length <= 10, `Unexpected query fan-out: ${calls.length}`);
});
it('filters market reads to portfolio tags and never requires the AI cache for analytics', async () => {
    const result = await exposure('guest');
    assert.equal(result.events[0].title, 'Oil event');
    // The holding is linked to this event by a shared topic only, so it is listed and counts for no reach.
    assert.deepEqual(result.events[0].links.map(l => l.type), ['Related']);
    assert.deepEqual([result.events[0].linkedValue, result.events[0].topicValue, result.events[0].share], [0, 1000, 0]);
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
    assert.deepEqual((await moves('guest', '2026-10-09', portfolio)).movedEvents, []);
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
    assert.equal(result.body.total, 90.91);
    assert.equal(result.body.range, 'day');
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
    assert.equal(result.total, 90.91);
    assert.equal(result.spyReturn, null);
    assert.equal(result.fromMarket, null);
    assert.equal(result.beyondMarket, null);
    assert.ok(result.notes.some(n => n.includes('SPY closing prices')));
});
it('uses measurement source dates instead of excluding every job that ran after midnight', async () => {
    priceThrough = '2026-10-09'; computedAt = new Date('2026-10-10T02:30:00Z');
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.holdings[0].beta, 1);
    // Beta 1 × SPY's 10% × the 909.09 the holding was worth at the first close.
    assert.equal(result.fromMarket, 90.91);
});
it('rejects measurements whose source prices are later than the requested date', async () => {
    priceThrough = '2026-10-12';
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.holdings[0].beta, null);
    assert.equal(result.fromMarket, null);
    // It says why, which is not that the holding lacks history.
    assert.deepEqual(result.holdings[0].unavailableReasons, ['The market split is not shown for a window that ends before the latest session: the stored measurement includes later prices.']);
});
it('keeps an unsupported beta null without hiding an available stock move', async () => {
    missingBeta = true;
    const result = await moves('guest', '2026-10-09');
    assert.equal(result.holdings[0].beta, null);
    assert.equal(result.total, 90.91);
    assert.equal(result.fromMarket, null);
    assert.ok(result.holdings[0].unavailableReasons.some(n => n.includes('60 aligned daily returns')));
});
it('excludes in-progress daily candles in New York time across winter and summer', () => {
    assert.equal(completedPriceDate(new Date('2026-10-09T19:00:00Z')), '2026-10-08');
    assert.equal(completedPriceDate(new Date('2026-10-09T21:00:00Z')), '2026-10-09');
    assert.equal(completedPriceDate(new Date('2026-01-09T21:59:00Z')), '2026-01-08');
    assert.equal(completedPriceDate(new Date('2026-01-09T22:00:00Z')), '2026-01-09');
});

it('does not build exposure, scan settled history or scan price freshness for Moves', async () => {
    const result = await moves('guest');
    assert.equal(result.total, 90.91);
    assert.equal(result.asOf, now.toISOString());
    assert.ok(!calls.some(sql => /SELECT m\.\*|max\(loaded_at\)|ai_cache/.test(sql)));
    // Settled markets are read once, and only those that closed inside the window.
    const settled = calls.filter(sql => sql.includes('settled_markets'));
    assert.equal(settled.length, 1);
    assert.ok(settled[0].includes('WHERE x.close_time<=$2::timestamptz AND x.close_time>$3::timestamptz'));
    assert.equal(calls.length, 6); // One guest holdings read plus five bounded data queries.
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
    assert.match(timing, /settled;dur=/);
    assert.match(timing, /sql_count;desc="6 queries"/);
    assert.ok(!timing.includes('SELECT') && !timing.includes('AAPL'));
});

it('preserves Direct, Measured and Related evidence without building the exposure map', async () => {
    symbols = ['AAPL', 'MSFT']; marketTags = ['AAPL', 'oil']; extraMeasured = true;
    const result = await moves('guest', '2026-10-09');
    assert.deepEqual(result.movedEvents[0].links, [{ symbol: 'AAPL', type: 'Direct', driver: null, themes: ['direct'] }, { symbol: 'MSFT', type: 'Measured', driver: 'CL=F', themes: ['oil'] }]);
    priceThrough = '2026-10-12';
    const historical = await moves('guest', '2026-10-09');
    assert.deepEqual(historical.movedEvents[0].links[1], { symbol: 'MSFT', type: 'Related', driver: null, themes: [] });
});
it('keeps query timing counts isolated across simultaneous requests', async () => {
    const app = createApp();
    const results = await Promise.all([request(app, '/moves'), request(app, '/moves?date=2026-10-09')]);
    for (const result of results) assert.match(String(result.headers['server-timing']), /sql_count;desc="6 queries"/);
});

it('accepts only the listed orders, grades and history filter for the track record ratings', async () => {
    const app = createApp();
    for (const bad of ['sort=newest', 'grade=E', 'grade=a', 'scored=yes', 'sort='])
        assert.deepEqual([bad, (await request(app, `/track-record/ratings?${bad}`)).status], [bad, 400]);
    for (const good of ['', 'sort=accuracy-low&grade=none&scored=1', 'sort=name&grade=A&scored=0', 'grade='])
        assert.deepEqual([good, (await request(app, `/track-record/ratings?${good}`)).status], [good, 200]);
});
it('opens the window a day, a week, a month or a quarter before its last close', async () => {
    for (const [range, back] of [['day', '1 day'], ['week', '7 days'], ['month', '1 month'], ['quarter', '3 months']] as const) {
        const result = await moves('guest', '2026-10-09', undefined, range);
        assert.equal(priceValues[4], back);
        assert.deepEqual([result.range, result.startDate, result.date], [range, '2026-10-08', '2026-10-09']);
    }
    const app = createApp();
    assert.equal((await request(app, '/moves?range=week')).body.range, 'week');
    const bad = await request(app, '/moves?range=year');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'range must be day, week, month or quarter');
});
it('values today’s holding at both closes, reading the value entered as of the latest close', async () => {
    // With the window ending on the latest session, the value entered is its worth at the last close.
    const latest = await moves('guest', '2026-10-09');
    assert.deepEqual([latest.holdings[0].startValue, latest.holdings[0].endValue, latest.holdings[0].actual], [909.09, 1000, 90.91]);
    // A window that ended earlier: worth 1,000 at the latest close of 121, it ran from 100 to 110.
    latestClose = 121;
    const result = await moves('guest', '2026-10-09');
    assert.deepEqual([result.holdings[0].startValue, result.holdings[0].endValue, result.holdings[0].actual], [826.45, 909.09, 82.64]);
    assert.deepEqual([result.startValue, result.endValue, result.total], [826.45, 909.09, 82.64]);
    // The market's part is beta × SPY's 10% × the value at the first close, and the two parts still add up.
    assert.equal(result.fromMarket, 82.65);
    assert.equal(result.beyondMarket, -.01);
    assert.deepEqual(result.driverChanges, [{ driver: 'SPY', kind: 'return', change: 110 / 100 - 1 }]);
    assert.deepEqual(result.missingDrivers, ['CL=F', 'DGS2', 'DGS10']);
});
it('bounds every close lookup so that only a few weeks of prices are opened', async () => {
    await moves('guest', '2026-10-09', undefined, 'quarter');
    const day = (date: string) => `((${date})::timestamp AT TIME ZONE 'UTC')`;
    // Each lookup carries limits written with the request's parameters alone.
    const ends = 'LEAST(COALESCE($2::date,$3::date),$3::date)', opens = 'LEAST((COALESCE($2::date,$3::date)-$5::interval)::date,$3::date)';
    assert.ok(priceSql.includes(`ts < ${day(`${ends}+1`)} AND ts >= ${day(`${ends}-60`)} AND ts < ${day('bounds.last+1')} AND ts >= ${day('bounds.last-30')} ORDER BY ts DESC LIMIT 1`));
    assert.ok(priceSql.includes(`ts < ${day(`${opens}+1`)} AND ts >= ${day(`${opens}-60`)} AND ts < ${day('bounds.opens+1')} AND ts >= ${day('bounds.opens-30')} ORDER BY ts DESC LIMIT 1`));
    assert.ok(priceSql.includes(`bounds.last<$3::date AND ts < ${day('$3::date+1')} AND ts >= ${day('$3::date-30')} ORDER BY ts DESC LIMIT 1`));
    assert.equal(priceSql.match(/FROM prices WHERE/g)!.length, priceSql.match(/ts >= /g)!.length - 2);
});
it('compares Kalshi over the same window as the prices, close to close in New York', async () => {
    const result = await moves('guest', '2026-10-09');
    assert.deepEqual(result.oddsWindow, { from: '2026-10-08T20:00:00.000Z', to: '2026-10-09T20:00:00.000Z' });
    const odds = calls.find(sql => sql.includes('current.mid AS current_mid'))!;
    // Open at the window's last close, and quoted within ten cents at both ends.
    assert.ok(odds.includes('WHERE m.close_time>$2::timestamptz AND current.spread<=0.1001 AND previous.spread<=0.1001'));
    assert.equal(result.movedEvents[0].markets[0].from, .4);
    assert.equal(result.movedEvents[0].markets[0].to, .8);
    assert.deepEqual([result.movedEvents[0].markets[0].fromTime, result.movedEvents[0].markets[0].toTime], [prior.toISOString(), now.toISOString()]);
});
