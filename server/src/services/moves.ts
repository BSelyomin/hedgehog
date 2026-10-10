import type { MovesResponse, HoldingMove, ExposureResponse } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { getHoldings } from './holdings.ts';
import { movePrices, movedMarkets, type StockTag } from './move-data.ts';
import type { MeasuredRow } from './matching.ts';
import { timed } from './request-timing.ts';
import { checkSensitivity } from '../math/statistics.ts';
import { splitMove } from '../math/move.ts';
import { completedPriceDate } from './price-date.ts';
export { splitMove } from '../math/move.ts';
export async function moves(session: string, requestedDate?: string, snapshot?: ExposureResponse): Promise<MovesResponse> {
    const data = snapshot ?? await timed('holdings', () => getHoldings(session));
    const cutoff = completedPriceDate();
    if (!data.holdings.length) return { date: requestedDate ?? cutoff, requestedDate: requestedDate ?? null,
        notes: ['Add holdings to see daily moves.'], asOf: null, holdings: [], spyReturn: null,
        total: null, fromMarket: null, beyondMarket: null, oddsMoves: [] };
    const symbols = [...new Set(['SPY', ...data.holdings.map(h => h.symbol)])];
    const [prices, allMeasurements, stockTags] = await Promise.all([
        timed('prices', () => movePrices(symbols, requestedDate, cutoff)),
        timed('measurements', () => query<MeasuredRow & { price_through: string | null }>(`
            SELECT symbol,b,se,days,driver,low,high,reliable,computed_at,price_through::text
            FROM measured_links WHERE symbol=ANY($1::text[])`, [symbols])),
        timed('tags', () => query<StockTag>('SELECT symbol,tag FROM stock_tags WHERE symbol=ANY($1::text[])', [symbols]))
    ]);
    const date = prices[0]?.price_date ?? requestedDate ?? cutoff;
    const dateEnd = Date.parse(`${date}T23:59:59.999Z`);
    // The prices and measurements are independent reads. Validate source dates
    // after resolving the session, so a historical request never uses future data.
    const measurements = allMeasurements.filter(m => m.price_through
        ? m.price_through <= date : m.computed_at.getTime() <= dateEnd);
    const recent = (symbol: string) => prices.filter(p => p.symbol === symbol && p.ts && p.close !== null)
        .map(p => ({ date: p.ts!.toISOString().slice(0, 10), close: p.close! })).sort((a, b) => a.date.localeCompare(b.date));
    const spy = recent('SPY');
    const current = spy.find(r => r.date === date), previous = spy.filter(r => r.date < date).at(-1);
    const spyReturn = current && previous && previous.close > 0 ? current.close / previous.close - 1 : null;
    const notes: string[] = [];
    if (!requestedDate) notes.push(prices[0]?.has_latest
        ? `Showing the latest stored trading session: ${date}. Daily closes are available after the market closes; weekends and holidays use the last stored session.`
        : 'No completed price history has loaded yet. Price history loads on startup and hourly; try Reload after it finishes.');
    if (spyReturn === null) notes.push(`SPY closing prices for ${date} and its previous session are missing. Market components need both closes.`);
    const holdings: HoldingMove[] = [];
    for (const h of data.holdings) {
        const history = recent(h.symbol);
        const price = history.find(r => r.date === date), prior = history.filter(r => r.date < date).at(-1);
        // Same market session on both series; missing date means no move.
        const actual = price && prior && (!previous || prior.date === previous.date) && prior.close > 0 ? Math.round((price.close / prior.close - 1) * h.valueUsd * 100) / 100 : null;
        let b: number | null = null;
        const measured = measurements.find(m => m.symbol === h.symbol && m.driver === 'SPY');
        if (measured && checkSensitivity(measured.b, measured.se, measured.days).reliable)
            b = measured.b;
        const split = actual !== null && b !== null && spyReturn !== null ? splitMove(actual, b, spyReturn, h.valueUsd) : null;
        const unavailableReasons: string[] = [];
        if (!price) unavailableReasons.push(`No completed ${h.symbol} closing price for ${date}.`);
        else if (!prior) unavailableReasons.push(`A previous closing price for ${h.symbol} has not loaded yet.`);
        else if (actual === null) unavailableReasons.push('The stock and SPY previous closing dates do not align, or the prior price is invalid.');
        if (b === null) unavailableReasons.push('Market split needs a reliable beta measured from at least 60 aligned daily returns.');
        if (spyReturn === null) unavailableReasons.push('SPY history is missing for this session; the stock move can still be shown.');
        holdings.push({ ...h, unavailableReasons, actual, beta: b, fromMarket: split?.fromMarket ?? null, beyondMarket: split?.beyondMarket ?? null, sourceDate: price ? date : null, previousDate: prior?.date ?? null });
    }
    const total = holdings.length && holdings.every(h => h.actual !== null && h.previousDate === holdings[0].previousDate) ? holdings.reduce((s, h) => s + Math.round(h.actual! * 100), 0) / 100 : null;
    if (holdings.length && holdings.every(h => h.actual !== null) && total === null) notes.push('The available stock moves cover different starting dates, so they cannot form one portfolio move.');
    const fromMarket = holdings.length && holdings.every(h => h.fromMarket !== null) ? holdings.reduce((s, h) => s + Math.round(h.fromMarket! * 100), 0) / 100 : null;
    const beyondMarket = total !== null && fromMarket !== null ? (Math.round(total * 100) - Math.round(fromMarket * 100)) / 100 : null;
    const oddsMoves = await timed('odds', () => movedMarkets(data.holdings, date, stockTags, measurements));
    // Freshness comes from the rows already read. Do not scan the whole prices
    // table just to find a timestamp, or include unrelated symbols in it.
    const sourceTimes = prices.flatMap(p => p.ts?.toISOString().slice(0, 10) === date && p.loaded_at ? [p.loaded_at.getTime()] : []);
    const asOf = sourceTimes.length ? iso(new Date(Math.max(...sourceTimes))) : null;
    return { date, requestedDate: requestedDate ?? null, notes, asOf, holdings, spyReturn, total, fromMarket, beyondMarket, oddsMoves };
}
