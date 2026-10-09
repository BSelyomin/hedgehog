import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../db.ts', () => ({ query: vi.fn().mockResolvedValue([]) }));
import { query } from '../db.ts';
import { storePrices } from './price-storage.ts';
beforeEach(() => vi.clearAllMocks());

it('keeps every date paired with its source price across batch boundaries', async () => {
    const rows = Array.from({ length: 1251 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), close: 100 + i / 100 }));
    await storePrices('SPY', rows);
    const batches = vi.mocked(query).mock.calls.map(call => call[1]!);
    expect(batches.map(args => (args[1] as string[]).length)).toEqual([500, 500, 251]);
    expect(batches.every(args => args[0] === 'SPY')).toBe(true);
    expect(batches.flatMap(args => (args[1] as string[]).map((date, i) => ({ date, close: (args[2] as number[])[i] })))).toEqual(rows);
});

it('does not write an empty history and surfaces database failures', async () => {
    await storePrices('SPY', []);
    expect(query).not.toHaveBeenCalled();
    vi.mocked(query).mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(storePrices('SPY', [{ date: '2026-10-08', close: 100 }])).rejects.toThrow('Database unavailable');
});
