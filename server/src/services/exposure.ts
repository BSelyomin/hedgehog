import type { ExposureResponse, ExposureEvent, Market, EventResponse, CalendarResponse } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { getHoldings, portfolioRevision } from './holdings.ts';
import { briefingDay } from './briefing-content.ts';
import { timed } from './request-timing.ts';
import { matchHolding, linkRank, rankDrivers } from './matching.ts';
import type { MeasuredRow } from './matching.ts';
import { ASSET_TAGS, assetLink, assetType, isSecurity } from './asset-links.ts';
import { trustScore } from '../config/trust.ts';
import { eventTime, isRangeLadder, marketKind, quotedSpread, statedDate } from './kalshi.ts';
import { numbersSupported, safeSources } from './ai-guard.ts';
import { trackRecord } from './track-record.ts';
import { categorize, fundClasses, linkThemes, noCategories } from './categories.ts';
import type { SecurityProfile } from '../jobs/profiles.ts';
interface MarketRow {
    ticker: string;
    event_ticker: string;
    event_title: string;
    event_description: string;
    strike_date: Date | null;
    series_ticker: string;
    category: string;
    mutually_exclusive: boolean;
    title: string;
    subtitle: string;
    close_time: Date;
    strike_type: string | null;
    occurrence_time: Date | null;
    expected_expiration_time: Date | null;
    floor_strike: number | null;
    ts: Date | null;
    yes_bid: number | null;
    yes_ask: number | null;
    mid: number | null;
    volume_24h: number | null;
    open_interest: number | null;
}
export async function exposure(session: string, portfolio?: Awaited<ReturnType<typeof getHoldings>>): Promise<ExposureResponse> {
    const { holdings } = portfolio ?? await getHoldings(session);
    const totalValue = holdings.reduce((s, h) => s + h.valueUsd, 0);
    if (!holdings.length) return { holdings, totalValue, categories: noCategories, events: [], byHolding: [], asOf: null };
    // Tickers, sector tags and measurements belong to listed securities only; a property that
    // happens to be named like a ticker must not pick them up. Other holdings link by asset type.
    const symbols = holdings.filter(isSecurity).map(h => h.symbol);
    const assetTags = [...new Set(holdings.flatMap(h => { const type = assetType(h); return type === 'security' ? [] : ASSET_TAGS[type]; }))];
    const linkedSeries = `SELECT t.series_ticker FROM series_tags t WHERE t.reviewed=true AND
        (t.tag=ANY($1::text[]) OR t.tag IN(SELECT tag FROM stock_tags WHERE symbol=ANY($1)) OR t.tag=ANY($2::text[]))`;
    const [markets, seriesTags, stockTags, measurements, record, profiles] = await Promise.all([
        // Materialize only linked rows before looking up quotes. Derive events from
        // those same rows so separate reads cannot disagree as markets close.
        query<MarketRow>(`WITH linked AS MATERIALIZED (
            SELECT m.*,e.title AS event_title,e.description AS event_description,e.category,e.mutually_exclusive,e.strike_date
            FROM markets m JOIN events e ON e.ticker=m.event_ticker
            WHERE m.series_ticker IN(${linkedSeries}) AND m.status='active' AND m.close_time>now())
            SELECT m.*,s.ts,s.yes_bid,s.yes_ask,s.mid,s.volume_24h,s.open_interest FROM linked m
            LEFT JOIN LATERAL(SELECT * FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)s ON true`, [symbols, assetTags]),
        query<{ series_ticker: string; tag: string }>(`SELECT series_ticker,tag FROM series_tags
            WHERE reviewed=true AND series_ticker IN(${linkedSeries})`, [symbols, assetTags]),
        query<{ symbol: string; tag: string }>('SELECT symbol,tag FROM stock_tags WHERE symbol=ANY($1)', [symbols]),
        query<MeasuredRow>('SELECT * FROM measured_links WHERE symbol=ANY($1)', [symbols]), trackRecord(),
        query<SecurityProfile>('SELECT * FROM security_profiles WHERE symbol=ANY($1::text[])', [symbols])
    ]);
    // A bond's payments are discounted at the latest Treasury yield nearest its remaining life.
    const yields = assetTags.length ? await query<{ symbol: string; close: number }>(`SELECT DISTINCT ON(symbol) symbol,close FROM prices WHERE symbol IN('DGS2','DGS10') ORDER BY symbol,ts DESC`) : [];
    const context = { now: Date.now(), shortYield: yields.find(y => y.symbol === 'DGS2')?.close ?? null, longYield: yields.find(y => y.symbol === 'DGS10')?.close ?? null };
    const result: ExposureEvent[] = [];
    const now = Date.now();
    const grouped = new Map<string, MarketRow[]>();
    for (const market of markets) {
        if (!Number.isFinite(new Date(market.close_time).getTime())) continue;
        const rows = grouped.get(market.event_ticker) ?? [];
        rows.push(market);
        grouped.set(market.event_ticker, rows);
    }
    for (const [ticker, rows] of grouped) {
        const first = rows[0];
        const e = { ticker, series_ticker: first.series_ticker, title: first.event_title,
            description: first.event_description ?? '', strike_date: first.strike_date,
            category: first.category, mutually_exclusive: first.mutually_exclusive };
        const tags = seriesTags.filter(t => t.series_ticker === e.series_ticker).map(t => t.tag);
        const links = holdings.flatMap(h => { const own = stockTags.filter(t => t.symbol === h.symbol).map(t => t.tag); const l = isSecurity(h) ? matchHolding(h, tags, own, measurements) : assetLink(h, tags, e.title, context); return l ? [{ ...l, themes: linkThemes(l, tags, own, measurements) }] : []; }).sort((a, b) => linkRank[a.type] - linkRank[b.type] || b.valueUsd - a.valueUsd);
        if (!links.length)
            continue;
        const category = record.categories.find(c => c.category === e.category);
        if (!rows.length)
            continue;
        // The event's date is its earliest upcoming market time; closeTime stays the earliest market close.
        const timing = rows.map(m => eventTime(now, m.close_time, m.occurrence_time, e.strike_date, m.expected_expiration_time, statedDate(e.description))).sort((a, b) => a.time.getTime() - b.time.getTime())[0];
        const ladder = isRangeLadder(e.mutually_exclusive, rows.map(m => m.strike_type));
        // An empty book has no midpoint, so it has no probability, spread or trust score.
        const outcomes: Market[] = rows.map(m => { const spread = quotedSpread(m.yes_bid, m.yes_ask); return { ticker: m.ticker, title: m.title, subtitle: m.subtitle, probability: spread === null ? null : m.mid, spread, asOf: iso(m.ts), kind: marketKind(m.strike_type, e.category, m.title, ladder), floorStrike: m.floor_strike ?? null, trust: trustScore(spread === null ? null : spread * 100, m.volume_24h, m.open_interest, category?.avgMiss ?? null, category?.count ?? 0) }; });
        const linkedValue = links.reduce((s, l) => s + l.valueUsd, 0);
        result.push({ seriesTicker: e.series_ticker, ticker: e.ticker, title: e.title, category: e.category, mutuallyExclusive: e.mutually_exclusive, closeTime: new Date(Math.min(...rows.map(m => new Date(m.close_time).getTime()))).toISOString(), eventTime: timing.time.toISOString(), eventTimeSource: timing.source, linkedValue, share: totalValue ? linkedValue / totalValue : 0, links, markets: outcomes, themes: [...new Set(links.flatMap(l => l.themes))] });
    }
    const timestamps = markets.flatMap(m => m.ts ? [new Date(m.ts).getTime()] : []).filter(Number.isFinite);
    const asOf = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
    const byHolding = holdings.map(h => ({ symbol: h.symbol, events: result.flatMap(e => { const l = e.links.find(l => l.symbol === h.symbol); return l ? [{ ticker: e.ticker, title: e.title, type: l.type }] : []; }).sort((a, b) => linkRank[a.type] - linkRank[b.type]), drivers: isSecurity(h) ? rankDrivers(h.symbol, measurements) : [] }));
    return { holdings, totalValue, byHolding, categories: categorize(holdings, result, profiles, measurements, await fundClasses()), events: result.sort((a, b) => b.share - a.share), asOf };
}
const EXPOSURE_CACHE_MS = 5 * 60_000, MAX_PORTFOLIOS = 32;
const snapshots = new Map<string, { promise: Promise<ExposureResponse>; until: number }>();

// Calendar windows and its "All future dates" exposure read share one private snapshot.
// Keep the underlying builder fresh for jobs and other services that need current data.
export async function cachedExposure(session: string, refresh = false): Promise<ExposureResponse> {
    const portfolio = await timed('holdings', () => getHoldings(session));
    const key = JSON.stringify([session, portfolioRevision(portfolio), briefingDay(new Date(Date.now()))]);
    const saved = snapshots.get(key);
    if (!refresh && saved && saved.until > Date.now()) {
        snapshots.delete(key); snapshots.set(key, saved);
        return structuredClone(await timed('exposure_cache_hit', () => saved.promise));
    }
    const entry: { promise: Promise<ExposureResponse>; until: number } = {
        until: Infinity,
        promise: timed('exposure_build', async () => {
            const data = await exposure(session, portfolio);
            entry.until = Date.now() + EXPOSURE_CACHE_MS;
            return data;
        })
    };
    snapshots.delete(key); snapshots.set(key, entry);
    if (snapshots.size > MAX_PORTFOLIOS) snapshots.delete(snapshots.keys().next().value!);
    // A failed or superseded producer cannot remove a newer refresh's snapshot.
    void entry.promise.catch(() => { if (snapshots.get(key) === entry) snapshots.delete(key); });
    return structuredClone(await entry.promise);
}

export async function calendar(session: string, days: number, refresh = false): Promise<CalendarResponse> {
    const data = await cachedExposure(session, refresh);
    const end = Date.now() + days * 86400000;
    return { days, asOf: data.asOf, categories: data.categories,
        events: data.events.filter(e => Date.parse(e.eventTime) <= end).sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime)) };
}
export async function eventDetail(session: string, ticker: string): Promise<EventResponse | null> {
    const data = await exposure(session);
    const event = data.events.find(e => e.ticker === ticker || e.markets.some(m => m.ticker === ticker));
    if (!event)
        return null;
    const saved = await query<{
        text: string;
        sources: {
            title: string;
            url: string;
        }[];
        input_data: unknown;
        updated_at: Date;
    }>('SELECT * FROM summaries WHERE event_ticker=$1', [event.ticker]);
    const s = saved[0];
    const sources = s ? safeSources(s.sources) : [];
    return { event, asOf: data.asOf, summary: s && sources.length && numbersSupported(s.text, s.input_data) ? { text: s.text, sources, generatedAt: iso(s.updated_at)! } : null };
}
