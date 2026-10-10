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
// A quote taken after the underlying event happened is not a forecast, so it never enters the record.
export function outcomeAlreadyKnown(m: Pick<KalshiMarket, 'occurrence_datetime'>, quoteTs: number) {
    const occurred = m.occurrence_datetime ? Date.parse(m.occurrence_datetime) : NaN;
    return Number.isFinite(occurred) && occurred <= quoteTs * 1000;
}
async function recordSkip(m: KalshiMarket, s: { series_ticker: string; category: string }, reason: 'no_quote' | 'outcome_known') {
    await query(`INSERT INTO backfill_skips(ticker,series_ticker,category,reason,close_time) VALUES($1,$2,$3,$4,$5) ON CONFLICT(ticker) DO UPDATE SET reason=excluded.reason,recorded_at=now()`, [m.ticker, s.series_ticker, s.category, reason, m.close_time]);
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
                const stored = await query<{ odds_time: Date }>('SELECT odds_time FROM settled_markets WHERE ticker=$1', [m.ticker]);
                if (stored.length) {
                    // Re-check earlier rows: a stored quote that turns out to postdate the event is removed and counted as a skip.
                    if (outcomeAlreadyKnown(m, stored[0].odds_time.getTime() / 1000)) {
                        await query('DELETE FROM settled_markets WHERE ticker=$1', [m.ticker]);
                        await recordSkip(m, s, 'outcome_known');
                        continue;
                    }
                    await query('UPDATE settled_markets SET series_ticker=$2,event_ticker=$3,title=$4 WHERE ticker=$1', [m.ticker,s.series_ticker,m.event_ticker??null,m.title??null]);
                    continue;
                }
                try {
                    const target = Math.floor(Date.parse(m.close_time) / 1000) - 86400;
                    const params = { start_ts: String(target - 60), end_ts: String(target), period_interval: '1' };
                    const odds = oddsBeforeClose(await loadCandles(s.series_ticker, m.ticker, params, historical), m.close_time);
                    if (!odds) {
                        console.warn('No exact 24-hour bid/ask history', m.ticker);
                        await recordSkip(m, s, 'no_quote');
                        continue;
                    }
                    if (outcomeAlreadyKnown(m, odds.ts)) {
                        console.warn('Outcome known before the 24-hour quote', m.ticker);
                        await recordSkip(m, s, 'outcome_known');
                        continue;
                    }
                    await query(`INSERT INTO settled_markets(ticker,category,prob_24h_before,outcome,close_time,odds_time,series_ticker,event_ticker,title) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, [m.ticker, s.category, odds.probability, m.result === 'yes' ? 1 : 0, m.close_time, new Date(odds.ts * 1000),s.series_ticker,m.event_ticker??null,m.title??null]);
                    await query('DELETE FROM backfill_skips WHERE ticker=$1', [m.ticker]);
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

// Recover identity for existing observations without changing their quotes or outcomes.
export async function historyMetadata() {
    const rows=await query<{ticker:string}>('SELECT ticker FROM settled_markets WHERE series_ticker IS NULL OR event_ticker IS NULL OR title IS NULL');
    const events=new Map<string,string|null>();
    for(let i=0;i<rows.length;i+=100) {
        const batch=rows.slice(i,i+100),wanted=new Set(batch.map(r=>r.ticker));
        for(const path of ['/markets','/historical/markets']) {
            const page=await kalshi<{markets:KalshiMarket[]}>(path,{tickers:batch.map(r=>r.ticker).join(','),limit:'100'});
            for(const m of page.markets) {
                if(!wanted.has(m.ticker)||!m.event_ticker) continue;
                if(!events.has(m.event_ticker)) {
                    try {const d=await kalshi<{event:{series_ticker:string}}>('/events/'+encodeURIComponent(m.event_ticker));events.set(m.event_ticker,d.event.series_ticker||null);}
                    catch {events.set(m.event_ticker,null);}
                }
                await query('UPDATE settled_markets SET series_ticker=COALESCE(series_ticker,$2),event_ticker=COALESCE(event_ticker,$3),title=COALESCE(title,$4) WHERE ticker=$1',[m.ticker,events.get(m.event_ticker),m.event_ticker,m.title??null]);
            }
        }
    }
    console.log('Historical identity refresh complete');
}
