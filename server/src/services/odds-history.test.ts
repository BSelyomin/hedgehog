import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query, iso: (value: Date | null) => value ? new Date(value).toISOString() : null }));
import { ODDS_RANGES, isOddsRange, oddsHistory } from './odds-history.ts';

const now = new Date('2026-10-10T15:00:00Z'), listed = new Date('2025-10-13T14:00:00Z');
beforeEach(() => mocks.query.mockReset());

it('accepts only the four ranges', () => {
    expect(Object.keys(ODDS_RANGES)).toEqual(['day', 'week', 'month', 'all']);
    expect(['day', 'week', 'month', 'all'].every(isOddsRange)).toBe(true);
    expect([undefined, '', 'year', 'toString', ['day'], 7].some(isOddsRange)).toBe(false);
});
it('returns nothing for a market that is not stored', async () => {
    mocks.query.mockResolvedValueOnce([]);
    expect(await oddsHistory('MISSING', 'week', now)).toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
});
it('draws the past day from every stored reading and the hourly closes', async () => {
    mocks.query.mockResolvedValueOnce([{ open_time: listed }]).mockResolvedValueOnce([{ ts: new Date('2026-10-09T16:00:00Z'), mid: .41 }, { ts: new Date('2026-10-10T14:55:00Z'), mid: .45 }]);
    const result = await oddsHistory('M', 'day', now);
    const [sql, values] = mocks.query.mock.calls[1];
    expect(sql).toContain('FROM odds_snapshots WHERE ticker=$1 AND ts>=$2');
    expect(sql).toContain('FROM odds_candles WHERE ticker=$1 AND minutes=$3 AND ts>=$2 ORDER BY ts');
    expect(sql).not.toContain('DISTINCT ON');
    expect(values).toEqual(['M', new Date('2026-10-09T15:00:00Z'), 60]);
    expect(result).toEqual({ ticker: 'M', range: 'day', from: '2026-10-09T15:00:00.000Z', to: '2026-10-10T15:00:00.000Z', listed: '2025-10-13T14:00:00.000Z', asOf: '2026-10-10T14:55:00.000Z',
        points: [{ ts: '2026-10-09T16:00:00.000Z', probability: .41 }, { ts: '2026-10-10T14:55:00.000Z', probability: .45 }] });
});
it('thins its own readings to one an hour for the week and to the latest for longer ranges', async () => {
    const cases = [['week', '2026-10-03T15:00:00Z', 60, 'DISTINCT ON (date_trunc('], ['month', '2026-09-10T15:00:00Z', 1440, 'ORDER BY ts DESC LIMIT 1'], ['all', listed.toISOString(), 1440, 'ORDER BY ts DESC LIMIT 1']] as const;
    for (const [range, from, minutes, own] of cases) {
        mocks.query.mockReset().mockResolvedValueOnce([{ open_time: listed }]).mockResolvedValueOnce([]);
        const result = await oddsHistory('M', range, now);
        const [sql, values] = mocks.query.mock.calls[1];
        expect(sql, range).toContain(own);
        expect(values, range).toEqual(['M', new Date(from), minutes]);
        expect(result, range).toMatchObject({ from: new Date(from).toISOString(), points: [], asOf: null });
        // A reading with no bid and no offer is never drawn.
        expect(sql, range).toContain('NOT (yes_bid<=0 AND yes_ask>=1)');
    }
});
it('starts all time at the first reading when the listing time is not known yet', async () => {
    mocks.query.mockResolvedValueOnce([{ open_time: null }]).mockResolvedValueOnce([{ ts: new Date('2026-10-01T04:00:00Z'), mid: .3 }]);
    expect(await oddsHistory('M', 'all', now)).toMatchObject({ from: '2026-10-01T04:00:00.000Z', listed: null });
    expect(mocks.query.mock.calls[1][1][1]).toEqual(new Date(0));
    mocks.query.mockReset().mockResolvedValueOnce([{ open_time: null }]).mockResolvedValueOnce([]);
    expect(await oddsHistory('M', 'all', now)).toMatchObject({ from: null, points: [] });
});
