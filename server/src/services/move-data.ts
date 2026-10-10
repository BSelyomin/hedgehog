import type { Holding, MoveLink, MoveRange, MovedEvent, OddsMove, SettledEvent, SettledMarket } from '../../../shared/types.ts';
import { query } from '../db.ts';
import { ASSET_TAGS, assetLink, assetType, isSecurity, type AssetContext } from './asset-links.ts';
import { linkThemes } from './categories.ts';
import { matchHolding, linkRank, type MeasuredRow } from './matching.ts';
import { TRUST } from '../config/trust.ts';

// How far back each window opens from its last close. The first close is the last session at or
// before that date, so a week ending on a Friday opens on the Friday before.
export const MOVE_RANGES: Record<MoveRange, { back: string }> = {
    day: { back: '1 day' }, week: { back: '7 days' }, month: { back: '1 month' }, quarter: { back: '3 months' },
};
export const isMoveRange = (value: unknown): value is MoveRange => typeof value === 'string' && Object.hasOwn(MOVE_RANGES, value);

export interface MovePrice {
    symbol: string;
    /** The close the window ends on, the one it opens on, or the latest stored (the value entered is read as of that one). */
    role: 'end' | 'start' | 'latest' | null;
    ts: Date | null;
    close: number | null;
    loaded_at: Date | null;
    price_date: string;
    has_latest: boolean;
}

// A close is taken as a date's when it is the last one at or before it and no more than this
// many days older. The limit is also what keeps the lookups fast: prices are stored in a chunk
// per week over ten years, and a lookup with no lower bound made the planner open every one of
// them (about 0.1 s per lookup on 2026-10-10, against 0.03 s for all symbols with a bound).
export const PRICE_LOOKBACK_DAYS = 30;

// Resolve the default session and read each symbol's closes in one database round trip.
// LEFT JOIN preserves the selected date even when a symbol has no prices yet.
export function movePrices(symbols: string[], requestedDate: string | undefined, cutoff: string, sessionSymbols = symbols, back = MOVE_RANGES.day.back) {
    const midnight = (date: string) => `((${date})::timestamp AT TIME ZONE 'UTC')`;
    const last = (date: string) => `ts < ${midnight(`${date}+1`)} AND ts >= ${midnight(`${date}-${PRICE_LOOKBACK_DAYS}`)} ORDER BY ts DESC LIMIT 1`;
    // The same limits written with the request's parameters alone, which is what lets the planner
    // leave chunks out. The session resolved below is at most one lookback before the cutoff.
    const near = (date: string) => `ts < ${midnight(`${date}+1`)} AND ts >= ${midnight(`${date}-${2 * PRICE_LOOKBACK_DAYS}`)}`;
    const ends = 'LEAST(COALESCE($2::date,$3::date),$3::date)', opens = 'LEAST((COALESCE($2::date,$3::date)-$5::interval)::date,$3::date)';
    return query<MovePrice>(`WITH latest AS (
        SELECT p.ts FROM unnest($1::text[]) AS symbols(symbol)
        CROSS JOIN LATERAL(SELECT ts FROM prices WHERE symbol=symbols.symbol AND ${last('$3::date')})p
        WHERE $2::date IS NULL AND symbols.symbol=ANY($4::text[]) ORDER BY (symbols.symbol='SPY') DESC,p.ts DESC LIMIT 1
    ), session_date AS (
        SELECT COALESCE($2::date,(SELECT (ts AT TIME ZONE 'UTC')::date FROM latest),$3::date) AS date
    ), bounds AS (
        SELECT date,LEAST(date,$3::date) AS last,LEAST((date-$5::interval)::date,$3::date) AS opens FROM session_date
    )
    SELECT symbols.symbol,p.ts,p.close,p.loaded_at,p.role,bounds.date::text AS price_date,
        EXISTS(SELECT 1 FROM latest) AS has_latest
    FROM bounds CROSS JOIN unnest($1::text[]) AS symbols(symbol)
    LEFT JOIN LATERAL(
        (SELECT 'end' AS role,ts,close,loaded_at FROM prices WHERE symbol=symbols.symbol AND ${near(ends)} AND ${last('bounds.last')})
        UNION ALL (SELECT 'start',ts,close,loaded_at FROM prices WHERE symbol=symbols.symbol AND ${near(opens)} AND ${last('bounds.opens')})
        -- When the window ends on the latest session, its last close is the latest one and this lookup is skipped.
        UNION ALL (SELECT 'latest',ts,close,loaded_at FROM prices WHERE symbol=symbols.symbol AND bounds.last<$3::date AND ${last('$3::date')})
    )p ON true`, [symbols, requestedDate ?? null, cutoff, sessionSymbols, back]);
}

export interface StockTag { symbol: string; tag: string }
/** The instants Kalshi's odds are read at: the window's first and last close. */
export interface OddsWindow { from: Date; to: Date }

// A reading older than this is not taken as the quote standing at an instant (as in the track record).
export const READING_DAYS = 7;
export const MIN_MOVE_POINTS = 3;
// How many of an event's markets are sent; the counts cover all of them.
export const MARKETS_SHOWN = 3;

// A quote wider than this is not compared. Its midpoint moves when one side of the book steps
// back, with no trade and no news: over one day of our own snapshots (2026-10-10), 10 of the
// 3,952 markets quoted within ten cents at both ends moved 20 points or more, and 95 of the
// 1,966 with a wider quote at either end did. Ten cents is also where the trust score stops
// giving any credit for the spread.
export const MAX_MOVE_SPREAD = TRUST.spreadWorst / 100;
// Spreads are stored in single precision, so the test allows a hundredth of a cent.
const NARROW = (MAX_MOVE_SPREAD + .0001).toFixed(4);

// The quote standing at an instant: the newest of Kalshi's candlestick closes at or before it
// and, when the poller was running, our own snapshot from its last ten minutes. Kalshi publishes
// a candlestick only when the quote changes, so an older close still stands. Each comes with its
// spread; a candlestick stored before spreads were kept has none and cannot be compared.
const reading = (at: string) => `(SELECT ts,mid,spread FROM (
        (SELECT ts,mid,spread FROM odds_candles WHERE ticker=m.ticker AND minutes=60 AND ts<=${at} AND ts>${at}-interval '${READING_DAYS} days' ORDER BY ts DESC LIMIT 1)
        UNION ALL (SELECT ts,mid,spread FROM odds_candles WHERE ticker=m.ticker AND minutes=1440 AND ts<=${at} AND ts>${at}-interval '${READING_DAYS} days' ORDER BY ts DESC LIMIT 1)
        UNION ALL (SELECT ts,mid,(yes_ask-yes_bid)::real FROM odds_snapshots WHERE ticker=m.ticker AND ts<=${at} AND ts>${at}-interval '10 minutes' ORDER BY ts DESC LIMIT 1)
    )r ORDER BY ts DESC,spread NULLS LAST LIMIT 1)`;
// Series a holding could link to: tagged with its ticker, one of its topics, or its asset type's topics.
const RELEVANT = `WITH relevant_series AS (
        SELECT series_ticker,array_agg(tag ORDER BY tag) AS tags FROM series_tags
        WHERE reviewed=true AND (tag=ANY($1::text[]) OR tag=ANY($4::text[])) GROUP BY series_ticker
    )`;
const relevant = (holdings: Holding[], stockTags: StockTag[], window: OddsWindow) => [holdings.filter(isSecurity).map(h => h.symbol), window.to, window.from,
    [...new Set([...stockTags.map(t => t.tag), ...holdings.flatMap(h => { const type = assetType(h); return type === 'security' ? [] : ASSET_TAGS[type]; })])]];

// Kalshi writes some titles with Markdown emphasis.
const plain = (title: string) => title.replaceAll('**', '');

// Each holding's link to one event, strongest first. `listed` names the driver a holding's
// estimate for the window is shown under: one per family, so a Fed market's link to a bond fund
// points at the yield that fund is compared on.
export function eventLinks(holdings: Holding[], tags: string[], title: string, stockTags: StockTag[], measurements: MeasuredRow[], context: AssetContext, listed: (symbol: string, driver: string) => string = (_symbol, driver) => driver): MoveLink[] {
    return holdings.flatMap(holding => {
        const own = stockTags.filter(t => t.symbol === holding.symbol).map(t => t.tag);
        const link = isSecurity(holding) ? matchHolding(holding, tags, own, measurements) : assetLink(holding, tags, title, context);
        return link ? [{ link, themes: linkThemes(link, tags, own, measurements) }] : [];
    }).sort((a, b) => linkRank[a.link.type] - linkRank[b.link.type] || b.link.valueUsd - a.link.valueUsd)
        .map(({ link, themes }) => ({ symbol: link.symbol, type: link.type, driver: link.sensitivity ? listed(link.symbol, link.sensitivity.driver) : null, themes }));
}

export interface MovedRow { ticker: string; title: string; series_ticker: string; event_ticker: string | null; event_title: string; tags: string[]; current_mid: number; previous_mid: number; current_ts: Date; previous_ts: Date }
export interface SettledRow { ticker: string; title: string | null; series_ticker: string; event_ticker: string | null; event_title: string | null; tags: string[]; outcome: number; prob_24h_before: number; close_time: Date }
type Linker = (row: { tags: string[]; title: string }) => MoveLink[];

// One entry per event, the biggest mover first. An event no holding is linked to is left out.
export function groupMoved(rows: MovedRow[], links: Linker): MovedEvent[] {
    const events = new Map<string, MovedEvent>();
    for (const row of rows) {
        // Whole hundredths of a point, so that 55% to 58% is three points and not 2.9999….
        const changePoints = Math.round((row.current_mid - row.previous_mid) * 10000) / 100;
        if (Math.abs(changePoints) < MIN_MOVE_POINTS)
            continue;
        const key = row.event_ticker ?? row.series_ticker;
        let event = events.get(key);
        if (!event)
            events.set(key, event = { ticker: key, title: plain(row.event_title), links: links({ tags: row.tags, title: row.event_title }), markets: [], moved: 0 });
        event.markets.push({ ticker: row.ticker, title: plain(row.title), from: row.previous_mid, to: row.current_mid, fromTime: row.previous_ts.toISOString(), toTime: row.current_ts.toISOString(), changePoints });
    }
    const size = (market: OddsMove) => Math.abs(market.changePoints);
    return [...events.values()].filter(event => event.links.length).map(event => {
        const markets = event.markets.sort((a, b) => size(b) - size(a) || a.ticker.localeCompare(b.ticker));
        return { ...event, moved: markets.length, markets: markets.slice(0, MARKETS_SHOWN) };
    }).sort((a, b) => size(b.markets[0]) - size(a.markets[0]) || a.ticker.localeCompare(b.ticker));
}

// One entry per settled event. Its markets are ordered by how far the result was from the odds a
// day before, so an event leads with what Kalshi least expected; events are ordered the same way.
export function groupSettled(rows: SettledRow[], links: Linker): SettledEvent[] {
    const events = new Map<string, SettledEvent>();
    for (const row of rows) {
        if (row.outcome !== 0 && row.outcome !== 1)
            continue;
        const key = row.event_ticker ?? row.ticker, title = row.event_title ?? row.title ?? row.ticker;
        let event = events.get(key);
        if (!event)
            events.set(key, event = { ticker: key, title: row.event_title ? plain(row.event_title) : null, closeTime: row.close_time.toISOString(), links: links({ tags: row.tags, title }), markets: [], settled: 0, yes: 0 });
        event.markets.push({ ticker: row.ticker, title: plain(row.title ?? row.ticker), outcome: row.outcome, probabilityBefore: row.prob_24h_before, closeTime: row.close_time.toISOString() });
        if (row.close_time.toISOString() > event.closeTime)
            event.closeTime = row.close_time.toISOString();
    }
    const miss = (market: SettledMarket) => Math.abs(market.outcome - market.probabilityBefore);
    return [...events.values()].filter(event => event.links.length).map(event => {
        const markets = event.markets.sort((a, b) => miss(b) - miss(a) || a.ticker.localeCompare(b.ticker));
        return { ...event, settled: markets.length, yes: markets.filter(market => market.outcome === 1).length, markets: markets.slice(0, MARKETS_SHOWN) };
    }).sort((a, b) => miss(b.markets[0]) - miss(a.markets[0]) || b.closeTime.localeCompare(a.closeTime) || a.ticker.localeCompare(b.ticker));
}

// Markets open at the window's last close whose odds moved between its two closes. A market
// needs a narrow quote at both ends; an empty book, at 100 cents wide, never is one.
export async function movedMarkets(holdings: Holding[], window: OddsWindow, stockTags: StockTag[], links: Linker): Promise<MovedEvent[]> {
    if (!holdings.length)
        return [];
    const rows = await query<MovedRow>(`${RELEVANT}
        SELECT m.ticker,m.title,m.series_ticker,m.event_ticker,e.title AS event_title,s.tags,current.mid AS current_mid,previous.mid AS previous_mid,current.ts AS current_ts,previous.ts AS previous_ts
        FROM relevant_series s JOIN markets m ON m.series_ticker=s.series_ticker JOIN events e ON e.ticker=m.event_ticker
        CROSS JOIN LATERAL ${reading('$2::timestamptz')}current
        CROSS JOIN LATERAL ${reading('$3::timestamptz')}previous
        WHERE m.close_time>$2::timestamptz AND current.spread<=${NARROW} AND previous.spread<=${NARROW} AND abs(current.mid-previous.mid)>=${(MIN_MOVE_POINTS - .005) / 100}`,
    relevant(holdings, stockTags, window));
    return groupMoved(rows, links);
}

// Settled markets that closed after the window's first close and by its last, with the odds
// Kalshi gave a day before each closed (read by the track-record backfill).
export async function settledMarkets(holdings: Holding[], window: OddsWindow, stockTags: StockTag[], links: Linker): Promise<SettledEvent[]> {
    if (!holdings.length)
        return [];
    const rows = await query<SettledRow>(`${RELEVANT}
        SELECT x.ticker,x.title,x.series_ticker,x.event_ticker,e.title AS event_title,s.tags,x.outcome,x.prob_24h_before,x.close_time
        FROM relevant_series s JOIN settled_markets x ON x.series_ticker=s.series_ticker LEFT JOIN events e ON e.ticker=x.event_ticker
        WHERE x.close_time<=$2::timestamptz AND x.close_time>$3::timestamptz`,
    relevant(holdings, stockTags, window));
    return groupSettled(rows, links);
}
