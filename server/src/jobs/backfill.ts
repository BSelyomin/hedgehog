import { FORECAST_HORIZONS } from '../../../shared/types.ts';
import { query } from '../db.ts';
import { emptyBook, kalshi, quote } from '../services/kalshi.ts';
import type { Candle, HistoricalCandle, KalshiMarket } from '../services/kalshi.ts';

const DAY = 86400;
// The track record pairs each settled market's outcome with its odds 24 hours before close.
// Kalshi publishes a candlestick only for a period in which the quote changed (see SOURCES.md),
// so the quote standing at that mark is the close of the last candlestick before it. One older
// than this many days is not used.
export const LOOKBACK_DAYS = 7;
// Hourly candlesticks over that window, for as many markets as fit in one reply of 10,000.
const BATCH = Math.floor(10000 / (LOOKBACK_DAYS * 24 + 1));
// Archived markets are asked for one at a time, this many at once.
const PARALLEL = 4;
// A series of hourly markets settles tens of thousands of them. One statement naming them all
// ran past the database's time limit (KXINXU, 2026-10-10), so they are sent this many at a time.
export const DB_BATCH = 5000;
const batches = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / DB_BATCH) }, (_, i) => items.slice(i * DB_BATCH, (i + 1) * DB_BATCH));

export function normalizeHistoricalCandles(candles: HistoricalCandle[]): Candle[] {
    return candles.map(c => ({ end_period_ts: c.end_period_ts, yes_bid: { close_dollars: c.yes_bid?.close ?? null }, yes_ask: { close_dollars: c.yes_ask?.close ?? null } }));
}
export async function loadCandles(series: string, ticker: string, params: Record<string, string>, historical: boolean): Promise<Candle[]> {
    if (!historical) {
        try {
            const live = await kalshi<{ candlesticks: Candle[] }>(`/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks`, params);
            if (live.candlesticks.length) return live.candlesticks;
        } catch (error) {
            if (!(error instanceof Error) || !/^Kalshi HTTP 404(?:;|$)/.test(error.message)) throw error;
        }
    }
    try {
        const archive = await kalshi<{ candlesticks: HistoricalCandle[] }>(`/historical/markets/${encodeURIComponent(ticker)}/candlesticks`, params);
        return normalizeHistoricalCandles(archive.candlesticks);
    } catch (error) {
        // Empty live history plus no archive is missing data, not a retryable page failure.
        if (error instanceof Error && /^Kalshi HTTP 404(?:;|$)/.test(error.message)) return [];
        throw error;
    }
}

// The quote standing 24 hours before close: the last candlestick ending at or before that mark.
// If that one shows an empty book there was no quote at the mark, so an older one is not used.
export function oddsBeforeClose(candles: Candle[], closeTime: string) {
    const mark = Math.floor(Date.parse(closeTime) / 1000) - DAY;
    const candle = candles.filter(c => c.end_period_ts <= mark && c.end_period_ts >= mark - LOOKBACK_DAYS * DAY).sort((a, b) => b.end_period_ts - a.end_period_ts)[0];
    if (!candle)
        return null;
    const q = quote(candle.yes_bid?.close_dollars, candle.yes_ask?.close_dollars);
    return q && !emptyBook(q.bid, q.ask) ? { probability: q.mid, ts: candle.end_period_ts } : null;
}

// A market listed for under a day has no odds 24 hours before its close.
export function scoreable(market: Pick<KalshiMarket, 'open_time' | 'close_time' | 'result'>) {
    const open = Date.parse(market.open_time ?? ''), close = Date.parse(market.close_time);
    return (market.result === 'yes' || market.result === 'no') && Number.isFinite(open) && Number.isFinite(close) && close - open >= DAY * 1000;
}

// Live markets that close together are asked for together.
export function closeGroups<T extends { close_time: string }>(markets: T[]): T[][] {
    const groups = new Map<string, T[]>();
    for (const market of markets)
        groups.set(market.close_time, [...(groups.get(market.close_time) ?? []), market]);
    return [...groups.values()].flatMap(group => Array.from({ length: Math.ceil(group.length / BATCH) }, (_, i) => group.slice(i * BATCH, (i + 1) * BATCH)));
}

async function parallel<T>(items: T[], work: (item: T) => Promise<void>) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => { while (next < items.length) await work(items[next++]); }));
}

async function listSettled(series: string, archived: boolean): Promise<KalshiMarket[]> {
    const markets: KalshiMarket[] = [], seen = new Set<string>();
    for (let cursor = ''; ;) {
        const page = await kalshi<{ markets: KalshiMarket[]; cursor?: string }>(archived ? '/historical/markets' : '/markets', { ...(archived ? {} : { status: 'settled' }), series_ticker: series, limit: '1000', ...(cursor ? { cursor } : {}) });
        markets.push(...(page.markets ?? []));
        cursor = page.cursor ?? '';
        if (!cursor)
            return markets;
        if (seen.has(cursor))
            throw new Error('Repeated cursor');
        seen.add(cursor);
    }
}

// Scores one series' settled markets that closed after the last run. Returns what it did.
export async function backfillSeries(series: string, category: string) {
    const state = `settled:${series}`;
    const done = Date.parse((await query<{ cursor: string }>('SELECT cursor FROM job_state WHERE name=$1', [state]))[0]?.cursor ?? '') || 0;
    const live = await listSettled(series, false), liveTickers = new Set(live.map(m => m.ticker));
    const archived = (await listSettled(series, true)).filter(m => !liveTickers.has(m.ticker));
    const settled = [...live, ...archived].filter(m => m.ticker && (m.result === 'yes' || m.result === 'no') && Number.isFinite(Date.parse(m.close_time)));
    // Rows stored before the series was recorded get their identity here.
    for (const batch of batches(settled))
        await query(`UPDATE settled_markets s SET series_ticker=$1,event_ticker=COALESCE(s.event_ticker,r.event_ticker),title=COALESCE(s.title,r.title)
            FROM jsonb_to_recordset($2::jsonb) AS r(ticker text,event_ticker text,title text) WHERE s.ticker=r.ticker AND (s.series_ticker IS NULL OR s.event_ticker IS NULL OR s.title IS NULL)`,
        [series, JSON.stringify(batch.map(m => ({ ticker: m.ticker, event_ticker: m.event_ticker ?? null, title: m.title ?? null })))]);
    const recent = settled.filter(m => Date.parse(m.close_time) > done);
    const stored = new Set<string>();
    for (const batch of batches(recent))
        for (const row of await query<{ ticker: string }>('SELECT ticker FROM settled_markets WHERE ticker=ANY($1::text[])', [batch.map(m => m.ticker)]))
            stored.add(row.ticker);
    const wanted = recent.filter(m => !stored.has(m.ticker) && scoreable(m));
    const window = (m: KalshiMarket) => { const mark = Math.floor(Date.parse(m.close_time) / 1000) - DAY; return { start_ts: String(mark - LOOKBACK_DAYS * DAY), end_ts: String(mark), period_interval: '60' }; };
    const readings: Record<string, unknown>[] = [];
    const read = (m: KalshiMarket, candles: Candle[]) => {
        const odds = oddsBeforeClose(candles, m.close_time);
        if (odds)
            readings.push({ ticker: m.ticker, category, prob_24h_before: odds.probability, outcome: m.result === 'yes' ? 1 : 0, close_time: m.close_time, odds_time: new Date(odds.ts * 1000).toISOString(), series_ticker: series, event_ticker: m.event_ticker ?? null, title: m.title ?? null });
        return Boolean(odds);
    };
    const fromArchive = async (m: KalshiMarket) => {
        try {
            read(m, normalizeHistoricalCandles((await kalshi<{ candlesticks: HistoricalCandle[] }>(`/historical/markets/${encodeURIComponent(m.ticker)}/candlesticks`, window(m))).candlesticks ?? []));
        } catch (error) {
            // No archive for this market is missing data; anything else is an outage to retry.
            if (!(error instanceof Error) || !/^Kalshi HTTP 404(?:;|$)/.test(error.message)) throw error;
        }
    };
    const unanswered: KalshiMarket[] = [];
    for (const group of closeGroups(wanted.filter(m => liveTickers.has(m.ticker)))) {
        const page = await kalshi<{ markets: { market_ticker: string; candlesticks: Candle[] }[] }>('/markets/candlesticks', { market_tickers: group.map(m => m.ticker).join(','), ...window(group[0]) });
        for (const m of group)
            if (!read(m, page.markets?.find(row => row.market_ticker === m.ticker)?.candlesticks ?? []))
                unanswered.push(m);
    }
    // A live market the batch has nothing for may already have moved to the archive.
    await parallel([...unanswered, ...wanted.filter(m => !liveTickers.has(m.ticker))], fromArchive);
    for (const batch of readings.length ? batches(readings) : [readings])
        await query(`INSERT INTO settled_markets(ticker,category,prob_24h_before,outcome,close_time,odds_time,series_ticker,event_ticker,title)
            SELECT ticker,category,prob_24h_before,outcome,close_time,odds_time,series_ticker,event_ticker,title FROM jsonb_to_recordset($1::jsonb)
            AS r(ticker text,category text,prob_24h_before double precision,outcome integer,close_time timestamptz,odds_time timestamptz,series_ticker text,event_ticker text,title text) ON CONFLICT DO NOTHING`, [JSON.stringify(batch)]);
    // Everything up to the latest close has now been looked at once; a later run starts after it.
    const latest = Math.max(done, ...settled.map(m => Date.parse(m.close_time)));
    if (latest > 0)
        await query(`INSERT INTO job_state(name,cursor) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor,updated_at=now()`, [state, new Date(latest).toISOString()]);
    return { settled: settled.length, recent: recent.length, short: recent.filter(m => !stored.has(m.ticker) && !scoreable(m)).length, scored: readings.length, noQuote: wanted.length - readings.length };
}

// Covers every series that can link to a holding. A series that fails keeps its place and is
// retried on the next run; the rest carry on.
export async function backfill(options: { series?: string[] } = {}) {
    const universe = await query<{ series_ticker: string; category: string | null }>(`SELECT s.series_ticker,(SELECT e.category FROM events e WHERE e.series_ticker=s.series_ticker ORDER BY e.ticker LIMIT 1) category
        FROM snapshot_series s ORDER BY s.series_ticker`)
        .then(rows => rows.filter(r => !options.series?.length || options.series.includes(r.series_ticker)));
    const total = { series: 0, failed: 0, settled: 0, scored: 0, short: 0, noQuote: 0 };
    for (const { series_ticker, category } of universe) {
        if (!category)
            continue;
        try {
            const result = await backfillSeries(series_ticker, category);
            total.series++; total.settled += result.settled; total.scored += result.scored; total.short += result.short; total.noQuote += result.noQuote;
            if (result.recent)
                console.log('Settled markets scored', series_ticker, result.scored, 'of', result.recent, 'new;', result.short, 'listed under a day,', result.noQuote, 'without a quote');
        } catch {
            total.failed++;
            console.warn('Backfill retry needed', series_ticker);
        }
    }
    console.log('Backfill complete', JSON.stringify(total));
}

// A quote standing in the minute before the mark, for the 1, 24, 168 and 720 hour horizons.
export function oddsAtHorizon(candles: Candle[], closeTime: string, horizonHours = 24) {
    if (!FORECAST_HORIZONS.some(h => h.hours === horizonHours)) throw new Error('Unsupported forecast horizon');
    const target = Math.floor(Date.parse(closeTime) / 1000) - horizonHours * 3600;
    const candle = [...candles].filter(c => c.end_period_ts <= target && c.end_period_ts >= target - 60).sort((a, b) => b.end_period_ts - a.end_period_ts)[0];
    if (!candle)
        return null;
    const q = quote(candle.yes_bid?.close_dollars, candle.yes_ask?.close_dollars);
    return q && !emptyBook(q.bid, q.ask) ? { probability: q.mid, bid: q.bid, ask: q.ask, ts: candle.end_period_ts } : null;
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
// The per-horizon record (forecast_observations). Runs beside backfill, which scores the 24-hour mark of
// every series a holding could link to.
export async function backfillHorizons(options: {series?: string[]; maxMarkets?: number} = {}) {
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
                        // A market not yet listed at the mark has no quote there; Kalshi is not asked.
                        if (m.open_time && Date.parse(m.open_time) > target*1000) { await recordSkip(m,s,'no_quote',hours); continue; }
                        const params = {start_ts:String(target-60),end_ts:String(target),period_interval:'1'};
                        const odds = oddsAtHorizon(await loadCandles(s.series_ticker,m.ticker,params,historical),m.close_time,hours);
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

// The timeframes other than 24 hours: 1 hour, 7 days and 30 days before close.
export const OTHER_HORIZONS: number[] = FORECAST_HORIZONS.map(h => h.hours).filter(hours => hours !== 24);
// The quote standing `hours` before close, by the 24-hour rule: the close of the last hourly
// candlestick ending at or before that mark, no more than LOOKBACK_DAYS old. An empty book at the
// mark gives no reading; an older quote is not used in its place.
export function oddsStandingAt(candles: Candle[], closeTime: string, hours: number) {
    const mark = Math.floor(Date.parse(closeTime) / 1000) - hours * 3600;
    const candle = candles.filter(c => c.end_period_ts <= mark && c.end_period_ts >= mark - LOOKBACK_DAYS * DAY).sort((a, b) => b.end_period_ts - a.end_period_ts)[0];
    if (!candle)
        return null;
    const q = quote(candle.yes_bid?.close_dollars, candle.yes_ask?.close_dollars);
    return q && !emptyBook(q.bid, q.ask) ? { probability: q.mid, bid: q.bid, ask: q.ask, ts: candle.end_period_ts } : null;
}

// Fills the other timeframes for one series. Only markets already in the 24-hour record are read,
// so every timeframe scores the same questions. Each market gets a row or a skip for each
// timeframe, once: a later run asks Kalshi only about what is still unanswered. A market not yet
// listed at a mark, or with an empty book there, is skipped as having no quote.
export async function backfillSeriesTimeframes(series: string, releases: Map<string, Date> = new Map()) {
    const rows = await query<{ ticker: string; category: string; close_time: Date; outcome: number; event_ticker: string | null; title: string | null }>(
        'SELECT ticker,category,close_time,outcome,event_ticker,title FROM settled_markets WHERE series_ticker=$1', [series]);
    const answered = new Set((await query<{ ticker: string; horizon_hours: number }>(`SELECT ticker,horizon_hours FROM forecast_observations WHERE series_ticker=$1
        UNION SELECT ticker,horizon_hours FROM backfill_skips WHERE series_ticker=$1`, [series])).map(r => `${r.ticker}|${r.horizon_hours}`));
    const wanted = OTHER_HORIZONS.map(hours => ({ hours, markets: rows.filter(r => !answered.has(`${r.ticker}|${hours}`)).map(r => ({ ...r, close_time: new Date(r.close_time).toISOString() })) })).filter(w => w.markets.length);
    const total = { markets: rows.length, scored: 0, skipped: 0 };
    if (!wanted.length)
        return total;
    // Markets still in Kalshi's live listing are asked for together, and say when they were listed.
    const live = new Map((await listSettled(series, false)).map(m => [m.ticker, m]));
    for (const { hours, markets } of wanted) {
        const mark = (closeTime: string) => Math.floor(Date.parse(closeTime) / 1000) - hours * 3600;
        const window = (closeTime: string) => ({ start_ts: String(mark(closeTime) - LOOKBACK_DAYS * DAY), end_ts: String(mark(closeTime)), period_interval: '60' });
        const readings: Record<string, unknown>[] = [], skips: Record<string, unknown>[] = [];
        type Row = typeof markets[number];
        const skip = (m: Row, reason: 'no_quote' | 'outcome_known') => { skips.push({ ticker: m.ticker, series_ticker: series, category: m.category, reason, close_time: m.close_time, horizon_hours: hours }); };
        const read = (m: Row, candles: Candle[]) => {
            const odds = oddsStandingAt(candles, m.close_time, hours);
            if (!odds)
                return false;
            // A quote published at or after the result was known is not a forecast.
            if (outcomeAlreadyKnown({ occurrence_datetime: live.get(m.ticker)?.occurrence_datetime }, odds.ts, m.event_ticker ? releases.get(m.event_ticker) : undefined))
                skip(m, 'outcome_known');
            else
                readings.push({ ticker: m.ticker, horizon_hours: hours, series_ticker: series, event_ticker: m.event_ticker, title: m.title, category: m.category, yes_bid: odds.bid, yes_ask: odds.ask, outcome: m.outcome, close_time: m.close_time, odds_time: new Date(odds.ts * 1000).toISOString() });
            return true;
        };
        // Not yet listed at the mark: there was no quote, and Kalshi is not asked.
        const listed = markets.filter(m => { const open = Date.parse(live.get(m.ticker)?.open_time ?? ''); if (Number.isFinite(open) && open > mark(m.close_time) * 1000) { skip(m, 'no_quote'); return false; } return true; });
        const fromArchive = async (m: Row) => {
            try {
                if (!read(m, normalizeHistoricalCandles((await kalshi<{ candlesticks: HistoricalCandle[] }>(`/historical/markets/${encodeURIComponent(m.ticker)}/candlesticks`, window(m.close_time))).candlesticks ?? [])))
                    skip(m, 'no_quote');
            } catch (error) {
                // No archive for this market is missing data; anything else is an outage to retry.
                if (!(error instanceof Error) || !/^Kalshi HTTP 404(?:;|$)/.test(error.message)) throw error;
                skip(m, 'no_quote');
            }
        };
        const unanswered: Row[] = [];
        for (const group of closeGroups(listed.filter(m => live.has(m.ticker)))) {
            const page = await kalshi<{ markets: { market_ticker: string; candlesticks: Candle[] }[] }>('/markets/candlesticks', { market_tickers: group.map(m => m.ticker).join(','), ...window(group[0].close_time) });
            for (const m of group)
                if (!read(m, page.markets?.find(row => row.market_ticker === m.ticker)?.candlesticks ?? []))
                    unanswered.push(m);
        }
        // A live market the batch has nothing for may already have moved to the archive.
        await parallel([...unanswered, ...listed.filter(m => !live.has(m.ticker))], fromArchive);
        for (const batch of batches(readings))
            await query(`INSERT INTO forecast_observations(ticker,horizon_hours,series_ticker,event_ticker,title,category,yes_bid,yes_ask,outcome,close_time,odds_time)
                SELECT ticker,horizon_hours,series_ticker,event_ticker,title,category,yes_bid,yes_ask,outcome,close_time,odds_time FROM jsonb_to_recordset($1::jsonb)
                AS r(ticker text,horizon_hours integer,series_ticker text,event_ticker text,title text,category text,yes_bid double precision,yes_ask double precision,outcome integer,close_time timestamptz,odds_time timestamptz)
                ON CONFLICT(ticker,horizon_hours) DO NOTHING`, [JSON.stringify(batch)]);
        for (const batch of batches(skips))
            await query(`INSERT INTO backfill_skips(ticker,series_ticker,category,reason,close_time,horizon_hours)
                SELECT ticker,series_ticker,category,reason,close_time,horizon_hours FROM jsonb_to_recordset($1::jsonb)
                AS r(ticker text,series_ticker text,category text,reason text,close_time timestamptz,horizon_hours integer)
                ON CONFLICT(ticker,horizon_hours) DO NOTHING`, [JSON.stringify(batch)]);
        total.scored += readings.length; total.skipped += skips.length;
    }
    return total;
}

// Every series in the 24-hour record, smallest first so that most records fill early. A series
// that fails keeps what it has stored and is finished on the next run; the rest carry on.
export async function backfillTimeframes(options: { series?: string[] } = {}) {
    const releases = new Map((await query<{ event_ticker: string; released_at: Date }>('SELECT event_ticker,released_at FROM event_releases')).map(r => [r.event_ticker, r.released_at]));
    const universe = (await query<{ series_ticker: string }>('SELECT series_ticker FROM settled_markets WHERE series_ticker IS NOT NULL GROUP BY series_ticker ORDER BY count(*),series_ticker'))
        .filter(r => !options.series?.length || options.series.includes(r.series_ticker));
    const total = { series: 0, failed: 0, scored: 0, skipped: 0 };
    for (const { series_ticker } of universe) {
        try {
            const result = await backfillSeriesTimeframes(series_ticker, releases);
            total.series++; total.scored += result.scored; total.skipped += result.skipped;
            if (result.scored || result.skipped)
                console.log('Timeframes read', series_ticker, result.scored, 'scored,', result.skipped, 'without a usable quote, of', result.markets, 'markets');
        } catch {
            total.failed++;
            console.warn('Backfill retry needed', series_ticker);
        }
    }
    console.log('Timeframes complete', JSON.stringify(total));
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
