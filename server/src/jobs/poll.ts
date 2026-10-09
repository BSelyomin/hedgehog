import { pool } from '../db.ts';
import { kalshi, quote, numberField } from '../services/kalshi.ts';
import type { KalshiEvent } from '../services/kalshi.ts';
export async function poll() {
    let cursor = '';
    const seen = new Set<string>();
    const ts = new Date();
    do {
        const page = await kalshi<{
            events: KalshiEvent[];
            cursor: string;
        }>('/events', { status: 'open', with_nested_markets: 'true', limit: '200', ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(page.events))
            throw new Error('Invalid events response');
        for (const event of page.events) {
            if (!event.event_ticker || !event.series_ticker || !event.title || !event.category)
                continue;
            await pool.query(`INSERT INTO events VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(ticker) DO UPDATE SET title=excluded.title,description=excluded.description,category=excluded.category,mutually_exclusive=excluded.mutually_exclusive,updated_at=excluded.updated_at`, [event.event_ticker, event.series_ticker, event.title, event.sub_title ?? '', event.category, event.mutually_exclusive === true, ts]);
            for (const m of event.markets ?? []) {
                const client = await pool.connect();
                try {
                    if (!m.ticker || !m.title || !m.status || !Number.isFinite(Date.parse(m.close_time)))
                        throw new Error('Invalid market');
                    await client.query('BEGIN');
                    await client.query(`INSERT INTO markets VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(ticker) DO UPDATE SET title=excluded.title,subtitle=excluded.subtitle,close_time=excluded.close_time,status=excluded.status,result=excluded.result,strike_type=excluded.strike_type,updated_at=excluded.updated_at`, [m.ticker, event.event_ticker, event.series_ticker, m.title, m.yes_sub_title ?? m.subtitle ?? '', m.close_time, m.status, m.result ?? null, m.strike_type ?? null, ts]);
                    const q = quote(m.yes_bid_dollars, m.yes_ask_dollars);
                    if (q && m.status === 'active')
                        await client.query(`INSERT INTO odds_snapshots VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [ts, m.ticker, q.bid, q.ask, q.mid, numberField(m.volume_24h_fp), numberField(m.open_interest_fp)]);
                    await client.query('COMMIT');
                }
                catch {
                    await client.query('ROLLBACK');
                    console.warn('Skipped invalid market', m.ticker);
                }
                finally {
                    client.release();
                }
            }
        }
        cursor = page.cursor ?? '';
        if (cursor && seen.has(cursor))
            throw new Error('Repeated pagination cursor');
        seen.add(cursor);
    } while (cursor);
    console.log('Kalshi poll complete');
}
