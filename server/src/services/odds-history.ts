import type { OddsHistoryResponse, OddsRange } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { QUOTED as quoted } from './kalshi.ts';

// What each range of the event chart draws. `candles` is the period, in minutes, of the Kalshi
// candlestick closes it reads; `own` is how much of Hedgehog's five-minute readings is added:
// every one, the last of each hour, or only the latest so the line ends at the current odds.
export const ODDS_RANGES: Record<OddsRange, { days: number | null; candles: 60 | 1440; own: 'every' | 'hourly' | 'latest' }> = {
    day: { days: 1, candles: 60, own: 'every' },
    week: { days: 7, candles: 60, own: 'hourly' },
    month: { days: 30, candles: 1440, own: 'latest' },
    all: { days: null, candles: 1440, own: 'latest' },
};
export const isOddsRange = (value: unknown): value is OddsRange => typeof value === 'string' && Object.hasOwn(ODDS_RANGES, value);

// A reading with no bid and no offer is not a quote, so it is not drawn (`quoted`, from kalshi.ts).
const OWN = {
    every: `SELECT ts,mid FROM odds_snapshots WHERE ticker=$1 AND ts>=$2 AND ${quoted}`,
    hourly: `SELECT ts,mid FROM (SELECT DISTINCT ON (date_trunc('hour',ts)) ts,mid FROM odds_snapshots WHERE ticker=$1 AND ts>=$2 AND ${quoted} ORDER BY date_trunc('hour',ts),ts DESC) hourly`,
    latest: `(SELECT ts,mid FROM odds_snapshots WHERE ticker=$1 AND ts>=$2 AND ${quoted} ORDER BY ts DESC LIMIT 1)`,
};

export async function oddsHistory(ticker: string, range: OddsRange, now = new Date()): Promise<OddsHistoryResponse | null> {
    const market = (await query<{ open_time: Date | null }>('SELECT open_time FROM markets WHERE ticker=$1', [ticker]))[0];
    if (!market)
        return null;
    const { days, candles, own } = ODDS_RANGES[range];
    // All time starts when Kalshi listed the market.
    const from = days === null ? market.open_time : new Date(now.getTime() - days * 86400000);
    const rows = await query<{ ts: Date; mid: number }>(`${OWN[own]} UNION ALL SELECT ts,mid FROM odds_candles WHERE ticker=$1 AND minutes=$3 AND ts>=$2 ORDER BY ts`, [ticker, from ?? new Date(0), candles]);
    const points = rows.map(row => ({ ts: row.ts.toISOString(), probability: row.mid }));
    return { ticker, range, from: iso(from) ?? points[0]?.ts ?? null, to: now.toISOString(), listed: iso(market.open_time), points, asOf: points.at(-1)?.ts ?? null };
}
