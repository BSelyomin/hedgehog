import { query } from '../db.ts';
import { kalshi, quote } from '../services/kalshi.ts';
import type { Candle, HistoricalCandle, KalshiMarket } from '../services/kalshi.ts';
export function normalizeHistoricalCandles(candles: HistoricalCandle[]): Candle[] {
    return candles.map(c => ({ end_period_ts: c.end_period_ts, yes_bid: { close_dollars: c.yes_bid?.close ?? null }, yes_ask: { close_dollars: c.yes_ask?.close ?? null } }));
}
export async function loadCandles(series: string, ticker: string, params: Record<string, string>, historical: boolean): Promise<Candle[]> {
    if (!historical) {
        try {
            const live = await kalshi<{ candlesticks: Candle[] }>(`/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks`, params);
            if (live.candlesticks.length) return live.candlesticks;
        } catch (error) {
            if (!(error instanceof Error) || error.message !== 'Kalshi HTTP 404') throw error;
        }
    }
    try {
        const archive = await kalshi<{ candlesticks: HistoricalCandle[] }>(`/historical/markets/${encodeURIComponent(ticker)}/candlesticks`, params);
        return normalizeHistoricalCandles(archive.candlesticks);
    } catch (error) {
        // Empty live history plus no archive is missing data, not a retryable page failure.
        if (error instanceof Error && error.message === 'Kalshi HTTP 404') return [];
        throw error;
    }
}
export function oddsBeforeClose(candles: Candle[], closeTime: string) {
    const target = Math.floor(Date.parse(closeTime) / 1000) - 86400;
    const candle = [...candles].filter(c => c.end_period_ts <= target && c.end_period_ts >= target - 60).sort((a, b) => b.end_period_ts - a.end_period_ts)[0];
    if (!candle)
        return null;
    const q = quote(candle.yes_bid.close_dollars, candle.yes_ask.close_dollars);
    return q ? { probability: q.mid, ts: candle.end_period_ts } : null;
}
export async function backfill() {
    const series = await query<{
        series_ticker: string;
        category: string;
    }>(`SELECT DISTINCT e.series_ticker,e.category FROM events e JOIN series_tags t ON t.series_ticker=e.series_ticker WHERE t.reviewed=true`);
    for (const s of series) for (const historical of [false, true]) {
        const name = `backfill:${historical ? 'archive:' : ''}${s.series_ticker}`;
        let cursor = (await query<{
            cursor: string;
        }>('SELECT cursor FROM job_state WHERE name=$1', [name]))[0]?.cursor ?? '';
        do {
            const page = await kalshi<{
                markets: KalshiMarket[];
                cursor: string;
            }>(historical ? '/historical/markets' : '/markets', { ...(historical ? {} : { status: 'settled' }), series_ticker: s.series_ticker, limit: '100', ...(cursor ? { cursor } : {}) });
            let failed = false;
            for (const m of page.markets) {
                if (m.result !== 'yes' && m.result !== 'no')
                    continue;
                if ((await query('SELECT ticker FROM settled_markets WHERE ticker=$1', [m.ticker])).length)
                    continue;
                try {
                    const target = Math.floor(Date.parse(m.close_time) / 1000) - 86400;
                    const params = { start_ts: String(target - 60), end_ts: String(target), period_interval: '1' };
                    const odds = oddsBeforeClose(await loadCandles(s.series_ticker, m.ticker, params, historical), m.close_time);
                    if (!odds) {
                        console.warn('No exact 24-hour bid/ask history', m.ticker);
                        continue;
                    }
                    await query(`INSERT INTO settled_markets(ticker,category,prob_24h_before,outcome,close_time,odds_time) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [m.ticker, s.category, odds.probability, m.result === 'yes' ? 1 : 0, m.close_time, new Date(odds.ts * 1000)]);
                }
                catch {
                    failed = true;
                    console.warn('Backfill retry needed', m.ticker);
                }
            }
            if (failed)
                break; // Retain this page for retries; inserts are idempotent.
            const next = page.cursor ?? '';
            if (next && next === cursor)
                throw new Error('Repeated cursor');
            cursor = next;
            await query(`INSERT INTO job_state(name,cursor) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor,updated_at=now()`, [name, cursor]);
        } while (cursor);
    }
}
