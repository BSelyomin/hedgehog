import { refreshSnapshotSeries, storePollPage } from './poll-storage.ts';
import { kalshi } from '../services/kalshi.ts';
import type { KalshiEvent } from '../services/kalshi.ts';
import { query } from '../db.ts';
export async function poll() {
    const serverless = process.env.VERCEL === '1', started = Date.now();
    // A large first import must advance across invocations rather than start
    // again at page one when the function's duration ends. A page is acknowledged
    // only after its markets and odds are safely stored.
    let cursor = serverless ? (await query<{ cursor: string }>(
        'SELECT cursor FROM job_state WHERE name=$1', ['vercel-poll-cursor']))[0]?.cursor ?? '' : '';
    const seen = new Set<string>();
    let count = 0;
    // Decide once per poll which series keep odds history, so newly approved tags take effect here.
    const linkable = await refreshSnapshotSeries();
    do {
        const page = await kalshi<{
            events: KalshiEvent[];
            cursor: string;
        }>('/events', { status: 'open', with_nested_markets: 'true', limit: '200', ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(page.events))
            throw new Error('Invalid events response');
        count += await storePollPage(page.events, new Date(), linkable);
        console.log('Kalshi events loaded', count);
        cursor = page.cursor ?? '';
        if (cursor && seen.has(cursor))
            throw new Error('Repeated pagination cursor');
        seen.add(cursor);
        if (serverless) {
            await query(`INSERT INTO job_state(name,cursor) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor,updated_at=now()`, ['vercel-poll-cursor', cursor]);
            // Leave room within 800 seconds for a slow page's Kalshi backoff,
            // transaction writes and cursor acknowledgement.
            if (cursor && Date.now() - started >= 300000) {
                console.log('Kalshi poll yielded; the next schedule continues from the saved page');
                return;
            }
        }
    } while (cursor);
    console.log('Kalshi poll complete');
}
