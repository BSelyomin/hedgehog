import { query } from '../db.ts';

export interface PriceRow { date: string; close: number }

// Bound each write so a remote database needs a handful of round trips per symbol.
export async function storePrices(symbol: string, rows: PriceRow[]) {
    for (let start = 0; start < rows.length; start += 500) {
        const batch = rows.slice(start, start + 500);
        await query(`INSERT INTO prices(ts,symbol,close)
            SELECT ts,$1,close FROM unnest($2::timestamptz[],$3::double precision[]) AS source(ts,close)
            ON CONFLICT(ts,symbol) DO UPDATE SET close=excluded.close,loaded_at=now()`,
        [symbol, batch.map(row => row.date), batch.map(row => row.close)]);
    }
}
