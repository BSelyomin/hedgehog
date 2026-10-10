import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../services/kalshi.ts', async original => ({ ...await original<typeof import('../services/kalshi.ts')>(), kalshi: vi.fn() }));
import { kalshi } from '../services/kalshi.ts';
import { loadCandles } from './backfill.ts';
beforeEach(() => vi.resetAllMocks());
it('falls back to archived dollar quotes when a live request returns no candles', async () => {
    vi.mocked(kalshi).mockResolvedValueOnce({ candlesticks: [] }).mockResolvedValueOnce({ candlesticks: [{ end_period_ts: 123, yes_bid: { close: '.2' }, yes_ask: { close: '.4' } }] });
    const data = await loadCandles('S', 'M', {}, false);
    expect(kalshi).toHaveBeenLastCalledWith('/historical/markets/M/candlesticks', {});
    expect(data[0].yes_bid.close_dollars).toBe('.2');
});
it('skips genuinely missing quotes without blocking pagination, but propagates outages', async () => {
    vi.mocked(kalshi).mockResolvedValueOnce({ candlesticks: [] }).mockRejectedValueOnce(new Error('Kalshi HTTP 404'));
    expect(await loadCandles('S', 'M', {}, false)).toEqual([]);
    vi.mocked(kalshi).mockRejectedValueOnce(new Error('Kalshi retry limit'));
    await expect(loadCandles('S', 'M', {}, true)).rejects.toThrow('Kalshi retry limit');
});
