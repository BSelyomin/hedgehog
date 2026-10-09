import type { ExposureResponse, ExposureEvent, Market, EventResponse, CalendarResponse } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { getHoldings } from './holdings.ts';
import { matchHolding, linkRank } from './matching.ts';
import type { MeasuredRow } from './matching.ts';
import { trustScore } from '../config/trust.ts';
import { numbersSupported, safeSources } from './ai-guard.ts';
import { trackRecord } from './track-record.ts';
interface EventRow {
    ticker: string;
    series_ticker: string;
    title: string;
    category: string;
    mutually_exclusive: boolean;
}
interface MarketRow {
    ticker: string;
    event_ticker: string;
    title: string;
    subtitle: string;
    close_time: Date;
    strike_type: string | null;
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
    const [events, markets, seriesTags, stockTags, measurements, record] = await Promise.all([
        query<EventRow>(`SELECT e.* FROM events e WHERE EXISTS(SELECT 1 FROM markets m WHERE m.event_ticker=e.ticker AND m.status='active' AND m.close_time>now())`),
        query<MarketRow>(`SELECT m.*,s.ts,s.yes_bid,s.yes_ask,s.mid,s.volume_24h,s.open_interest FROM markets m LEFT JOIN LATERAL(SELECT * FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)s ON true WHERE m.status='active' AND m.close_time>now()`),
        query<{
            series_ticker: string;
            tag: string;
        }>('SELECT series_ticker,tag FROM series_tags WHERE reviewed=true'),
        query<{
            symbol: string;
            tag: string;
        }>('SELECT symbol,tag FROM stock_tags WHERE symbol=ANY($1)', [holdings.map(h => h.symbol)]),
        query<MeasuredRow>('SELECT * FROM measured_links WHERE symbol=ANY($1)', [holdings.map(h => h.symbol)]), trackRecord()
    ]);
    const result: ExposureEvent[] = [];
    for (const e of events) {
        const tags = seriesTags.filter(t => t.series_ticker === e.series_ticker).map(t => t.tag);
        const links = holdings.flatMap(h => { const l = matchHolding(h, tags, stockTags.filter(t => t.symbol === h.symbol).map(t => t.tag), measurements); return l ? [l] : []; }).sort((a, b) => linkRank[a.type] - linkRank[b.type] || b.valueUsd - a.valueUsd);
        if (!links.length)
            continue;
        const category = record.categories.find(c => c.category === e.category);
        const rows = markets.filter(m => m.event_ticker === e.ticker);
        const outcomes: Market[] = rows.map(m => ({ ticker: m.ticker, title: m.title, subtitle: m.subtitle, probability: m.mid, spread: m.yes_ask === null || m.yes_bid === null ? null : m.yes_ask - m.yes_bid, asOf: iso(m.ts), kind: m.strike_type === 'between' ? 'bracket' : /mention/i.test(m.title) ? 'mention' : 'kpi', trust: trustScore(m.yes_ask === null || m.yes_bid === null ? null : (m.yes_ask - m.yes_bid) * 100, m.volume_24h, m.open_interest, category?.avgMiss ?? null, category?.count ?? 0) }));
        const linkedValue = links.reduce((s, l) => s + l.valueUsd, 0);
        result.push({ ticker: e.ticker, title: e.title, category: e.category, mutuallyExclusive: e.mutually_exclusive, closeTime: new Date(Math.min(...rows.map(m => m.close_time.getTime()))).toISOString(), linkedValue, share: totalValue ? linkedValue / totalValue : 0, links, markets: outcomes });
    }
    const latest = await query<{
        ts: Date | null;
    }>('SELECT max(ts) AS ts FROM odds_snapshots');
    const byHolding = holdings.map(h => ({ symbol: h.symbol, events: result.flatMap(e => { const l = e.links.find(l => l.symbol === h.symbol); return l ? [{ ticker: e.ticker, title: e.title, type: l.type }] : []; }).sort((a, b) => linkRank[a.type] - linkRank[b.type]) }));
    return { holdings, totalValue, byHolding, events: result.sort((a, b) => b.share - a.share), asOf: iso(latest[0]?.ts) };
}
export async function calendar(session: string, days: number): Promise<CalendarResponse> { const data = await exposure(session); const end = Date.now() + days * 86400000; return { days, asOf: data.asOf, events: data.events.filter(e => Date.parse(e.closeTime) <= end).sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime)) }; }
export async function eventDetail(session: string, ticker: string): Promise<EventResponse | null> {
    const data = await exposure(session);
    const event = data.events.find(e => e.ticker === ticker || e.markets.some(m => m.ticker === ticker));
    if (!event)
        return null;
    const rows = await query<{
        ts: Date;
        ticker: string;
        mid: number;
    }>(`SELECT ts,ticker,mid FROM odds_snapshots WHERE ticker=ANY($1) AND ts>=now()-interval '7 days' ORDER BY ts`, [event.markets.map(m => m.ticker)]);
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
    return { event, asOf: data.asOf, history: rows.map(r => ({ ts: r.ts.toISOString(), ticker: r.ticker, probability: r.mid })), summary: s && sources.length && numbersSupported(s.text, s.input_data) ? { text: s.text, sources } : null };
}
