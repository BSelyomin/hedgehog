import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../services/kalshi.ts', async original => ({ ...await original<typeof import('../services/kalshi.ts')>(), kalshi: vi.fn() }));
import { kalshi } from '../services/kalshi.ts';
import { loadCandles, outcomeAlreadyKnown, oddsBeforeClose } from './backfill.ts';
beforeEach(() => vi.resetAllMocks());
it('falls back to archived dollar quotes when a live request returns no candles', async () => {
    vi.mocked(kalshi).mockResolvedValueOnce({ candlesticks: [] }).mockResolvedValueOnce({ candlesticks: [{ end_period_ts: 123, yes_bid: { close: '.2' }, yes_ask: { close: '.4' } }] });
    const data = await loadCandles('S', 'M', {}, false);
    expect(kalshi).toHaveBeenLastCalledWith('/historical/markets/M/candlesticks', {});
    expect(data[0].yes_bid.close_dollars).toBe('.2');
});
it('selects independent quotes at all three horizons and rejects future or stale candles', () => {
    const close = '2026-10-10T12:30:00Z', end = Date.parse(close)/1000;
    const candles = [{hours:24,bid:'.7',ask:'.9'},{hours:168,bid:'.4',ask:'.6'},{hours:720,bid:'.1',ask:'.3'}].map(h=>({end_period_ts:end-h.hours*3600,yes_bid:{close_dollars:h.bid},yes_ask:{close_dollars:h.ask}}));
    expect(oddsBeforeClose(candles,close,24)?.probability).toBeCloseTo(.8);
    expect(oddsBeforeClose(candles,close,168)?.probability).toBeCloseTo(.5);
    expect(oddsBeforeClose(candles,close,720)?.probability).toBeCloseTo(.2);
    expect(oddsBeforeClose([candles[0]],close,168)).toBeNull();
    expect(oddsBeforeClose([{...candles[1],end_period_ts:candles[1].end_period_ts+1}],close,168)).toBeNull();
    expect(oddsBeforeClose([{...candles[1],end_period_ts:candles[1].end_period_ts-61}],close,168)).toBeNull();
    expect(()=>oddsBeforeClose(candles,close,48)).toThrow('Unsupported');
});
it('skips genuinely missing quotes without blocking pagination, but propagates outages', async () => {
    vi.mocked(kalshi).mockResolvedValueOnce({ candlesticks: [] }).mockRejectedValueOnce(new Error('Kalshi HTTP 404'));
    expect(await loadCandles('S', 'M', {}, false)).toEqual([]);
    vi.mocked(kalshi).mockRejectedValueOnce(new Error('Kalshi retry limit'));
    await expect(loadCandles('S', 'M', {}, true)).rejects.toThrow('Kalshi retry limit');
});
it('excludes quotes taken at or after the underlying event', () => {
    const quoteTs = Date.parse('2026-09-10T12:25:00Z') / 1000;
    expect(outcomeAlreadyKnown({ occurrence_datetime: '2026-09-10T12:00:00Z' }, quoteTs)).toBe(true);
    expect(outcomeAlreadyKnown({ occurrence_datetime: '2026-09-11T13:11:28Z' }, quoteTs)).toBe(false);
    expect(outcomeAlreadyKnown({}, quoteTs)).toBe(false);
    expect(outcomeAlreadyKnown({ occurrence_datetime: 'bad' }, quoteTs)).toBe(false);
    expect(outcomeAlreadyKnown({occurrence_datetime:'2026-09-11T13:11:28Z'},quoteTs,new Date('2026-09-10T12:00:00Z'))).toBe(true);
});
