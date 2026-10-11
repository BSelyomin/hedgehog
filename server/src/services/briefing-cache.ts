import type { BriefingResponse } from '../../../shared/types.ts';
import { briefingIdentity, briefingResponse } from '../jobs/briefing.ts';
import { contentHash } from './ai-cache.ts';
import { briefingDay } from './briefing-content.ts';
import { getHoldings } from './holdings.ts';
import { timed } from './request-timing.ts';

const CACHE_MS = 5 * 60_000, MAX_SNAPSHOTS = 32;
interface Snapshot { promise: Promise<BriefingResponse>; until: number }
const snapshots = new Map<string, Snapshot>();

// Cache only the small JSON response, not audio. Check current holdings before
// reuse; AI/audio remain in their existing durable cache and are never generated here.
export async function cachedBriefingResponse(session: string, refresh = false): Promise<BriefingResponse> {
    const portfolio = await timed('holdings', () => getHoldings(session));
    const key = contentHash({ identity: briefingIdentity(session, portfolio), day: briefingDay(new Date(Date.now())) });
    const saved = snapshots.get(key);
    if (!refresh && saved && saved.until > Date.now()) {
        snapshots.delete(key); snapshots.set(key, saved);
        return structuredClone(await timed('briefing_cache_hit', () => saved.promise));
    }
    const entry: Snapshot = { until: Infinity, promise: timed('briefing_read', async () => {
        const data = await briefingResponse(session, portfolio);
        entry.until = Date.now() + CACHE_MS;
        // A scheduled or explicit generator may fill a missing briefing at any
        // moment. Do not retain that absence or let an older read clear a refresh.
        if (!data.generatedAt && snapshots.get(key) === entry) snapshots.delete(key);
        return data;
    }) };
    snapshots.delete(key); snapshots.set(key, entry);
    if (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!);
    void entry.promise.catch(() => { if (snapshots.get(key) === entry) snapshots.delete(key); });
    return structuredClone(await entry.promise);
}
