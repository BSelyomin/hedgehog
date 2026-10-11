import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), kalshi: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query }));
vi.mock('../services/kalshi.ts', async original => ({ ...await original<typeof import('../services/kalshi.ts')>(), kalshi: mocks.kalshi }));
import { LOOKBACK_DAYS, OTHER_HORIZONS, backfillSeriesTimeframes, backfillTimeframes, oddsStandingAt } from './backfill.ts';

const DAY = 86400, HOUR = 3600;
const close = '2026-09-11T12:25:00Z', closed = Date.parse(close) / 1000;
const candle = (end: number, bid: string | null, ask: string | null) => ({ end_period_ts: end, yes_bid: { close_dollars: bid }, yes_ask: { close_dollars: ask } });

describe('the quote standing at each timeframe', () => {
    it('covers the timeframes other than 24 hours', () => {
        expect([...OTHER_HORIZONS].sort((a, b) => a - b)).toEqual([1, 168, 720]);
    });
    it('reads the last quote published at or before the mark, with its bid and ask', () => {
        for (const hours of OTHER_HORIZONS) {
            const mark = closed - hours * HOUR;
            // Kalshi publishes a candlestick only when the quote changes, so one from nine hours earlier was still standing.
            expect(oddsStandingAt([candle(mark - 30 * HOUR, '0.2000', '0.2400'), candle(mark - 9 * HOUR, '0.3000', '0.3400')], close, hours)).toEqual({ probability: .32, bid: .3, ask: .34, ts: mark - 9 * HOUR });
            expect(oddsStandingAt([candle(mark, '0.6000', '0.6400')], close, hours)?.ts).toBe(mark);
            // Never one from after the mark.
            expect(oddsStandingAt([candle(mark + 60, '0.9000', '0.9400'), candle(closed, '0.9900', '1.0000')], close, hours)).toBeNull();
            expect(oddsStandingAt([candle(mark - HOUR, '0.3000', '0.3400'), candle(mark + 60, '0.9000', '0.9400')], close, hours)?.probability).toBe(.32);
        }
    });
    it('gives no reading from a quote more than a week old, or from an empty book at the mark', () => {
        const mark = closed - 168 * HOUR;
        expect(oddsStandingAt([candle(mark - LOOKBACK_DAYS * DAY - 1, '0.3000', '0.3400')], close, 168)).toBeNull();
        expect(oddsStandingAt([candle(mark - LOOKBACK_DAYS * DAY, '0.3000', '0.3400')], close, 168)?.ts).toBe(mark - LOOKBACK_DAYS * DAY);
        expect(oddsStandingAt([candle(mark - 5 * HOUR, '0.3000', '0.3400'), candle(mark - HOUR, '0.0000', '1.0000')], close, 168)).toBeNull();
        expect(oddsStandingAt([], close, 168)).toBeNull();
    });
});

describe('filling the other timeframes for a series', () => {
    // A and B are still in Kalshi's live listing and close together. NEW was listed two days before
    // its close. OLD has moved to the archive. A already has its 1-hour row.
    const stored = [['A', 1], ['B', 0], ['NEW', 1], ['OLD', 0]].map(([ticker, outcome]) => ({ ticker, category: 'Economics', close_time: new Date(close), outcome, event_ticker: `E-${ticker}`, title: `Question ${ticker}` }));
    let answered: { ticker: string; horizon_hours: number }[], inserted: { table: string; rows: Record<string, unknown>[] }[], requests: { path: string; params: Record<string, string> }[];
    beforeEach(() => {
        answered = [{ ticker: 'A', horizon_hours: 1 }]; inserted = []; requests = [];
        vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.query.mockReset(); mocks.kalshi.mockReset();
        mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
            if (sql.includes('FROM event_releases')) return [{ event_ticker: 'E-B', released_at: new Date((closed - 200 * HOUR) * 1000) }];
            if (sql.includes('GROUP BY series_ticker')) return [{ series_ticker: 'BROKEN' }, { series_ticker: 'S' }];
            if (sql.includes('FROM settled_markets WHERE series_ticker')) return values[0] === 'S' ? stored : values[0] === 'BROKEN' ? [{ ...stored[0], ticker: 'X' }] : [];
            if (sql.includes('UNION SELECT ticker,horizon_hours FROM backfill_skips')) return values[0] === 'S' ? answered : [];
            const table = sql.match(/INSERT INTO (forecast_observations|backfill_skips)/)?.[1];
            if (table) { const rows = JSON.parse(String(values[0])); inserted.push({ table, rows }); for (const row of rows) answered.push({ ticker: row.ticker, horizon_hours: row.horizon_hours }); }
            return [];
        });
        mocks.kalshi.mockImplementation(async (path: string, params: Record<string, string> = {}) => {
            requests.push({ path, params });
            if (path === '/markets') {
                if (params.series_ticker === 'BROKEN') throw new Error('Kalshi retry limit');
                return { markets: ['A', 'B', 'NEW'].map(ticker => ({ ticker, event_ticker: `E-${ticker}`, title: ticker, close_time: close, status: 'settled', result: 'yes', open_time: ticker === 'NEW' ? new Date((closed - 2 * DAY) * 1000).toISOString() : '2026-01-01T00:00:00Z' })) };
            }
            const end = Number(params.end_ts);
            if (path === '/markets/candlesticks')
                // B's book was empty at every mark; A and NEW had a quote two hours before it.
                return { markets: params.market_tickers.split(',').map(ticker => ({ market_ticker: ticker, candlesticks: ticker === 'B' ? [candle(end - HOUR, '0.0000', '1.0000')] : [candle(end - 2 * HOUR, '0.4000', '0.4400')] })) };
            if (path === '/historical/markets/OLD/candlesticks')
                // The archive has OLD's quote at the 7-day mark, nothing at 30 days, and no entry at all an hour before close.
                return end === closed - 168 * HOUR ? { candlesticks: [{ end_period_ts: end - HOUR, yes_bid: { close: '0.7000' }, yes_ask: { close: '0.7400' } }] } : end === closed - 720 * HOUR ? { candlesticks: [] } : Promise.reject(new Error('Kalshi HTTP 404'));
            if (path === '/historical/markets/B/candlesticks') return { candlesticks: [] };
            throw new Error(`unexpected request ${path}`);
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });
    const rowsOf = (table: string) => inserted.filter(insert => insert.table === table).flatMap(insert => insert.rows);

    it('stores the standing quote for each market and timeframe, and a skip where there is none', async () => {
        const result = await backfillSeriesTimeframes('S', new Map([['E-B', new Date((closed - 200 * HOUR) * 1000)]]));
        const readings = rowsOf('forecast_observations').map(r => `${r.ticker}|${r.horizon_hours}`).sort();
        // A at 7 and 30 days (its 1-hour row was already there), NEW an hour before close, OLD at 7 days.
        expect(readings).toEqual(['A|168', 'A|720', 'NEW|1', 'OLD|168']);
        expect(rowsOf('forecast_observations').find(r => r.ticker === 'A' && r.horizon_hours === 168)).toEqual({ ticker: 'A', horizon_hours: 168, series_ticker: 'S', event_ticker: 'E-A', title: 'Question A', category: 'Economics',
            yes_bid: .4, yes_ask: .44, outcome: 1, close_time: new Date(close).toISOString(), odds_time: new Date((closed - 168 * HOUR - 2 * HOUR) * 1000).toISOString() });
        expect(rowsOf('forecast_observations').find(r => r.ticker === 'OLD')).toMatchObject({ yes_bid: .7, yes_ask: .74, outcome: 0, odds_time: new Date((closed - 169 * HOUR) * 1000).toISOString() });
        const skips = rowsOf('backfill_skips').map(r => `${r.ticker}|${r.horizon_hours}|${r.reason}`).sort();
        // B's book was empty at every mark. NEW was not listed 7 or 30 days before its close. OLD has no archive an hour before close and no quote at 30 days.
        expect(skips).toEqual(['B|168|no_quote', 'B|1|no_quote', 'B|720|no_quote', 'NEW|168|no_quote', 'NEW|720|no_quote', 'OLD|1|no_quote', 'OLD|720|no_quote']);
        expect(result).toEqual({ markets: 4, scored: 4, skipped: 7 });
    });
    it('asks for the live markets of a close together, over the week before each mark, and never for one not yet listed', async () => {
        await backfillSeriesTimeframes('S');
        const batches = requests.filter(r => r.path === '/markets/candlesticks');
        expect(batches.map(r => [r.params.market_tickers, Number(r.params.end_ts), Number(r.params.end_ts) - Number(r.params.start_ts), r.params.period_interval])).toEqual([
            ['A,B', closed - 720 * HOUR, LOOKBACK_DAYS * DAY, '60'],
            ['A,B', closed - 168 * HOUR, LOOKBACK_DAYS * DAY, '60'],
            ['B,NEW', closed - HOUR, LOOKBACK_DAYS * DAY, '60'],
        ]);
        // The archive is asked about OLD at each mark, and about B, which the batch had no quote for.
        expect(requests.filter(r => r.path.startsWith('/historical/')).map(r => r.path.split('/')[3]).sort()).toEqual(['B', 'B', 'B', 'OLD', 'OLD', 'OLD']);
    });
    it('leaves out a quote published after the result was known', async () => {
        // B now has a quote; its result was released 200 hours before close, before the 7-day and 1-hour marks.
        mocks.kalshi.mockImplementation(async (path: string, params: Record<string, string> = {}) => path === '/markets'
            ? { markets: [{ ticker: 'B', event_ticker: 'E-B', title: 'B', close_time: close, status: 'settled', result: 'no', open_time: '2026-01-01T00:00:00Z' }] }
            : { markets: params.market_tickers.split(',').map(ticker => ({ market_ticker: ticker, candlesticks: [candle(Number(params.end_ts) - HOUR, '0.1000', '0.1400')] })) });
        mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
            if (sql.includes('FROM settled_markets WHERE series_ticker')) return [stored[1]];
            const table = sql.match(/INSERT INTO (forecast_observations|backfill_skips)/)?.[1];
            if (table) inserted.push({ table, rows: JSON.parse(String(values[0])) });
            return [];
        });
        await backfillSeriesTimeframes('S', new Map([['E-B', new Date((closed - 200 * HOUR) * 1000)]]));
        expect(rowsOf('forecast_observations').map(r => r.horizon_hours)).toEqual([720]);
        expect(rowsOf('backfill_skips').map(r => `${r.horizon_hours}|${r.reason}`).sort()).toEqual(['168|outcome_known', '1|outcome_known']);
    });
    it('asks Kalshi nothing once every market has a row or a skip', async () => {
        await backfillSeriesTimeframes('S');
        requests = [];
        expect(await backfillSeriesTimeframes('S')).toEqual({ markets: 4, scored: 0, skipped: 0 });
        expect(requests).toEqual([]);
    });
    it('carries on with the other series when one fails, and leaves it for the next run', async () => {
        await backfillTimeframes();
        expect(console.warn).toHaveBeenCalledWith('Backfill retry needed', 'BROKEN');
        expect(rowsOf('forecast_observations').length).toBe(4);
        expect(console.log).toHaveBeenCalledWith('Timeframes complete', JSON.stringify({ series: 1, failed: 1, scored: 4, skipped: 7 }));
        // Nothing was stored for the series that failed.
        expect(inserted.flatMap(insert => insert.rows).some(row => row.ticker === 'X')).toBe(false);
    });
});
