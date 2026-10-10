import type { Holding, HoldingLink, OddsMove } from '../../../shared/types.ts';
import { query } from '../db.ts';
import { matchHolding, linkRank, type MeasuredRow } from './matching.ts';

export interface MovePrice {
    symbol: string;
    ts: Date | null;
    close: number | null;
    loaded_at: Date | null;
    price_date: string;
    has_latest: boolean;
}

// Resolve the default session and read its two closes in one database round trip.
// LEFT JOIN preserves the selected date even when a symbol has no prices yet.
export function movePrices(symbols: string[], requestedDate: string | undefined, cutoff: string) {
    return query<MovePrice>(`WITH latest AS (
        SELECT p.ts FROM unnest($1::text[]) AS symbols(symbol)
        CROSS JOIN LATERAL(SELECT ts FROM prices WHERE symbol=symbols.symbol
            AND ts < (($3::date+1)::timestamp AT TIME ZONE 'UTC') ORDER BY ts DESC LIMIT 1)p
        WHERE $2::date IS NULL ORDER BY (symbols.symbol='SPY') DESC,p.ts DESC LIMIT 1
    ), session_date AS (
        SELECT COALESCE($2::date,(SELECT (ts AT TIME ZONE 'UTC')::date FROM latest),$3::date) AS date
    )
    SELECT symbols.symbol,p.ts,p.close,p.loaded_at,session_date.date::text AS price_date,
        EXISTS(SELECT 1 FROM latest) AS has_latest
    FROM session_date CROSS JOIN unnest($1::text[]) AS symbols(symbol)
    LEFT JOIN LATERAL(SELECT ts,close,loaded_at FROM prices WHERE symbol=symbols.symbol
        AND ts < ((LEAST(session_date.date,$3::date)+1)::timestamp AT TIME ZONE 'UTC')
        ORDER BY ts DESC LIMIT 2)p ON true`, [symbols, requestedDate ?? null, cutoff]);
}

export interface StockTag { symbol: string; tag: string }

export async function movedMarkets(holdings: Holding[], date: string, stockTags: StockTag[], measurements: MeasuredRow[]): Promise<OddsMove[]> {
    if (!holdings.length) return [];
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    const end = date === new Date().toISOString().slice(0, 10) ? new Date(Math.min(Date.now(), dayEnd.getTime())) : dayEnd;
    const start = new Date(end.getTime() - 86400000);
    const rows = await query<{ ticker: string; title: string; series_ticker: string; tags: string[]; current_mid: number; previous_mid: number }>(`
        WITH relevant_series AS (
            SELECT series_ticker,array_agg(tag ORDER BY tag) AS tags FROM series_tags
            WHERE reviewed=true AND (tag=ANY($1::text[]) OR tag=ANY($4::text[])) GROUP BY series_ticker
        )
        SELECT m.ticker,m.title,m.series_ticker,s.tags,current.mid AS current_mid,previous.mid AS previous_mid
        FROM relevant_series s JOIN markets m ON m.series_ticker=s.series_ticker
        CROSS JOIN LATERAL(SELECT mid FROM odds_snapshots WHERE ticker=m.ticker
            AND ts<=$2::timestamptz AND ts>=$2::timestamptz-interval '10 minutes' ORDER BY ts DESC LIMIT 1)current
        CROSS JOIN LATERAL(SELECT mid FROM odds_snapshots WHERE ticker=m.ticker
            AND ts<=$3::timestamptz AND ts>=$3::timestamptz-interval '10 minutes' ORDER BY ts DESC LIMIT 1)previous
        WHERE m.status='active' AND m.close_time>now() AND abs((current.mid-previous.mid)*100)>=3`,
    [holdings.map(h => h.symbol), end, start, [...new Set(stockTags.map(t => t.tag))]]);
    const linksBySeries = new Map<string, HoldingLink[]>();
    const result: OddsMove[] = [];
    for (const row of rows) {
        let links = linksBySeries.get(row.series_ticker);
        if (!links) {
            links = holdings.flatMap(h => {
                const link = matchHolding(h, row.tags, stockTags.filter(t => t.symbol === h.symbol).map(t => t.tag), measurements);
                return link ? [link] : [];
            }).sort((a, b) => linkRank[a.type] - linkRank[b.type] || b.valueUsd - a.valueUsd);
            linksBySeries.set(row.series_ticker, links);
        }
        const changePoints = (row.current_mid - row.previous_mid) * 100;
        if (links.length && Math.abs(changePoints) >= 3) result.push({ ticker: row.ticker, title: row.title, changePoints, links });
    }
    return result.sort((a, b) => Math.abs(b.changePoints) - Math.abs(a.changePoints));
}
