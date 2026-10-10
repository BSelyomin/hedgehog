import { pool, query } from '../db.ts';
import { emptyBook, kalshi, quote } from '../services/kalshi.ts';
import type { Candle } from '../services/kalshi.ts';

// Kalshi's limits on GET /markets/candlesticks: tickers per request, and candlesticks returned
// across all of them.
export const MAX_TICKERS = 100;
export const MAX_CANDLES = 10000;
// Hourly closes serve the chart's day and week ranges and the Moves screen's week. They are
// dropped after twelve days: a week that ended on the last close opens seven days before it, and
// is still being looked at over the weekend and a holiday after. Daily closes serve the longer
// ranges and stay while the market is listed.
export const CANDLE_SERIES = [{ minutes: 60, keepDays: 12 }, { minutes: 1440, keepDays: null }] as const;
export type CandleMinutes = typeof CANDLE_SERIES[number]['minutes'];

export interface CandleNeed {
    ticker: string;
    /** Unix seconds from which candlesticks are still to be fetched. */
    start: number;
}
export interface CandleRequest {
    tickers: string[];
    start: number;
    end: number;
}

// Groups markets into requests, longest window first. A request covers its oldest market's window
// for every ticker in it, so the ticker count shrinks as the window grows to stay inside the limit.
export function planCandleRequests(needs: CandleNeed[], end: number, minutes: number): CandleRequest[] {
    const sorted = needs.filter(need => need.start < end).sort((a, b) => a.start - b.start || a.ticker.localeCompare(b.ticker));
    const requests: CandleRequest[] = [];
    for (let i = 0; i < sorted.length;) {
        const start = sorted[i].start, periods = Math.ceil((end - start) / (minutes * 60)) + 1;
        const size = Math.max(1, Math.min(MAX_TICKERS, Math.floor(MAX_CANDLES / periods)));
        requests.push({ tickers: sorted.slice(i, i + size).map(need => need.ticker), start, end });
        i += size;
    }
    return requests;
}

// One reading per finished period: the midpoint of its closing bid and ask, and the spread
// between them in whole hundredths of a cent, which says how much the midpoint can be trusted.
export function candleReadings(ticker: string, minutes: number, candles: Candle[], end: number) {
    return candles.flatMap(candle => {
        const q = quote(candle.yes_bid?.close_dollars, candle.yes_ask?.close_dollars);
        if (!q || emptyBook(q.bid, q.ask) || !Number.isInteger(candle.end_period_ts) || candle.end_period_ts > end)
            return [];
        return [{ ticker, minutes, ts: new Date(candle.end_period_ts * 1000).toISOString(), mid: q.mid, spread: Math.round((q.ask - q.bid) * 10000) / 10000 }];
    });
}

async function storeCandles(readings: ReturnType<typeof candleReadings>, tickers: string[], minutes: number, through: Date) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // A finished period does not change, so a reading already stored is left alone, except
        // to add the spread to a row stored before spreads were kept.
        await client.query(`INSERT INTO odds_candles(ticker,minutes,ts,mid,spread) SELECT ticker,minutes,ts,mid,spread FROM jsonb_to_recordset($1::jsonb) AS r(ticker text,minutes integer,ts timestamptz,mid double precision,spread real)
            ON CONFLICT(ticker,minutes,ts) DO UPDATE SET spread=excluded.spread WHERE odds_candles.spread IS NULL`, [JSON.stringify(readings)]);
        await client.query(`INSERT INTO candle_progress(ticker,minutes,through) SELECT unnest($1::text[]),$2,$3 ON CONFLICT(ticker,minutes) DO UPDATE SET through=excluded.through`, [tickers, minutes, through]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

// Fetches Kalshi's candlestick closes for every open market that can link to a holding. With no
// argument both series are refreshed; the first run for a market reaches back to its listing, and
// so does a run that finds stored readings without a spread (`unsized`), whoever stored them.
export async function oddsCandles(only?: CandleMinutes) {
    for (const { minutes, keepDays } of CANDLE_SERIES.filter(series => only === undefined || series.minutes === only)) {
        const end = Math.floor(Date.now() / 1000), period = minutes * 60, oldest = keepDays === null ? 0 : end - keepDays * 86400;
        const markets = await query<{ ticker: string; open_time: Date; through: Date | null; unsized: boolean }>(`SELECT m.ticker,m.open_time,p.through,
                EXISTS(SELECT 1 FROM odds_candles c WHERE c.ticker=m.ticker AND c.minutes=$1 AND c.spread IS NULL) AS unsized
            FROM markets m JOIN snapshot_series s USING(series_ticker)
            LEFT JOIN candle_progress p ON p.ticker=m.ticker AND p.minutes=$1 WHERE m.status='active' AND m.close_time>now() AND m.open_time IS NOT NULL`, [minutes]);
        const needs = markets.map(m => ({ ticker: m.ticker, start: Math.max(oldest, Math.floor((m.unsized ? m.open_time : m.through ?? m.open_time).getTime() / 1000)) }));
        let stored = 0, failed = 0;
        for (const request of planCandleRequests(needs, end, minutes)) {
            try {
                const page = await kalshi<{ markets: { market_ticker: string; candlesticks: Candle[] }[] }>('/markets/candlesticks', { market_tickers: request.tickers.join(','), start_ts: String(request.start), end_ts: String(request.end), period_interval: String(minutes) });
                if (!Array.isArray(page.markets))
                    throw new Error('Invalid candlesticks response');
                const wanted = new Set(request.tickers);
                const readings = page.markets.flatMap(m => wanted.has(m.market_ticker) && Array.isArray(m.candlesticks) ? candleReadings(m.market_ticker, minutes, m.candlesticks, request.end) : []);
                // The newest period is asked for again next time, in case it was published late.
                await storeCandles(readings, request.tickers, minutes, new Date((request.end - period) * 1000));
                stored += readings.length;
            } catch {
                // Progress is unchanged, so the next run asks for these markets again.
                failed++;
                console.warn('Candlestick request failed; will retry', request.tickers[0], request.tickers.length);
            }
        }
        if (keepDays !== null)
            await query('DELETE FROM odds_candles WHERE minutes=$1 AND ts<now()-make_interval(days => $2)', [minutes, keepDays]);
        console.log('Odds candlesticks stored', minutes, stored, failed ? `${failed} requests failed` : '');
    }
    // A market no longer listed, or no longer linkable, is not charted; drop what was kept for it.
    const listed = `SELECT 1 FROM markets m JOIN snapshot_series s USING(series_ticker) WHERE m.ticker=c.ticker AND m.close_time>now()-interval '1 day'`;
    await query(`DELETE FROM odds_candles c WHERE NOT EXISTS (${listed})`);
    await query(`DELETE FROM candle_progress c WHERE NOT EXISTS (${listed})`);
}
