import type { MoveRange, MovesResponse } from '../../../shared/types.ts';
import { getHoldings, portfolioRevision } from './holdings.ts';
import { moves } from './moves.ts';
import { completedPriceDate } from './price-date.ts';
import { timed } from './request-timing.ts';

const CACHE_MS = 5 * 60_000, MAX_SNAPSHOTS = 32;
const snapshots = new Map<string, { promise: Promise<MovesResponse>; until: number }>();

// Cache page reads, while the uncached builder remains available to jobs. Different
// dates/ranges retain their own source closes; latest-session requests stay distinct.
export async function cachedMoves(session: string, date?: string, range: MoveRange = 'day', refresh = false): Promise<MovesResponse> {
    const portfolio = await timed('holdings', () => getHoldings(session));
    const key = JSON.stringify([session, portfolioRevision(portfolio), date ?? null, range, completedPriceDate(new Date(Date.now()))]);
    const saved = snapshots.get(key);
    if (!refresh && saved && saved.until > Date.now()) {
        snapshots.delete(key); snapshots.set(key, saved);
        return structuredClone(await timed('moves_cache_hit', () => saved.promise));
    }
    const entry: { promise: Promise<MovesResponse>; until: number } = {
        until: Infinity,
        promise: timed('moves_build', async () => {
            const data = await moves(session, date, portfolio, range);
            entry.until = Date.now() + CACHE_MS;
            return data;
        })
    };
    snapshots.delete(key); snapshots.set(key, entry);
    if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!);
    void entry.promise.catch(() => { if (snapshots.get(key) === entry) snapshots.delete(key); });
    return structuredClone(await entry.promise);
}
