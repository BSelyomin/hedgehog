import type { MovesResponse, HoldingMove, OddsMove, DriverMove, ExposureEvent } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { exposure } from './exposure.ts';
import { checkSensitivity } from '../math/statistics.ts';
import { driverContribution, rankMoves, splitMove, sumByDriver } from '../math/move.ts';
import { CONTROL, DRIVERS } from '../config/drivers.ts';
import { reliableRow, strongestPerFamily } from './matching.ts';
import { isSecurity } from './asset-links.ts';
import type { MeasuredRow } from './matching.ts';
import { briefingDay } from './briefing-content.ts';
export { splitMove } from '../math/move.ts';
// Markets whose midpoint moved at least three points between the two ends of the window.
// A market needs a quote at both ends; one without is left out, not treated as unchanged.
export function oddsChanges(events: ExposureEvent[], quotes: { ticker: string; side: 'end' | 'start'; mid: number }[]): OddsMove[] {
    const at = (side: 'end' | 'start') => new Map(quotes.filter(q => q.side === side).map(q => [q.ticker, q.mid]));
    const end = at('end'), start = at('start');
    return events.flatMap(e => e.markets.flatMap(m => {
        const last = end.get(m.ticker), first = start.get(m.ticker);
        const changePoints = last === undefined || first === undefined ? 0 : (last - first) * 100;
        return Math.abs(changePoints) >= 3 ? [{ ticker: m.ticker, title: m.title, changePoints, links: e.links }] : [];
    }));
}
// The latest SPY session before today's New York date. Yahoo's candle for today can still be in progress.
export async function latestSession(): Promise<string | null> {
    return (await query<{ date: string | null }>("SELECT to_char(max(ts),'YYYY-MM-DD') date FROM prices WHERE symbol=$1 AND ts::date<$2::date", [CONTROL, briefingDay()]))[0]?.date ?? null;
}
export async function moves(session: string, date: string): Promise<MovesResponse> {
    const data = await exposure(session);
    // The two latest closes on or before the date for every series the page needs, in one query.
    const otherDrivers = DRIVERS.filter(d => d.key !== CONTROL && d.period === 'day');
    const closes = await query<{
        symbol: string;
        date: string;
        close: number;
    }>(`SELECT symbol,to_char(ts,'YYYY-MM-DD') AS date,close FROM (
            SELECT symbol,ts,close,row_number() OVER (PARTITION BY symbol ORDER BY ts DESC) AS n FROM prices
            WHERE symbol=ANY($1) AND ts::date<=$2::date AND ts>=$2::date-interval '14 days') q WHERE n<=2 ORDER BY symbol,ts`,
    [[CONTROL, ...otherDrivers.map(d => d.key), ...data.holdings.filter(isSecurity).map(h => h.symbol)], date]);
    const recent = (symbol: string) => closes.filter(r => r.symbol === symbol);
    const spy = recent(CONTROL);
    const current = spy.find(r => r.date === date), previous = spy.filter(r => r.date < date).at(-1);
    const spyReturn = current && previous && previous.close > 0 ? current.close / previous.close - 1 : null;
    // Each other daily driver's change over the same session. Yields are published a day late,
    // so a recent date can be missing some; those are reported rather than treated as zero.
    const driverChange = new Map<string, number>();
    const missingDrivers: string[] = [];
    for (const driver of otherDrivers) {
        const rows = recent(driver.key);
        const now = rows.find(r => r.date === date), before = rows.filter(r => r.date < date).at(-1);
        const change = !now || !before || !previous || before.date !== previous.date ? NaN
            : driver.change === 'difference' ? now.close - before.close : before.close > 0 && now.close > 0 ? now.close / before.close - 1 : NaN;
        if (Number.isFinite(change))
            driverChange.set(driver.key, change);
        else
            missingDrivers.push(driver.key);
    }
    const measured = await query<MeasuredRow>('SELECT * FROM measured_links WHERE symbol=ANY($1)', [data.holdings.filter(isSecurity).map(h => h.symbol)]);
    const holdings: HoldingMove[] = [];
    for (const h of data.holdings) {
        // Cash, bonds held directly and property have no daily price, so they have no daily move.
        const history = isSecurity(h) ? recent(h.symbol) : [];
        const price = history.find(r => r.date === date), prior = history.filter(r => r.date < date).at(-1);
        // Same market session on both series; missing date means no move.
        const actual = price && prior && previous && prior.date === previous.date && prior.close > 0 ? Math.round((price.close / prior.close - 1) * h.valueUsd * 100) / 100 : null;
        const own = measured.filter(m => m.symbol === h.symbol);
        // Only the latest beta is stored. It is fitted on five years of daily data, so the day
        // being explained barely changes it.
        const market = own.find(m => m.driver === CONTROL);
        const b = market && checkSensitivity(market.b, market.se, market.days).reliable ? market.b : null;
        const split = actual !== null && b !== null && spyReturn !== null ? splitMove(actual, b, spyReturn, h.valueUsd) : null;
        // What each measured driver's own change would account for. These overlap (the market part
        // is fitted alone, the others with the market held fixed), so they are compared, never summed.
        const drivers: DriverMove[] = split ? [{ driver: CONTROL, contribution: split.fromMarket }] : [];
        if (actual !== null)
            for (const m of strongestPerFamily(own.filter(m => m.driver !== CONTROL && reliableRow(m) && driverChange.has(m.driver))))
                drivers.push({ driver: m.driver, contribution: driverContribution(m.b, driverChange.get(m.driver)!, h.valueUsd) });
        holdings.push({ ...h, actual, beta: b, fromMarket: split?.fromMarket ?? null, beyondMarket: split?.beyondMarket ?? null, sourceDate: price ? date : null, drivers: rankMoves(drivers) });
    }
    // Totals cover the listed securities. A security without a price still leaves them unavailable.
    const priced = holdings.filter(isSecurity);
    const total = priced.length && priced.every(h => h.actual !== null) ? priced.reduce((s, h) => s + Math.round(h.actual! * 100), 0) / 100 : null;
    const fromMarket = priced.length && priced.every(h => h.fromMarket !== null) ? priced.reduce((s, h) => s + Math.round(h.fromMarket! * 100), 0) / 100 : null;
    const beyondMarket = total !== null && fromMarket !== null ? (Math.round(total * 100) - Math.round(fromMarket * 100)) / 100 : null;
    const end = new Date(`${date}T23:59:59.999Z`);
    const start = new Date(end.getTime() - 86400000);
    // One query for every linked market: its latest midpoint in the ten minutes before each end of
    // the window. Asking market by market made thousands of round trips and timed the page out.
    const quotes = await query<{
        ticker: string;
        side: 'end' | 'start';
        mid: number;
    }>(`SELECT DISTINCT ON(ticker,side) ticker,side,mid FROM (
            SELECT ticker,'end' AS side,ts,mid FROM odds_snapshots WHERE ticker=ANY($1) AND ts<=$2 AND ts>=$2::timestamptz-interval '10 minutes'
            UNION ALL SELECT ticker,'start' AS side,ts,mid FROM odds_snapshots WHERE ticker=ANY($1) AND ts<=$3 AND ts>=$3::timestamptz-interval '10 minutes'
        ) q ORDER BY ticker,side,ts DESC`, [data.events.flatMap(e => e.markets.map(m => m.ticker)), end, start]);
    const oddsMoves: OddsMove[] = oddsChanges(data.events, quotes);
    const timestamp = await query<{
        ts: Date | null;
    }>(`SELECT max(loaded_at) ts FROM prices WHERE ts::date=$1::date`, [date]);
    return { date, asOf: iso(timestamp[0]?.ts), holdings, spyReturn, total, fromMarket, beyondMarket, oddsMoves: oddsMoves.sort((a, b) => Math.abs(b.changePoints) - Math.abs(a.changePoints)),
        drivers: sumByDriver(holdings.flatMap(h => h.drivers)), missingDrivers,
        unpricedValue: holdings.filter(h => !isSecurity(h)).reduce((s, h) => s + Math.round(h.valueUsd * 100), 0) / 100 };
}
