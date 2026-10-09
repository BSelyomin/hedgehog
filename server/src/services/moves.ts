import type { MovesResponse, HoldingMove, OddsMove } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { exposure } from './exposure.ts';
import { checkSensitivity } from '../math/statistics.ts';
import { splitMove } from '../math/move.ts';
export { splitMove } from '../math/move.ts';
export async function moves(session: string, date: string): Promise<MovesResponse> {
    const data = await exposure(session);
    const recent = async (symbol: string) => (await query<{
        ts: Date;
        close: number;
    }>(`SELECT ts,close FROM prices WHERE symbol=$1 AND ts::date<=$2::date ORDER BY ts DESC LIMIT 2`, [symbol, date])).reverse().map(r => ({ date: r.ts.toISOString().slice(0, 10), close: r.close }));
    const spy = await recent('SPY');
    const current = spy.find(r => r.date === date), previous = spy.filter(r => r.date < date).at(-1);
    const spyReturn = current && previous && previous.close > 0 ? current.close / previous.close - 1 : null;
    const holdings: HoldingMove[] = [];
    for (const h of data.holdings) {
        const history = await recent(h.symbol);
        const price = history.find(r => r.date === date), prior = history.filter(r => r.date < date).at(-1);
        // Same market session on both series; missing date means no move.
        const actual = price && prior && previous && prior.date === previous.date && prior.close > 0 ? Math.round((price.close / prior.close - 1) * h.valueUsd * 100) / 100 : null;
        let b: number | null = null;
        const measured = (await query<{
            b: number;
            se: number;
            days: number;
            computed_at: Date;
        }>(`SELECT b,se,days,computed_at FROM measured_links WHERE symbol=$1 AND driver='SPY' AND computed_at<$2::date+interval '1 day'`, [h.symbol, date]))[0];
        if (measured && checkSensitivity(measured.b, measured.se, measured.days).reliable)
            b = measured.b;
        const split = actual !== null && b !== null && spyReturn !== null ? splitMove(actual, b, spyReturn, h.valueUsd) : null;
        holdings.push({ ...h, actual, beta: b, fromMarket: split?.fromMarket ?? null, beyondMarket: split?.beyondMarket ?? null, sourceDate: price ? date : null });
    }
    const total = holdings.length && holdings.every(h => h.actual !== null) ? holdings.reduce((s, h) => s + Math.round(h.actual! * 100), 0) / 100 : null;
    const fromMarket = holdings.length && holdings.every(h => h.fromMarket !== null) ? holdings.reduce((s, h) => s + Math.round(h.fromMarket! * 100), 0) / 100 : null;
    const beyondMarket = total !== null && fromMarket !== null ? (Math.round(total * 100) - Math.round(fromMarket * 100)) / 100 : null;
    const end = new Date(`${date}T23:59:59.999Z`);
    const start = new Date(end.getTime() - 86400000);
    const oddsMoves: OddsMove[] = [];
    for (const e of data.events)
        for (const m of e.markets) {
            const quotes = await query<{
                ts: Date;
                mid: number;
            }>(`(SELECT ts,mid FROM odds_snapshots WHERE ticker=$1 AND ts<=$2 AND ts>=$2::timestamptz-interval '10 minutes' ORDER BY ts DESC LIMIT 1) UNION ALL (SELECT ts,mid FROM odds_snapshots WHERE ticker=$1 AND ts<=$3 AND ts>=$3::timestamptz-interval '10 minutes' ORDER BY ts DESC LIMIT 1)`, [m.ticker, end, start]);
            if (quotes.length === 2) {
                const changePoints = (quotes[0].mid - quotes[1].mid) * 100;
                if (Math.abs(changePoints) >= 3)
                    oddsMoves.push({ ticker: m.ticker, title: m.title, changePoints, links: e.links });
            }
        }
    const timestamp = await query<{
        ts: Date | null;
    }>(`SELECT max(loaded_at) ts FROM prices WHERE ts::date=$1::date`, [date]);
    return { date, asOf: iso(timestamp[0]?.ts), holdings, spyReturn, total, fromMarket, beyondMarket, oddsMoves: oddsMoves.sort((a, b) => Math.abs(b.changePoints) - Math.abs(a.changePoints)) };
}
