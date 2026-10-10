import type { ExposureResponse, ExposureEvent, Market, EventResponse, CalendarResponse } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { getHoldings } from './holdings.ts';
import { matchHolding, linkRank, rankDrivers } from './matching.ts';
import type { MeasuredRow } from './matching.ts';
import { ASSET_TAGS, assetLink, assetType, isSecurity } from './asset-links.ts';
import { trustScore } from '../config/trust.ts';
import { eventTime, isRangeLadder, marketKind, statedDate } from './kalshi.ts';
import { numbersSupported, safeSources } from './ai-guard.ts';
import { trackRecord } from './track-record.ts';
interface EventRow {
    ticker: string;
    series_ticker: string;
    title: string;
    description: string;
    category: string;
    mutually_exclusive: boolean;
    strike_date: Date | null;
}
interface MarketRow {
    ticker: string;
    event_ticker: string;
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
export async function exposure(session: string): Promise<ExposureResponse> {
    const { holdings } = await getHoldings(session);
    const totalValue = holdings.reduce((s, h) => s + h.valueUsd, 0);
    if (!holdings.length) return { holdings, totalValue, events: [], byHolding: [], asOf: null };
    // Tickers, sector tags and measurements belong to listed securities only; a property that
    // happens to be named like a ticker must not pick them up. Other holdings link by asset type.
    const symbols = holdings.filter(isSecurity).map(h => h.symbol);
    const assetTags = [...new Set(holdings.flatMap(h => { const type = assetType(h); return type === 'security' ? [] : ASSET_TAGS[type]; }))];
    const linkedSeries = `SELECT t.series_ticker FROM series_tags t WHERE t.reviewed=true AND
        (t.tag=ANY($1) OR t.tag IN(SELECT tag FROM stock_tags WHERE symbol=ANY($1)) OR t.tag=ANY($2))`;
    const [events, markets, seriesTags, stockTags, measurements, record] = await Promise.all([
        query<EventRow>(`SELECT e.* FROM events e WHERE e.series_ticker IN(${linkedSeries}) AND EXISTS(SELECT 1 FROM markets m WHERE m.event_ticker=e.ticker AND m.status='active' AND m.close_time>now())`, [symbols, assetTags]),
        // Pick the linked markets first, then look up each one's latest snapshot. Left to itself the
        // planner looked up a snapshot for every market in the table before filtering.
        query<MarketRow>(`WITH linked AS MATERIALIZED (SELECT m.* FROM markets m WHERE m.series_ticker IN(${linkedSeries}) AND m.status='active' AND m.close_time>now())
            SELECT m.*,s.ts,s.yes_bid,s.yes_ask,s.mid,s.volume_24h,s.open_interest FROM linked m LEFT JOIN LATERAL(SELECT * FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)s ON true`, [symbols, assetTags]),
        query<{
            series_ticker: string;
            tag: string;
        }>(`SELECT series_ticker,tag FROM series_tags WHERE reviewed=true AND series_ticker IN(${linkedSeries})`, [symbols, assetTags]),
        query<{
            symbol: string;
            tag: string;
        }>('SELECT symbol,tag FROM stock_tags WHERE symbol=ANY($1)', [symbols]),
        query<MeasuredRow>('SELECT * FROM measured_links WHERE symbol=ANY($1)', [symbols]), trackRecord()
    ]);
    // A bond's payments are discounted at the latest Treasury yield nearest its remaining life.
    const yields = assetTags.length ? await query<{ symbol: string; close: number }>(`SELECT DISTINCT ON(symbol) symbol,close FROM prices WHERE symbol IN('DGS2','DGS10') ORDER BY symbol,ts DESC`) : [];
    const context = { now: Date.now(), shortYield: yields.find(y => y.symbol === 'DGS2')?.close ?? null, longYield: yields.find(y => y.symbol === 'DGS10')?.close ?? null };
    const result: ExposureEvent[] = [];
    const now = Date.now();
    for (const e of events) {
        const tags = seriesTags.filter(t => t.series_ticker === e.series_ticker).map(t => t.tag);
        const links = holdings.flatMap(h => { const l = isSecurity(h) ? matchHolding(h, tags, stockTags.filter(t => t.symbol === h.symbol).map(t => t.tag), measurements) : assetLink(h, tags, e.title, context); return l ? [l] : []; }).sort((a, b) => linkRank[a.type] - linkRank[b.type] || b.valueUsd - a.valueUsd);
        if (!links.length)
            continue;
        const category = record.categories.find(c => c.category === e.category);
        const rows = markets.filter(m => m.event_ticker === e.ticker);
        if (!rows.length)
            continue;
        // The event's date is its earliest upcoming market time; closeTime stays the earliest market close.
        const timing = rows.map(m => eventTime(now, m.close_time, m.occurrence_time, e.strike_date, m.expected_expiration_time, statedDate(e.description))).sort((a, b) => a.time.getTime() - b.time.getTime())[0];
        const ladder = isRangeLadder(e.mutually_exclusive, rows.map(m => m.strike_type));
        const outcomes: Market[] = rows.map(m => ({ ticker: m.ticker, title: m.title, subtitle: m.subtitle, probability: m.mid, spread: m.yes_ask === null || m.yes_bid === null ? null : m.yes_ask - m.yes_bid, asOf: iso(m.ts), kind: marketKind(m.strike_type, e.category, m.title, ladder), floorStrike: m.floor_strike ?? null, trust: trustScore(m.yes_ask === null || m.yes_bid === null ? null : (m.yes_ask - m.yes_bid) * 100, m.volume_24h, m.open_interest, category?.avgMiss ?? null, category?.count ?? 0) }));
        const linkedValue = links.reduce((s, l) => s + l.valueUsd, 0);
        result.push({ seriesTicker: e.series_ticker, ticker: e.ticker, title: e.title, category: e.category, mutuallyExclusive: e.mutually_exclusive, closeTime: new Date(Math.min(...rows.map(m => m.close_time.getTime()))).toISOString(), eventTime: timing.time.toISOString(), eventTimeSource: timing.source, linkedValue, share: totalValue ? linkedValue / totalValue : 0, links, markets: outcomes });
    }
    const latest = await query<{
        ts: Date | null;
    }>('SELECT max(ts) AS ts FROM odds_snapshots');
    const byHolding = holdings.map(h => ({ symbol: h.symbol, events: result.flatMap(e => { const l = e.links.find(l => l.symbol === h.symbol); return l ? [{ ticker: e.ticker, title: e.title, type: l.type }] : []; }).sort((a, b) => linkRank[a.type] - linkRank[b.type]), drivers: isSecurity(h) ? rankDrivers(h.symbol, measurements) : [] }));
    return { holdings, totalValue, byHolding, events: result.sort((a, b) => b.share - a.share), asOf: iso(latest[0]?.ts) };
}
export async function calendar(session: string, days: number): Promise<CalendarResponse> { const data = await exposure(session); const end = Date.now() + days * 86400000; return { days, asOf: data.asOf, events: data.events.filter(e => Date.parse(e.eventTime) <= end).sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime)) }; }
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
    }>('SELECT * FROM summaries WHERE event_ticker=$1 AND updated_at>now()-interval \'24 hours\'', [event.ticker]);
    const s = saved[0];
    const sources = s ? safeSources(s.sources) : [];
    return { event, asOf: data.asOf, summary: s && sources.length && numbersSupported(s.text, s.input_data) ? { text: s.text, sources } : null };
}
