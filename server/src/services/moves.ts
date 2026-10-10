import type { MovesResponse, HoldingMove, ExposureResponse, ExposureEvent, DriverChange, DriverMove, HoldingLink, MoveRange } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { getHoldings } from './holdings.ts';
import { MOVE_RANGES, eventLinks, movePrices, movedMarkets, settledMarkets, type MovePrice, type StockTag } from './move-data.ts';
import type { MeasuredRow } from './matching.ts';
import { timed } from './request-timing.ts';
import { CONTROL, DRIVERS, driverFor } from '../config/drivers.ts';
import { materialRows, reliableRow, strongestPerFamily } from './matching.ts';
import { isSecurity } from './asset-links.ts';
import { driverContribution, rankMoves, splitMove, sumByDriver, valueAt } from '../math/move.ts';
import { closeInstant, completedPriceDate } from './price-date.ts';
export { splitMove } from '../math/move.ts';

// Compares today's holdings at two closes. No history of what was held is stored, so the amount
// held now is assumed held throughout: the value entered is read as the worth at the latest
// stored close and scaled by the price to each end of the window.
export async function moves(session: string, requestedDate?: string, snapshot?: ExposureResponse, range: MoveRange = 'day'): Promise<MovesResponse> {
    const data = snapshot ?? await timed('holdings', () => getHoldings(session));
    const cutoff = completedPriceDate();
    if (!data.holdings.length) return { date: requestedDate ?? cutoff, requestedDate: requestedDate ?? null, range, startDate: null,
        notes: ['Add holdings to see how they moved.'], asOf: null, holdings: [], spyReturn: null, startValue: null, endValue: null,
        total: null, fromMarket: null, beyondMarket: null, oddsWindow: null, movedEvents: [], settledEvents: [], drivers: [], driverChanges: [], missingDrivers: [], unpricedValue: 0 };
    const securitySymbols = data.holdings.filter(isSecurity).map(h => h.symbol);
    const otherDrivers = DRIVERS.filter(d => d.key !== CONTROL && d.period === 'day');
    const symbols = [...new Set([CONTROL, ...securitySymbols, ...otherDrivers.map(d => d.key)])];
    const [prices, allMeasurements, stockTags] = await Promise.all([
        timed('prices', () => movePrices(symbols, requestedDate, cutoff, [CONTROL, ...securitySymbols], MOVE_RANGES[range].back)),
        timed('measurements', () => query<MeasuredRow & { price_through: string | null }>(`
            SELECT symbol,b,se,days,driver,low,high,reliable,effect,computed_at,price_through::text
            FROM measured_links WHERE symbol=ANY($1::text[])`, [symbols])),
        timed('tags', () => query<StockTag>('SELECT symbol,tag FROM stock_tags WHERE symbol=ANY($1::text[])', [symbols]))
    ]);
    const date = prices[0]?.price_date ?? requestedDate ?? cutoff;
    const dateEnd = Date.parse(`${date}T23:59:59.999Z`);
    // The prices and measurements are independent reads. Validate source dates
    // after resolving the session, so a historical request never uses future data.
    const measurements = allMeasurements.filter(m => m.price_through
        ? m.price_through <= date : m.computed_at.getTime() <= dateEnd);
    const close = (symbol: string, role: MovePrice['role']) => {
        const row = prices.find(p => p.symbol === symbol && p.role === role && p.ts && p.close !== null);
        return row ? { date: row.ts!.toISOString().slice(0, 10), close: row.close! } : null;
    };
    // A close counts for the window's end only when it is that session's own.
    const ending = (symbol: string) => { const row = close(symbol, 'end'); return row?.date === date ? row : null; };
    // The stock market's sessions set the window: it opens on SPY's last close at or before the date asked for.
    const current = ending(CONTROL), previous = close(CONTROL, 'start');
    const spyReturn = current && previous && previous.close > 0 ? current.close / previous.close - 1 : null;
    const driverChange = new Map<string, number>();
    const missingDrivers: string[] = [];
    for (const driver of otherDrivers) {
        const now = ending(driver.key), before = close(driver.key, 'start');
        const change = !now || !before || !previous || before.date !== previous.date ? NaN
            : driver.change === 'difference' ? now.close - before.close
            : before.close > 0 && now.close > 0 ? now.close / before.close - 1 : NaN;
        if (Number.isFinite(change)) driverChange.set(driver.key, change);
        else missingDrivers.push(driver.key);
    }
    const notes: string[] = [];
    if (!requestedDate) notes.push(prices[0]?.has_latest
        ? `Showing the latest stored trading session: ${date}. Daily closes are available after the market closes; weekends and holidays use the last stored session.`
        : 'No completed price history has loaded yet. Price history loads on startup and hourly; try Reload after it finishes.');
    if (spyReturn === null) notes.push(`SPY closing prices for ${date} and the session this window opens on are missing. Market components need both closes.`);
    const holdings: HoldingMove[] = [];
    for (const h of data.holdings) {
        if (!isSecurity(h)) {
            holdings.push({ ...h, unavailableReasons: ['This holding has no daily price; listed-security move totals leave it out.'],
                startValue: null, endValue: null, actual: null, beta: null, fromMarket: null, beyondMarket: null, sourceDate: null, previousDate: null, drivers: [] });
            continue;
        }
        // The latest close is read separately only when the window ends before it.
        const price = ending(h.symbol), prior = close(h.symbol, 'start'), latest = close(h.symbol, 'latest') ?? close(h.symbol, 'end');
        // Same market sessions on both series; a missing close at either end means no move.
        const aligned = price && prior && latest && (!previous || prior.date === previous.date) && prior.close > 0 && latest.close > 0;
        const startValue = aligned ? valueAt(h.valueUsd, prior.close, latest.close) : null;
        const endValue = aligned ? valueAt(h.valueUsd, price.close, latest.close) : null;
        const actual = startValue !== null && endValue !== null ? (Math.round(endValue * 100) - Math.round(startValue * 100)) / 100 : null;
        let b: number | null = null;
        const measured = measurements.find(m => m.symbol === h.symbol && m.driver === 'SPY');
        if (measured && reliableRow(measured))
            b = measured.b;
        const split = actual !== null && b !== null && spyReturn !== null ? splitMove(actual, b, spyReturn, startValue!) : null;
        const unavailableReasons: string[] = [];
        if (!price) unavailableReasons.push(`No completed ${h.symbol} closing price for ${date}.`);
        else if (!prior) unavailableReasons.push(`No ${h.symbol} closing price is stored for the start of this window.`);
        else if (actual === null) unavailableReasons.push(`${h.symbol} has no close on the session this window opens on${previous ? ` (${previous.date})` : ''}, or its price there is invalid.`);
        if (b === null) unavailableReasons.push('Market split needs a reliable beta measured from at least 60 aligned daily returns.');
        if (spyReturn === null) unavailableReasons.push('SPY history is missing for this window; the stock move can still be shown.');
        const drivers: DriverMove[] = split ? [{ driver: CONTROL, contribution: split.fromMarket }] : [];
        if (actual !== null) {
            // Only a measurement big enough to draw a link from gives an estimate (see materialRows).
            const own = materialRows(h.symbol, measurements).filter(m => m.driver !== CONTROL && driverChange.has(m.driver));
            for (const m of strongestPerFamily(own))
                drivers.push({ driver: m.driver, contribution: driverContribution(m.b, driverChange.get(m.driver)!, startValue!) });
        }
        holdings.push({ ...h, drivers: rankMoves(drivers), unavailableReasons, startValue, endValue, actual, beta: b, fromMarket: split?.fromMarket ?? null, beyondMarket: split?.beyondMarket ?? null, sourceDate: price ? date : null, previousDate: prior?.date ?? null });
    }
    const priced = holdings.filter(isSecurity);
    const whole = priced.length > 0 && priced.every(h => h.actual !== null && h.previousDate === priced[0].previousDate);
    const sum = (field: 'actual' | 'startValue' | 'endValue' | 'fromMarket') => priced.reduce((s, h) => s + Math.round(h[field]! * 100), 0) / 100;
    const total = whole ? sum('actual') : null;
    if (priced.length && priced.every(h => h.actual !== null) && total === null) notes.push('The available stock moves cover different starting dates, so they cannot form one portfolio move.');
    const fromMarket = priced.length && priced.every(h => h.fromMarket !== null) ? sum('fromMarket') : null;
    const beyondMarket = total !== null && fromMarket !== null ? (Math.round(total * 100) - Math.round(fromMarket * 100)) / 100 : null;
    // Kalshi over the same window as the prices: from the close it opens on to the close it ends on.
    const startDate = previous?.date ?? priced.find(h => h.previousDate)?.previousDate ?? null;
    const oddsWindow = startDate ? { from: closeInstant(startDate), to: new Date(Math.min(Date.now(), closeInstant(date).getTime())) } : null;
    const context = { now: dateEnd, shortYield: close('DGS2', 'end')?.close ?? null, longYield: close('DGS10', 'end')?.close ?? null };
    // A link's estimate is listed under the one driver of its family the holding is compared on.
    const listed = (symbol: string, driver: string) => holdings.find(h => h.symbol === symbol)?.drivers.find(d => driverFor(d.driver)?.family === driverFor(driver)?.family)?.driver ?? driver;
    const links = (event: { tags: string[]; title: string }) => eventLinks(data.holdings, event.tags, event.title, stockTags, measurements, context, listed);
    const [movedEvents, settledEvents] = oddsWindow && oddsWindow.from < oddsWindow.to ? await Promise.all([
        timed('odds', () => movedMarkets(data.holdings, oddsWindow, stockTags, links)),
        timed('settled', () => settledMarkets(data.holdings, oddsWindow, stockTags, links))]) : [[], []];
    // Freshness comes from the rows already read. Do not scan the whole prices
    // table just to find a timestamp, or include unrelated symbols in it.
    const sourceTimes = prices.flatMap(p => p.role === 'end' && p.ts?.toISOString().slice(0, 10) === date && p.loaded_at ? [p.loaded_at.getTime()] : []);
    const asOf = sourceTimes.length ? iso(new Date(Math.max(...sourceTimes))) : null;
    const driverChanges: DriverChange[] = [...(spyReturn === null ? [] : [{ driver: CONTROL, kind: 'return' as const, change: spyReturn }]),
        ...otherDrivers.flatMap(d => driverChange.has(d.key) ? [{ driver: d.key, kind: d.change, change: driverChange.get(d.key)! }] : [])];
    return { date, requestedDate: requestedDate ?? null, range, startDate, notes, asOf, holdings, spyReturn, startValue: whole ? sum('startValue') : null, endValue: whole ? sum('endValue') : null,
        total, fromMarket, beyondMarket, oddsWindow: oddsWindow && { from: oddsWindow.from.toISOString(), to: oddsWindow.to.toISOString() }, movedEvents, settledEvents,
        drivers: sumByDriver(holdings.flatMap(h => h.drivers)), driverChanges, missingDrivers,
        unpricedValue: holdings.filter(h => !isSecurity(h)).reduce((s, h) => s + Math.round(h.valueUsd * 100), 0) / 100 };
}

export function oddsChanges(events: ExposureEvent[], quotes: { ticker: string; side: 'end' | 'start'; mid: number }[]): { ticker: string; title: string; changePoints: number; links: HoldingLink[] }[] {
    const at = (side: 'end' | 'start') => new Map(quotes.filter(q => q.side === side).map(q => [q.ticker, q.mid]));
    const end = at('end'), start = at('start');
    return events.flatMap(e => e.markets.flatMap(m => {
        const last = end.get(m.ticker), first = start.get(m.ticker);
        const changePoints = last === undefined || first === undefined ? 0 : (last - first) * 100;
        return Math.abs(changePoints) >= 3 ? [{ ticker: m.ticker, title: m.title, changePoints, links: e.links }] : [];
    }));
}
