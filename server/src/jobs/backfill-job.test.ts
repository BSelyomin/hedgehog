import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), kalshi: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query }));
vi.mock('../services/kalshi.ts', async original => ({ ...await original<typeof import('../services/kalshi.ts')>(), kalshi: mocks.kalshi }));
import { DB_BATCH, LOOKBACK_DAYS, backfill, backfillSeries, closeGroups, oddsBeforeClose, scoreable } from './backfill.ts';

const DAY = 86400, HOUR = 3600;
const close = '2026-09-11T12:25:00Z', mark = Date.parse(close) / 1000 - DAY;
const candle = (end: number, bid: string | null, ask: string | null) => ({ end_period_ts: end, yes_bid: { close_dollars: bid }, yes_ask: { close_dollars: ask } });

describe('odds 24 hours before close', () => {
    it('reads the last quote published at or before the mark, however quiet the market was', () => {
        // Kalshi publishes a candlestick only when the quote changes, so this one from nine hours
        // earlier is the quote that was standing at the mark.
        expect(oddsBeforeClose([candle(mark - 30 * HOUR, '0.2000', '0.2400'), candle(mark - 9 * HOUR, '0.3000', '0.3400')], close)).toEqual({ probability: .32, ts: mark - 9 * HOUR });
        expect(oddsBeforeClose([candle(mark, '0.6000', '0.6400')], close)).toEqual({ probability: .62, ts: mark });
    });
    it('never reads a quote from after the mark, least of all the close', () => {
        expect(oddsBeforeClose([candle(mark + 60, '0.9000', '0.9400'), candle(mark + DAY, '0.9900', '1.0000')], close)).toBeNull();
        expect(oddsBeforeClose([candle(mark - HOUR, '0.3000', '0.3400'), candle(mark + HOUR, '0.9000', '0.9400')], close)?.probability).toBe(.32);
    });
    it('gives no reading from a quote more than a week old, or from an empty book at the mark', () => {
        expect(oddsBeforeClose([candle(mark - LOOKBACK_DAYS * DAY - 1, '0.3000', '0.3400')], close)).toBeNull();
        expect(oddsBeforeClose([candle(mark - LOOKBACK_DAYS * DAY, '0.3000', '0.3400')], close)?.ts).toBe(mark - LOOKBACK_DAYS * DAY);
        // The book emptied before the mark: the earlier quote was no longer standing.
        expect(oddsBeforeClose([candle(mark - 5 * HOUR, '0.3000', '0.3400'), candle(mark - HOUR, '0.0000', '1.0000')], close)).toBeNull();
        expect(oddsBeforeClose([candle(mark - HOUR, null, '0.3400')], close)).toBeNull();
        expect(oddsBeforeClose([], close)).toBeNull();
    });
});

describe('which settled markets can be scored', () => {
    it('leaves out a market listed for under a day, which has no odds a day before its close', () => {
        expect(scoreable({ open_time: '2026-07-23T21:00:00Z', close_time: close, result: 'no' })).toBe(true);
        expect(scoreable({ open_time: '2026-10-09T12:00:00Z', close_time: '2026-10-10T03:59:00Z', result: 'yes' })).toBe(false);
        expect(scoreable({ open_time: '2026-09-10T12:25:00Z', close_time: close, result: 'yes' })).toBe(true);
        expect(scoreable({ close_time: close, result: 'yes' })).toBe(false);
        expect(scoreable({ open_time: '2026-07-23T21:00:00Z', close_time: close, result: 'void' })).toBe(false);
        expect(scoreable({ open_time: '2026-07-23T21:00:00Z', close_time: close })).toBe(false);
    });
    it('asks together for markets that close together, within what one reply can hold', () => {
        const markets = [...Array.from({ length: 130 }, (_, i) => ({ ticker: `A${i}`, close_time: close })), { ticker: 'B', close_time: '2026-08-12T12:25:00Z' }];
        const groups = closeGroups(markets);
        expect(groups.map(group => group.length)).toEqual([59, 59, 12, 1]);
        expect(groups.every(group => new Set(group.map(m => m.close_time)).size === 1)).toBe(true);
        expect(groups.every(group => group.length * (LOOKBACK_DAYS * 24 + 1) <= 10000)).toBe(true);
        expect(groups.flat()).toHaveLength(131);
    });
});

describe('scoring a series', () => {
    beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); mocks.query.mockReset(); mocks.kalshi.mockReset(); });
    const market = (ticker: string, extra = {}) => ({ ticker, event_ticker: 'KXCPI-26AUG', title: `Question ${ticker}`, close_time: close, open_time: '2026-07-23T21:00:00Z', result: 'no', status: 'finalized', ...extra });
    const inserted = () => JSON.parse(mocks.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO settled_markets'))![1][0]);
    const database = (stored: string[] = [], watermark?: string) => mocks.query.mockImplementation(async (sql: string) =>
        sql.includes('SELECT cursor FROM job_state') ? (watermark ? [{ cursor: watermark }] : []) : sql.includes('SELECT ticker FROM settled_markets') ? stored.map(ticker => ({ ticker })) : []);

    it('reads live markets in one request per close time and archived ones singly, then records how far it got', async () => {
        database();
        mocks.kalshi.mockImplementation(async (path: string, params: Record<string, string>) => {
            if (path === '/markets') return { markets: [market('LIVE-A', { result: 'yes' }), market('LIVE-B'), market('SHORT', { open_time: '2026-09-11T00:00:00Z' }), market('VOID', { result: 'void' })] };
            if (path === '/historical/markets') return { markets: [market('OLD', { open_time: '2026-05-01T00:00:00Z', close_time: '2026-07-14T12:25:00Z', event_ticker: 'KXCPI-26JUN' }), market('LIVE-A')] };
            if (path === '/markets/candlesticks') return { markets: [{ market_ticker: 'LIVE-A', candlesticks: [candle(mark - 2 * HOUR, '0.7000', '0.7400')] }, { market_ticker: 'LIVE-B', candlesticks: [] }] };
            if (path === '/historical/markets/OLD/candlesticks') return { candlesticks: [{ end_period_ts: Number(params.end_ts) - HOUR, yes_bid: { close: '0.1000' }, yes_ask: { close: '0.1400' } }] };
            if (path === '/historical/markets/LIVE-B/candlesticks') throw new Error('Kalshi HTTP 404');
            throw new Error(`unexpected ${path}`);
        });
        expect(await backfillSeries('KXCPI', 'Economics')).toEqual({ settled: 4, recent: 4, short: 1, scored: 2, noQuote: 1 });
        // One request for the two live markets, over the week before their shared mark, hourly.
        expect(mocks.kalshi).toHaveBeenCalledWith('/markets/candlesticks', { market_tickers: 'LIVE-A,LIVE-B', start_ts: String(mark - LOOKBACK_DAYS * DAY), end_ts: String(mark), period_interval: '60' });
        expect(mocks.kalshi.mock.calls.filter(([path]) => path === '/markets/candlesticks')).toHaveLength(1);
        // The short-lived market costs no candlestick request at all.
        expect(mocks.kalshi.mock.calls.some(([path]) => String(path).includes('SHORT'))).toBe(false);
        expect(inserted()).toEqual([
            { ticker: 'LIVE-A', category: 'Economics', prob_24h_before: .72, outcome: 1, close_time: close, odds_time: new Date((mark - 2 * HOUR) * 1000).toISOString(), series_ticker: 'KXCPI', event_ticker: 'KXCPI-26AUG', title: 'Question LIVE-A' },
            { ticker: 'OLD', category: 'Economics', prob_24h_before: expect.closeTo(.12, 10), outcome: 0, close_time: '2026-07-14T12:25:00Z', odds_time: expect.any(String), series_ticker: 'KXCPI', event_ticker: 'KXCPI-26JUN', title: 'Question OLD' },
        ]);
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO job_state'), ['settled:KXCPI', close.replace('Z', '.000Z')]);
        // Rows stored before the series was recorded get it now, without touching their odds.
        const identity = mocks.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE settled_markets'))!;
        expect(identity[0]).not.toMatch(/prob_24h_before|outcome/);
        expect(identity[1][0]).toBe('KXCPI');
    });
    it('looks only at markets that closed since the last run and skips ones already stored', async () => {
        database(['LIVE-A'], '2026-08-01T00:00:00.000Z');
        mocks.kalshi.mockImplementation(async (path: string) => {
            if (path === '/markets') return { markets: [market('LIVE-A'), market('LIVE-B')] };
            if (path === '/historical/markets') return { markets: [market('OLD', { close_time: '2026-07-14T12:25:00Z' })] };
            if (path === '/markets/candlesticks') return { markets: [{ market_ticker: 'LIVE-B', candlesticks: [candle(mark, '0.4000', '0.4400')] }] };
            throw new Error(`unexpected ${path}`);
        });
        expect(await backfillSeries('KXCPI', 'Economics')).toEqual({ settled: 3, recent: 2, short: 0, scored: 1, noQuote: 0 });
        expect(mocks.kalshi).toHaveBeenCalledWith('/markets/candlesticks', expect.objectContaining({ market_tickers: 'LIVE-B' }));
        expect(inserted().map((row: { ticker: string }) => row.ticker)).toEqual(['LIVE-B']);
    });
    it('names a very large series’ markets to the database a batch at a time', async () => {
        // An hourly series: thousands of markets, each listed for under a day, plus one that can be scored.
        const hourly = Array.from({ length: 2 * DB_BATCH + 10 }, (_, i) => market(`H-${i}`, { open_time: '2026-09-11T00:00:00Z' }));
        database(['H-3', `H-${DB_BATCH + 1}`]);
        mocks.kalshi.mockImplementation(async (path: string) => {
            if (path === '/markets') return { markets: [...hourly, market('LONG')] };
            if (path === '/historical/markets') return { markets: [] };
            if (path === '/markets/candlesticks') return { markets: [{ market_ticker: 'LONG', candlesticks: [candle(mark, '0.4000', '0.4400')] }] };
            throw new Error(`unexpected ${path}`);
        });
        // The two already stored are not counted again as short-lived.
        expect(await backfillSeries('KXHOURLY', 'Financials')).toEqual({ settled: 2 * DB_BATCH + 11, recent: 2 * DB_BATCH + 11, short: 2 * DB_BATCH + 8, scored: 1, noQuote: 0 });
        const sizes = (text: string, size: (values: unknown[]) => number) => mocks.query.mock.calls.filter(([sql]) => String(sql).includes(text)).map(([, values]) => size(values));
        expect(sizes('UPDATE settled_markets', values => JSON.parse(values[1] as string).length)).toEqual([DB_BATCH, DB_BATCH, 11]);
        expect(sizes('SELECT ticker FROM settled_markets', values => (values[0] as string[]).length)).toEqual([DB_BATCH, DB_BATCH, 11]);
        expect(inserted().map((row: { ticker: string }) => row.ticker)).toEqual(['LONG']);
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO job_state'), ['settled:KXHOURLY', close.replace('Z', '.000Z')]);
    });
    it('keeps a series’ place when Kalshi fails, and carries on with the next series', async () => {
        mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM snapshot_series') ? [{ series_ticker: 'BROKEN', category: 'Economics' }, { series_ticker: 'NOCAT', category: null }, { series_ticker: 'FINE', category: 'Financials' }] : []);
        mocks.kalshi.mockImplementation(async (path: string, params: Record<string, string>) => {
            if (params.series_ticker === 'BROKEN') throw new Error('Kalshi retry limit');
            if (path === '/markets') return { markets: [market('F1')] };
            if (path === '/historical/markets') return { markets: [] };
            return { markets: [{ market_ticker: 'F1', candlesticks: [candle(mark, '0.4000', '0.4400')] }] };
        });
        await backfill();
        const states = mocks.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO job_state')).map(([, values]) => values[0]);
        expect(states).toEqual(['stopped-task:backfill:series:BROKEN', 'settled:FINE']);
        expect(mocks.kalshi.mock.calls.some(([, params]) => params.series_ticker === 'NOCAT')).toBe(false);
        expect(console.warn).toHaveBeenCalledWith('Backfill stopped after failure; automatic retries disabled', 'BROKEN');
    });
});
