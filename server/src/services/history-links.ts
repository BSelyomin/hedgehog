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
        holdings.some(h => !isSecurity(h)) ? query<{symbol: string; close: number}>("SELECT DISTINCT ON(symbol) symbol,close FROM prices WHERE symbol IN('DGS2','DGS10') ORDER BY symbol,ts DESC") : Promise.resolve([]),
    ]);
    const context = { now: Date.now(), shortYield: yields.find(y => y.symbol === 'DGS2')?.close ?? null, longYield: yields.find(y => y.symbol === 'DGS10')?.close ?? null };
    for (const series of new Set(tags.map(t => t.series_ticker))) {
        const ownTags = tags.filter(t => t.series_ticker === series).map(t => t.tag);
        const links = holdings.flatMap(h => {
            let link: HoldingLink | null;
            if (isSecurity(h)) link = matchHolding(h, ownTags, stockTags.filter(t => t.symbol === h.symbol).map(t => t.tag), measurements);
            else link = events.filter(e => e.series_ticker === series).map(e => assetLink(h, ownTags, e.title, context)).find(l => l !== null) ?? null;
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
