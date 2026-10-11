import type { ForecastResultResponse, RankedForecastsResponse } from '../../../shared/types.ts';
import { query } from '../db.ts';
import { isSecurity } from './asset-links.ts';
import { eventTime, statedDate } from './kalshi.ts';
import { loadForecasts } from './forecasts.ts';
import { assumedEventResult, predictEventResult, rankForecastEvents, type EventCandidate, type ResultMarketRow } from './event-predictions.ts';
import { validateScenario } from './forecast-model.ts';
import { groupForecastCandidates } from './forecast-groups.ts';
import { DRIVERS } from '../config/drivers.ts';

const TOP_EVENTS = 20;
interface CandidateRow {
    ticker: string; series_ticker: string; title: string; description: string; category: string;
    tags: string[]; linked_symbols: string[]; close_time: Date; occurrence_time: Date | null;
    expected_expiration_time: Date | null; strike_date: Date | null;
}
// Every candidate is considered before ranking. The earlier 200 soonest markets could hide
// a much larger portfolio exposure. Odds lookups happen only AFTER selecting the top events.
const relevant = `WITH relevant AS MATERIALIZED (
    SELECT series_ticker,array_agg(tag) AS tags FROM series_tags WHERE reviewed=true GROUP BY series_ticker
    HAVING bool_or(tag=ANY($1::text[]) OR tag IN(SELECT tag FROM stock_tags WHERE symbol=ANY($1::text[])))
)`;
const linkedSymbols = `ARRAY(SELECT symbol FROM unnest($1::text[])s(symbol)
    WHERE symbol=ANY(r.tags) OR EXISTS(SELECT 1 FROM stock_tags st WHERE st.symbol=s.symbol AND st.tag=ANY(r.tags)))`;

export async function rankedForecasts(session: string, snapshot?: Awaited<ReturnType<typeof loadForecasts>>): Promise<RankedForecastsResponse> {
    const { data, holdings, prices, cutoff } = snapshot ?? await loadForecasts(session, 2);
    const symbols = holdings.filter(isSecurity).map(h => h.symbol);
    const notes = ['Events are ranked by gross measured daily driver sensitivity in dollars: the sum of each holding’s typical measured effect. This compares potential exposure; it is not a forecast of the event’s actual impact.',
        'Related formats across targets and times share one family. Snowflake evaluates the full family for a joint driver estimate; confidence is self-rated and uncalibrated. Individual verified scenarios and contract odds stay separate.'];
    if (!symbols.length) return { totalValue: data.totalValue, candidateEvents: 0, events: [], notes, asOf: data.asOf };
    const rows = await query<CandidateRow>(`${relevant}
        SELECT e.ticker,e.series_ticker,e.title,e.description,e.category,e.strike_date,r.tags,
            ${linkedSymbols} AS linked_symbols,min(m.close_time) AS close_time,
            min(m.occurrence_time) FILTER(WHERE m.occurrence_time>now()) AS occurrence_time,
            min(m.expected_expiration_time) FILTER(WHERE m.expected_expiration_time>now()) AS expected_expiration_time
        FROM relevant r JOIN events e ON e.series_ticker=r.series_ticker JOIN markets m ON m.event_ticker=e.ticker
        WHERE m.status='active' AND m.close_time>now()
        GROUP BY e.ticker,r.tags`, [symbols]);
    const candidates: EventCandidate[] = rows.map(r => {
        const timing = eventTime(Date.now(), r.close_time, r.occurrence_time, r.strike_date, r.expected_expiration_time, statedDate(r.description));
        return { ticker: r.ticker, seriesTicker: r.series_ticker, title: r.title, category: r.category, tags: r.tags,
            linkedSymbols: r.linked_symbols, eventTime: timing.time.toISOString(), eventTimeSource: timing.source, closeTime: r.close_time.toISOString() };
    });
    const groups = groupForecastCandidates(candidates);
    const byTicker = new Map(groups.map(c => [c.ticker, c]));
    const events = rankForecastEvents(groups, data, holdings).slice(0, TOP_EVENTS);
    if (!events.length) return { totalValue: data.totalValue, candidateEvents: rows.length, events, notes, asOf: data.asOf };
    const markets = await query<ResultMarketRow>(`
        SELECT m.ticker,m.event_ticker,m.series_ticker,m.title,e.title AS event_title,m.close_time,
            m.strike_type,m.floor_strike,m.cap_strike,q.ts,q.yes_bid,q.yes_ask
        FROM markets m JOIN events e ON e.ticker=m.event_ticker
        LEFT JOIN LATERAL(SELECT ts,yes_bid,yes_ask FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)q ON true
        WHERE m.event_ticker=ANY($1::text[]) AND m.status='active' AND m.close_time>now()
        ORDER BY m.event_ticker,m.floor_strike NULLS LAST,m.cap_strike NULLS LAST,m.ticker`, [events.flatMap(e => byTicker.get(e.ticker)!.members.map(m => m.ticker))]);
    for (const event of events) {
        const candidate = byTicker.get(event.ticker)!;
        event.groupKey = candidate.groupKey;
        event.timeRange = { from: candidate.members[0].closeTime, to: candidate.members.at(-1)!.closeTime };
        event.sourceEvents = candidate.members.map(m => ({ ticker: m.ticker, seriesTicker: m.seriesTicker, title: m.title,
            closeTime: m.closeTime, url: `https://kalshi.com/markets/kx/m/${m.ticker.toLowerCase()}` }));
        const driver = DRIVERS.find(d => d.key === event.driver);
        const referenceSymbols = [...new Set([driver?.key, driver?.levelReference?.symbol].filter((s): s is string => Boolean(s)))];
        event.prices = referenceSymbols.flatMap(symbol => {
            const price = prices.get(symbol)?.filter(p => p.date <= cutoff && Number.isFinite(p.close)).at(-1);
            return price ? [{ symbol, value: price.close, date: price.date, url: driver?.levelReference?.symbol === symbol ? driver.levelReference.url
                : driver?.source === 'fred' ? `https://fred.stlouisfed.org/series/${symbol}` : `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/` }] : [];
        });
        event.outcomes = markets.filter(m => candidate.members.some(member => member.ticker === m.event_ticker)).map(m => {
            const member = candidate.members.find(member => member.ticker === m.event_ticker)!;
            const prediction = predictEventResult({ ...m, tags: member.tags, linked_symbols: member.linkedSymbols }, data, prices, cutoff);
            return { ...prediction.market, result: prediction.result, linkedSymbols: member.linkedSymbols,
                seriesTicker: m.series_ticker, strike: { type: m.strike_type, floor: m.floor_strike, cap: m.cap_strike } };
        }).sort((a, b) => a.closeTime.localeCompare(b.closeTime) || a.ticker.localeCompare(b.ticker));
        // Select an actual quoted contract, never an interpolated or invented result.
        // Prefer supported quoted scenarios at the nearest close, then near even odds.
        event.preferredMarketTicker = [...event.outcomes].sort((a, b) => Number(b.result.changeUsd !== null) - Number(a.result.changeUsd !== null)
            || Number(b.probability !== null) - Number(a.probability !== null)
            || a.closeTime.localeCompare(b.closeTime)
            || Math.abs((a.probability ?? .5) - .5) - Math.abs((b.probability ?? .5) - .5))[0]?.ticker ?? null;
    }
    const sourceTimes = [data.asOf, ...events.flatMap(e => e.outcomes.map(m => m.asOf))].flatMap(t => t ? [Date.parse(t)] : []).filter(Number.isFinite);
    return { totalValue: data.totalValue, candidateEvents: rows.length, groupedEvents: groups.length, events, notes,
        asOf: sourceTimes.length ? new Date(Math.max(...sourceTimes)).toISOString() : null };
}

export async function forecastResult(session: string, ticker: string, assumption?: unknown, snapshot?: Awaited<ReturnType<typeof loadForecasts>>): Promise<ForecastResultResponse | null> {
    const request = assumption === undefined ? undefined : validateScenario(assumption);
    const { data, holdings, prices, cutoff } = snapshot ?? await loadForecasts(session, 2);
    const symbols = holdings.filter(isSecurity).map(h => h.symbol);
    if (!symbols.length) return null;
    const rows = await query<ResultMarketRow>(`${relevant}
        SELECT m.ticker,m.event_ticker,m.series_ticker,m.title,e.title AS event_title,m.close_time,
            m.strike_type,m.floor_strike,m.cap_strike,r.tags,${linkedSymbols} AS linked_symbols,q.ts,q.yes_bid,q.yes_ask
        FROM relevant r JOIN markets m ON m.series_ticker=r.series_ticker JOIN events e ON e.ticker=m.event_ticker
        LEFT JOIN LATERAL(SELECT ts,yes_bid,yes_ask FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)q ON true
        WHERE m.ticker=$2 AND m.status='active' AND m.close_time>now()`, [symbols, ticker]);
    return rows[0] ? request ? assumedEventResult(rows[0], data, request) : predictEventResult(rows[0], data, prices, cutoff) : null;
}
