import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), client: { query: vi.fn(), release: vi.fn() }, kalshi: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query, pool: { connect: async () => mocks.client } }));
vi.mock('../services/kalshi.ts', async original => ({ ...await original<typeof import('../services/kalshi.ts')>(), kalshi: mocks.kalshi }));
import { MAX_CANDLES, MAX_TICKERS, candleReadings, oddsCandles, planCandleRequests } from './odds-candles.ts';

const NOW = Date.parse('2026-10-10T15:00:00Z') / 1000, HOUR = 3600, DAY = 86400;
const candle = (end: number, bid: string | null, ask: string | null) => ({ end_period_ts: end, yes_bid: { close_dollars: bid }, yes_ask: { close_dollars: ask } });

describe('planning candlestick requests', () => {
    const periods = (request: { start: number; end: number }, minutes: number) => Math.ceil((request.end - request.start) / (minutes * 60)) + 1;
    it('asks for a hundred markets at a time when the window is short', () => {
        const needs = Array.from({ length: 250 }, (_, i) => ({ ticker: `M${String(i).padStart(3, '0')}`, start: NOW - 2 * HOUR }));
        const plan = planCandleRequests(needs, NOW, 60);
        expect(plan.map(request => request.tickers.length)).toEqual([100, 100, 50]);
        expect(plan.flatMap(request => request.tickers).sort()).toEqual(needs.map(need => need.ticker));
    });
    it('asks for fewer markets as the window grows, so no reply is cut off at the limit', () => {
        const needs = [...Array.from({ length: 60 }, (_, i) => ({ ticker: `OLD${i}`, start: NOW - 400 * DAY })), ...Array.from({ length: 300 }, (_, i) => ({ ticker: `NEW${i}`, start: NOW - 5 * DAY }))];
        const plan = planCandleRequests(needs, NOW, 1440);
        expect(plan[0]).toMatchObject({ start: NOW - 400 * DAY, end: NOW });
        expect(plan[0].tickers).toHaveLength(Math.floor(MAX_CANDLES / 401));
        for (const request of plan) {
            expect(request.tickers.length).toBeLessThanOrEqual(MAX_TICKERS);
            expect(request.tickers.length * periods(request, 1440)).toBeLessThanOrEqual(MAX_CANDLES);
        }
        // Every market is asked for exactly once, from no later than its own start.
        expect(plan.flatMap(request => request.tickers).sort()).toEqual(needs.map(need => need.ticker).sort());
        for (const need of needs)
            expect(plan.find(request => request.tickers.includes(need.ticker))!.start).toBeLessThanOrEqual(need.start);
    });
    it('asks for nothing when nothing is due', () => {
        expect(planCandleRequests([{ ticker: 'M', start: NOW }, { ticker: 'N', start: NOW + HOUR }], NOW, 60)).toEqual([]);
        expect(planCandleRequests([], NOW, 60)).toEqual([]);
    });
});

describe('reading candlesticks', () => {
    it('takes the midpoint of the closing bid and ask at the end of each finished period', () => {
        expect(candleReadings('M', 60, [candle(NOW - HOUR, '0.4000', '0.4400'), candle(NOW, '0.4300', '0.4500')], NOW)).toEqual([
            { ticker: 'M', minutes: 60, ts: '2026-10-10T14:00:00.000Z', mid: expect.closeTo(.42, 10) },
            { ticker: 'M', minutes: 60, ts: '2026-10-10T15:00:00.000Z', mid: expect.closeTo(.44, 10) },
        ]);
    });
    it('shows no number where the candlestick has no usable quote', () => {
        const readings = candleReadings('M', 1440, [
            candle(NOW - 5 * DAY, '0.0000', '1.0000'),  // nobody bidding or offering
            candle(NOW - 4 * DAY, '0.6000', '0.5000'),  // crossed
            candle(NOW - 3 * DAY, null, '0.5000'),      // no bid published
            candle(NOW - 2 * DAY, '0.0000', '0.0600'),  // an offer alone is still a quote
            candle(NOW + DAY, '0.5000', '0.5200'),      // period not finished
            candle(NOW - DAY + .5, '0.5000', '0.5200'), // malformed time
        ], NOW);
        expect(readings).toEqual([{ ticker: 'M', minutes: 1440, ts: new Date((NOW - 2 * DAY) * 1000).toISOString(), mid: .03 }]);
    });
});

describe('the candlestick job', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW * 1000); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocks.query.mockReset(); mocks.kalshi.mockReset(); mocks.client.query.mockReset(); });
    const stored = () => mocks.client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO odds_candles')).flatMap(([, values]) => JSON.parse(values[0]));
    const progress = () => mocks.client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO candle_progress')).map(([, values]) => values);

    it('fetches from where each market left off, reaching back eight days at most for hourly closes', async () => {
        mocks.query.mockResolvedValueOnce([
            { ticker: 'SEEN', open_time: new Date((NOW - 300 * DAY) * 1000), through: new Date((NOW - 2 * HOUR) * 1000) },
            { ticker: 'FRESH', open_time: new Date((NOW - 300 * DAY) * 1000), through: null },
        ]).mockResolvedValue([]);
        mocks.kalshi.mockResolvedValue({ markets: [{ market_ticker: 'FRESH', candlesticks: [candle(NOW - HOUR, '0.5000', '0.5400')] }, { market_ticker: 'UNASKED', candlesticks: [candle(NOW - HOUR, '0.1000', '0.1200')] }] });
        await oddsCandles(60);
        expect(mocks.kalshi).toHaveBeenCalledTimes(1);
        expect(mocks.kalshi).toHaveBeenCalledWith('/markets/candlesticks', { market_tickers: 'FRESH,SEEN', start_ts: String(NOW - 8 * DAY), end_ts: String(NOW), period_interval: '60' });
        // A market that was not asked for is ignored.
        expect(stored()).toEqual([{ ticker: 'FRESH', minutes: 60, ts: new Date((NOW - HOUR) * 1000).toISOString(), mid: expect.closeTo(.52, 10) }]);
        // The newest period is fetched again next time.
        expect(progress()).toEqual([[['FRESH', 'SEEN'], 60, new Date((NOW - HOUR) * 1000)]]);
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM odds_candles WHERE minutes=$1 AND ts<'), [60, 8]);
    });
    it('reaches back to the listing for daily closes and keeps them', async () => {
        mocks.query.mockResolvedValueOnce([{ ticker: 'LONG', open_time: new Date((NOW - 300 * DAY) * 1000), through: null }]).mockResolvedValue([]);
        mocks.kalshi.mockResolvedValue({ markets: [] });
        await oddsCandles(1440);
        expect(mocks.kalshi).toHaveBeenCalledWith('/markets/candlesticks', expect.objectContaining({ start_ts: String(NOW - 300 * DAY), period_interval: '1440' }));
        expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('WHERE minutes=$1 AND ts<'))).toBe(false);
    });
    it('leaves progress alone when a request fails, and carries on with the rest', async () => {
        mocks.query.mockResolvedValueOnce(Array.from({ length: 150 }, (_, i) => ({ ticker: `M${String(i).padStart(3, '0')}`, open_time: new Date((NOW - DAY) * 1000), through: new Date((NOW - 2 * HOUR) * 1000) }))).mockResolvedValue([]);
        mocks.kalshi.mockRejectedValueOnce(new Error('Kalshi retry limit')).mockResolvedValueOnce({ markets: [{ market_ticker: 'M100', candlesticks: [candle(NOW - HOUR, '0.2000', '0.2200')] }] });
        await oddsCandles(60);
        expect(mocks.kalshi).toHaveBeenCalledTimes(2);
        expect(progress()).toHaveLength(1);
        expect(progress()[0][0]).toHaveLength(50);
        expect(stored().map(reading => reading.ticker)).toEqual(['M100']);
    });
});
