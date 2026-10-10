import type { AssetType, Holding, HoldingDetails } from '../../../shared/types.ts';
import { pool, query, iso } from '../db.ts';
const ASSET_TYPES: AssetType[] = ['security', 'cash', 'treasury', 'bond', 'property'];
const DAY = 86400000;
// The terms each asset type needs for its links. Anything else the client sends is dropped.
export function validateDetails(assetType: AssetType, input: unknown, now = Date.now()): HoldingDetails {
    const d = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    if (assetType === 'treasury' || assetType === 'bond') {
        const parsed = typeof d.maturity === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.maturity) ? Date.parse(d.maturity) : NaN;
        // Reject dates the calendar does not have, such as 2030-02-31.
        const maturity = Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === d.maturity ? parsed : NaN;
        if (!(maturity > now) || maturity > now + 100 * 365.25 * DAY)
            throw new Error('Enter a maturity date in the future');
        if (typeof d.couponRate !== 'number' || !Number.isFinite(d.couponRate) || d.couponRate < 0 || d.couponRate > 25)
            throw new Error('Enter a yearly coupon rate between 0 and 25 percent');
        return { maturity: d.maturity as string, couponRate: d.couponRate };
    }
    if (assetType === 'property') {
        if (typeof d.state !== 'string' || !/^[A-Za-z][A-Za-z .]{1,39}$/.test(d.state.trim()))
            throw new Error('Choose the state the property is in');
        if (d.adjustableMortgage !== undefined && (typeof d.adjustableMortgage !== 'number' || !Number.isFinite(d.adjustableMortgage) || d.adjustableMortgage < 0 || d.adjustableMortgage > 1e12))
            throw new Error('Enter the adjustable mortgage balance as a dollar amount');
        return { state: d.state.trim(), ...(d.adjustableMortgage ? { adjustableMortgage: d.adjustableMortgage as number } : {}), ...(d.rental === true ? { rental: true } : {}) };
    }
    return {};
}
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
        const assetType: AssetType = row.assetType ?? 'security';
        if (!ASSET_TYPES.includes(assetType))
            throw new Error('Choose a supported holding type');
        // A listed security is the default and carries no extra fields.
        return assetType === 'security' ? { symbol, valueUsd: row.valueUsd } : { symbol, valueUsd: row.valueUsd, assetType, details: validateDetails(assetType, row.details) };
    });
}
export async function getHoldings(session: string) {
    const rows = await query<{
        symbol: string;
        value_usd: string;
        updated_at: Date;
        asset_type?: AssetType;
        details?: HoldingDetails;
    }>('SELECT * FROM holdings WHERE session_id=$1 ORDER BY symbol', [session]);
    return { holdings: rows.map((r): Holding => ({ symbol: r.symbol, valueUsd: Number(r.value_usd), ...(r.asset_type && r.asset_type !== 'security' ? { assetType: r.asset_type, details: r.details ?? {} } : {}) })), asOf: iso(rows.reduce<Date | null>((d, r) => !d || r.updated_at > d ? r.updated_at : d, null)) };
}
export async function saveHoldings(session: string, holdings: Holding[]) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [session]);
        await client.query('DELETE FROM holdings WHERE session_id=$1', [session]);
        for (const h of holdings)
            await client.query('INSERT INTO holdings(session_id,symbol,value_usd,asset_type,details) VALUES($1,$2,$3,$4,$5)', [session, h.symbol, h.valueUsd, h.assetType ?? 'security', JSON.stringify(h.details ?? {})]);
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
