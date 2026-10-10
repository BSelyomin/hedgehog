import { pool } from '../db.ts';
import { quote, numberField } from '../services/kalshi.ts';
import type { KalshiEvent } from '../services/kalshi.ts';

export function preparePollPage(input: KalshiEvent[], ts: Date) {
    const events = new Map(), markets = new Map(), quotes = new Map();
    const positive = (value: unknown) => { const n = numberField(value); return n !== null && n >= 0 ? n : null; };
    const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
    for (const event of input) {
        if (!event.event_ticker || !event.series_ticker || !event.title || !event.category) continue;
        events.set(event.event_ticker, { ticker: event.event_ticker, series_ticker: event.series_ticker, title: event.title, description: event.sub_title ?? '', category: event.category, mutually_exclusive: event.mutually_exclusive === true, updated_at: ts, strike_date: time(event.strike_date) });
        for (const m of event.markets ?? []) {
            if (!m.ticker || !m.title || !m.status || !Number.isFinite(Date.parse(m.close_time))) {
                console.warn('Skipped invalid market', m.ticker);
                continue;
            }
            markets.set(m.ticker, { ticker: m.ticker, event_ticker: event.event_ticker, series_ticker: event.series_ticker, title: m.title, subtitle: m.yes_sub_title ?? m.subtitle ?? '', close_time: m.close_time, status: m.status, result: m.result ?? null, strike_type: m.strike_type ?? null, updated_at: ts, occurrence_time: time(m.occurrence_datetime), expected_expiration_time: time(m.expected_expiration_time) });
            const q = quote(m.yes_bid_dollars, m.yes_ask_dollars);
            quotes.delete(m.ticker);
            if (q && m.status === 'active') quotes.set(m.ticker, { ts, ticker: m.ticker, yes_bid: q.bid, yes_ask: q.ask, mid: q.mid, volume_24h: positive(m.volume_24h_fp), open_interest: positive(m.open_interest_fp) });
        }
    }
    return { events: [...events.values()], markets: [...markets.values()], quotes: [...quotes.values()] };
}

export async function storePollPage(input: KalshiEvent[], ts: Date) {
    const rows = preparePollPage(input, ts);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO events SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(ticker text,series_ticker text,title text,description text,category text,mutually_exclusive boolean,updated_at timestamptz,strike_date timestamptz)
            ON CONFLICT(ticker) DO UPDATE SET title=excluded.title,description=excluded.description,category=excluded.category,mutually_exclusive=excluded.mutually_exclusive,updated_at=excluded.updated_at,strike_date=excluded.strike_date`, [JSON.stringify(rows.events)]);
        await client.query(`INSERT INTO markets SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(ticker text,event_ticker text,series_ticker text,title text,subtitle text,close_time timestamptz,status text,result text,strike_type text,updated_at timestamptz,occurrence_time timestamptz,expected_expiration_time timestamptz)
            ON CONFLICT(ticker) DO UPDATE SET title=excluded.title,subtitle=excluded.subtitle,close_time=excluded.close_time,status=excluded.status,result=excluded.result,strike_type=excluded.strike_type,updated_at=excluded.updated_at,occurrence_time=excluded.occurrence_time,expected_expiration_time=excluded.expected_expiration_time`, [JSON.stringify(rows.markets)]);
        await client.query(`INSERT INTO odds_snapshots SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(ts timestamptz,ticker text,yes_bid double precision,yes_ask double precision,mid double precision,volume_24h double precision,open_interest double precision) ON CONFLICT DO NOTHING`, [JSON.stringify(rows.quotes)]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
    return rows.events.length;
}
