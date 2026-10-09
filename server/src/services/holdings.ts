import type { Holding } from '../../../shared/types.ts';
import { pool, query, iso } from '../db.ts';
export function validateHoldings(input: unknown): Holding[] {
    if (!Array.isArray(input) || input.length > 100)
        throw new Error('Provide at most 100 holdings');
    const symbols = new Set<string>();
    return input.map(row => {
        if (!row || typeof row.symbol !== 'string' || typeof row.valueUsd !== 'number')
            throw new Error('Ticker and dollar value required');
        const symbol = row.symbol.trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9.\-^=]{0,14}$/.test(symbol) || !Number.isFinite(row.valueUsd) || row.valueUsd <= 0 || row.valueUsd > 1e12 || Math.abs(row.valueUsd * 100 - Math.round(row.valueUsd * 100)) > 0.001 || symbols.has(symbol))
            throw new Error('Use unique tickers and positive amounts with at most two decimals');
        symbols.add(symbol);
        return { symbol, valueUsd: row.valueUsd };
    });
}
export async function getHoldings(session: string) {
    const rows = await query<{
        symbol: string;
        value_usd: string;
        updated_at: Date;
    }>('SELECT * FROM holdings WHERE session_id=$1 ORDER BY symbol', [session]);
    return { holdings: rows.map(r => ({ symbol: r.symbol, valueUsd: Number(r.value_usd) })), asOf: iso(rows.reduce<Date | null>((d, r) => !d || r.updated_at > d ? r.updated_at : d, null)) };
}
export async function saveHoldings(session: string, holdings: Holding[]) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [session]);
        await client.query('DELETE FROM holdings WHERE session_id=$1', [session]);
        for (const h of holdings)
            await client.query('INSERT INTO holdings(session_id,symbol,value_usd) VALUES($1,$2,$3)', [session, h.symbol, h.valueUsd]);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
    return getHoldings(session);
}
