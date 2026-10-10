import { FORECAST_HORIZONS } from '../../../shared/types.ts';
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
export function oddsBeforeClose(candles: Candle[], closeTime: string, horizonHours = 24) {
    if (!FORECAST_HORIZONS.some(h => h.hours === horizonHours)) throw new Error('Unsupported forecast horizon');
    const target = Math.floor(Date.parse(closeTime) / 1000) - horizonHours * 3600;
    const candle = [...candles].filter(c => c.end_period_ts <= target && c.end_period_ts >= target - 60).sort((a, b) => b.end_period_ts - a.end_period_ts)[0];
    if (!candle)
        return null;
    const q = quote(candle.yes_bid.close_dollars, candle.yes_ask.close_dollars);
    return q ? { probability: q.mid, bid: q.bid, ask: q.ask, ts: candle.end_period_ts } : null;
}
// A quote taken after the underlying event happened is not a forecast, so it never enters the record.
export function outcomeAlreadyKnown(m: Pick<KalshiMarket, 'occurrence_datetime'>, quoteTs: number, releasedAt?: Date) {
    const occurred = releasedAt ? releasedAt.getTime() : m.occurrence_datetime ? Date.parse(m.occurrence_datetime) : NaN;
    return Number.isFinite(occurred) && occurred <= quoteTs * 1000;
}
async function recordSkip(m: KalshiMarket, s: { series_ticker: string; category: string }, reason: 'no_quote' | 'outcome_known', horizon: number) {
    await query(`INSERT INTO backfill_skips(ticker,series_ticker,category,reason,close_time,horizon_hours) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(ticker,horizon_hours) DO UPDATE SET reason=excluded.reason,close_time=excluded.close_time,recorded_at=now()`, [m.ticker,s.series_ticker,s.category,reason,m.close_time,horizon]);
}
export async function backfill(options: {series?: string[]; maxMarkets?: number} = {}) {
    const releases = await query<{event_ticker: string; released_at: Date}>('SELECT event_ticker,released_at FROM event_releases');
    const available = await query<{series_ticker: string; category: string}>(`SELECT DISTINCT e.series_ticker,e.category FROM events e JOIN series_tags t ON t.series_ticker=e.series_ticker WHERE t.reviewed=true`);
    const series = options.series?.length ? available.filter(s => options.series!.includes(s.series_ticker)) : available;
    let processed = 0;
    for (const s of series) for (const historical of [false,true]) {
        // Separate progress from the legacy one-horizon job, including incomplete older runs.
        const name = `backfill:horizons-v1:${historical ? 'archive:' : ''}${s.series_ticker}`;
        let cursor = (await query<{cursor: string}>('SELECT cursor FROM job_state WHERE name=$1',[name]))[0]?.cursor ?? '';
        const seen = new Set<string>();
        do {
            const page = await kalshi<{markets: KalshiMarket[]; cursor: string}>(historical ? '/historical/markets' : '/markets',
                {...(historical ? {} : {status:'settled'}),series_ticker:s.series_ticker,limit:'100',...(cursor ? {cursor} : {})});
            let failed = false;
            for (const m of page.markets) {
                if (m.result !== 'yes' && m.result !== 'no') continue;
                if (options.maxMarkets !== undefined && processed >= options.maxMarkets) return;
                processed++;
                const releasedAt = releases.find(r => r.event_ticker === m.event_ticker)?.released_at;
                for (const {hours} of FORECAST_HORIZONS) {
                    try {
                        const existing = hours === 24
                            ? await query<{odds_time: Date}>('SELECT odds_time FROM settled_markets WHERE ticker=$1',[m.ticker])
                            : await query<{odds_time: Date}>('SELECT odds_time FROM forecast_observations WHERE ticker=$1 AND horizon_hours=$2',[m.ticker,hours]);
                        if (existing.length) {
                            const invalid = outcomeAlreadyKnown(m,existing[0].odds_time.getTime()/1000,releasedAt);
                            if (invalid) {
                                if (hours === 24) await query('DELETE FROM settled_markets WHERE ticker=$1',[m.ticker]);
                                await query('DELETE FROM forecast_observations WHERE ticker=$1 AND horizon_hours=$2',[m.ticker,hours]);
                                await recordSkip(m,s,'outcome_known',hours);
                                continue;
                            }
                            if (hours === 24) await query('UPDATE settled_markets SET series_ticker=$2,event_ticker=$3,title=$4 WHERE ticker=$1',[m.ticker,s.series_ticker,m.event_ticker??null,m.title??null]);
                            continue;
                        }
                        const target = Math.floor(Date.parse(m.close_time)/1000)-hours*3600;
                        const params = {start_ts:String(target-60),end_ts:String(target),period_interval:'1'};
                        const odds = oddsBeforeClose(await loadCandles(s.series_ticker,m.ticker,params,historical),m.close_time,hours);
                        if (!odds) { await recordSkip(m,s,'no_quote',hours); continue; }
                        if (outcomeAlreadyKnown(m,odds.ts,releasedAt)) { await recordSkip(m,s,'outcome_known',hours); continue; }
                        const outcome = m.result === 'yes' ? 1 : 0;
                        await query(`INSERT INTO forecast_observations(ticker,horizon_hours,series_ticker,event_ticker,title,category,yes_bid,yes_ask,outcome,close_time,odds_time)
                            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(ticker,horizon_hours) DO NOTHING`,
                            [m.ticker,hours,s.series_ticker,m.event_ticker??null,m.title??null,s.category,odds.bid,odds.ask,outcome,m.close_time,new Date(odds.ts*1000)]);
                        if (hours === 24) await query(`INSERT INTO settled_markets(ticker,category,prob_24h_before,outcome,close_time,odds_time,series_ticker,event_ticker,title)
                            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[m.ticker,s.category,odds.probability,outcome,m.close_time,new Date(odds.ts*1000),s.series_ticker,m.event_ticker??null,m.title??null]);
                        await query('DELETE FROM backfill_skips WHERE ticker=$1 AND horizon_hours=$2',[m.ticker,hours]);
                    } catch {
                        failed = true;
                        console.warn('Backfill retry needed',m.ticker,hours);
                    }
                }
            }
            if (failed) break; // Keep the page for retries; every horizon is independently idempotent.
            const next = page.cursor ?? '';
            if (next && (next === cursor || seen.has(next))) throw new Error('Repeated cursor');
            seen.add(next); cursor = next;
            await query(`INSERT INTO job_state(name,cursor) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor,updated_at=now()`,[name,cursor]);
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
