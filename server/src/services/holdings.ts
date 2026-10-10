import type { Holding } from '../../../shared/types.ts';
import { pool, query, iso } from '../db.ts';
import { contentHash } from './ai-cache.ts';
import { configuration, mode } from '../brokerages/client.ts';
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
    const config = configuration();
    const [rows, imported] = await Promise.all([
        query<{ symbol: string; value_usd: string; updated_at: Date }>(
            'SELECT * FROM holdings WHERE session_id=$1 ORDER BY symbol', [session]),
        session.startsWith('user:') && config.configured ? query<{ symbol: string; value_usd: string; updated_at: Date }>(
            `SELECT h.* FROM brokerage_holdings h JOIN snaptrade_users u ON h.session_id='user:' || u.user_id::text AND h.mode=u.mode
             WHERE h.session_id=$1 AND h.mode=$2 AND u.client_hash=$3 ORDER BY h.symbol`, [session, mode(), config.clientHash]) : Promise.resolve([])
    ]);
    const manualHoldings = rows.map(r => ({ symbol: r.symbol, valueUsd: Number(r.value_usd) }));
    const brokerageHoldings = imported.map(r => ({ symbol: r.symbol, valueUsd: Number(r.value_usd) }));
    const cents = new Map<string, number>();
    for (const h of [...manualHoldings, ...brokerageHoldings]) cents.set(h.symbol, (cents.get(h.symbol) ?? 0) + Math.round(h.valueUsd * 100));
    const holdings = [...cents].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, value]) => ({ symbol, valueUsd: value / 100 }));
    const manualDate = rows.reduce<Date | null>((d, r) => !d || r.updated_at > d ? r.updated_at : d, null);
    const asOf = imported.reduce<Date | null>((d, r) => !d || r.updated_at < d ? r.updated_at : d, manualDate);
    return { holdings, manualHoldings, brokerageHoldings, sandbox: mode() === 'sandbox' && imported.length > 0, asOf: iso(asOf) };
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

export function portfolioRevision(portfolio: Awaited<ReturnType<typeof getHoldings>>) {
    const sorted = (rows: Holding[]) => [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return contentHash({ holdings: sorted(portfolio.holdings), manualHoldings: sorted(portfolio.manualHoldings),
        brokerageHoldings: sorted(portfolio.brokerageHoldings), sandbox: portfolio.sandbox });
}
