import { storePollPage } from './poll-storage.ts';
import { kalshi } from '../services/kalshi.ts';
import type { KalshiEvent } from '../services/kalshi.ts';
export async function poll() {
    let cursor = '';
    const seen = new Set<string>();
    let count = 0;
    do {
        const page = await kalshi<{
            events: KalshiEvent[];
            cursor: string;
        }>('/events', { status: 'open', with_nested_markets: 'true', limit: '200', ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(page.events))
            throw new Error('Invalid events response');
        count += await storePollPage(page.events, new Date());
        console.log('Kalshi events loaded', count);
        cursor = page.cursor ?? '';
        if (cursor && seen.has(cursor))
            throw new Error('Repeated pagination cursor');
        seen.add(cursor);
    } while (cursor);
    console.log('Kalshi poll complete');
}
