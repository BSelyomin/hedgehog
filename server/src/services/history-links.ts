import type { HoldingLink, HistorySubject } from '../../../shared/types.ts';
import { query } from '../db.ts';
import { getHoldings } from './holdings.ts';
import { matchHolding, linkRank } from './matching.ts';
import type { MeasuredRow } from './matching.ts';
import { assetLink, isSecurity } from './asset-links.ts';

type Link = NonNullable<HistorySubject['linkedHoldings']>[number];
// These are today's reviewed relationships, not historically owned positions or causal claims.
export async function historyLinks(session: string, tags: {series_ticker: string; tag: string}[]): Promise<Map<string, Link[]>> {
    const { holdings } = await getHoldings(session);
    const result = new Map<string, Link[]>();
    if (!holdings.length) return result;
    const symbols = holdings.filter(isSecurity).map(h => h.symbol);
    const [stockTags, measurements, events, yields] = await Promise.all([
        query<{symbol: string; tag: string}>('SELECT symbol,tag FROM stock_tags WHERE symbol=ANY($1)', [symbols]),
        query<MeasuredRow>('SELECT * FROM measured_links WHERE symbol=ANY($1)', [symbols]),
        query<{series_ticker: string; title: string}>('SELECT DISTINCT series_ticker,title FROM events WHERE series_ticker=ANY($1)', [[...new Set(tags.map(t => t.series_ticker))]]),
        // Bounded below: prices are stored in weekly chunks over ten years, and an open-ended read opens them all.
        holdings.some(h => !isSecurity(h)) ? query<{symbol: string; close: number}>("SELECT DISTINCT ON(symbol) symbol,close FROM prices WHERE symbol IN('DGS2','DGS10') AND ts>now()-interval '30 days' ORDER BY symbol,ts DESC") : Promise.resolve([]),
    ]);
    const context = { now: Date.now(), shortYield: yields.find(y => y.symbol === 'DGS2')?.close ?? null, longYield: yields.find(y => y.symbol === 'DGS10')?.close ?? null };
    // Grouped once. Thousands of series are reviewed, and searching the full lists again for each
    // one took four seconds of a five-second page load.
    const grouped = <T, V>(rows: T[], key: (row: T) => string, value: (row: T) => V) => {
        const groups = new Map<string, V[]>();
        for (const row of rows) { const list = groups.get(key(row)); if (list) list.push(value(row)); else groups.set(key(row), [value(row)]); }
        return groups;
    };
    const seriesTags = grouped(tags, t => t.series_ticker, t => t.tag), holdingTags = grouped(stockTags, t => t.symbol, t => t.tag), titles = grouped(events, e => e.series_ticker, e => e.title);
    for (const [series, ownTags] of seriesTags) {
        const links = holdings.flatMap(h => {
            let link: HoldingLink | null;
            if (isSecurity(h)) link = matchHolding(h, ownTags, holdingTags.get(h.symbol) ?? [], measurements);
            else link = (titles.get(series) ?? []).map(title => assetLink(h, ownTags, title, context)).find(l => l !== null) ?? null;
            return link ? [{symbol: link.symbol, type: link.type, evidence: link.evidence}] : [];
        });
        if (links.length) result.set(series, links);
    }
    return result;
}
export function themeLinks(series: string[], links: Map<string, Link[]>): Link[] {
    const holdings = new Map<string, Link>();
    for (const ticker of series) for (const link of links.get(ticker) ?? []) {
        const held = holdings.get(link.symbol);
        if (!held || linkRank[link.type] < linkRank[held.type]) holdings.set(link.symbol, link);
    }
    return [...holdings.values()].sort((a,b) => linkRank[a.type] - linkRank[b.type] || a.symbol.localeCompare(b.symbol));
}
