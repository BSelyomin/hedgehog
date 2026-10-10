import type { AssetType, Holding } from '../../../shared/types';

// Columns, in this order. A stock or fund needs only the first two, so the original two-column
// files still import. The rest describe a holding without a ticker. A header row is optional.
export const CSV_COLUMNS = 'symbol,valueUsd,type,maturity,couponRate,state,adjustableMortgage,rental';
const TYPES: AssetType[] = ['security', 'cash', 'treasury', 'bond', 'property'];

export function parseHoldingsCsv(text: string): Holding[] {
    const rows = text.trim().split(/\r?\n/).map(line => line.split(',').map(cell => cell.trim())).filter(cells => cells.some(Boolean));
    if (rows[0]?.[0]?.toLowerCase() === 'symbol')
        rows.shift();
    const holdings = rows.map(([name = '', value = '', type = '', maturity = '', couponRate = '', state = '', mortgage = '', rental = '']): Holding => {
        const symbol = name.toUpperCase(), valueUsd = Number(value), assetType = (type.toLowerCase() || 'security') as AssetType;
        if (!symbol || value === '' || !Number.isFinite(valueUsd) || valueUsd <= 0)
            throw new Error('CSV must contain unique symbol,valueUsd rows with positive values.');
        if (!TYPES.includes(assetType))
            throw new Error(`${symbol}: type must be one of ${TYPES.join(', ')}.`);
        if (assetType === 'security')
            return { symbol, valueUsd };
        if (assetType === 'cash')
            return { symbol, valueUsd, assetType, details: {} };
        if (assetType === 'property') {
            const balance = Number(mortgage);
            if (!state || !Number.isFinite(balance) || balance < 0)
                throw new Error(`${symbol}: a property needs its state, and a mortgage balance that is a dollar amount if given.`);
            return { symbol, valueUsd, assetType, details: { state, ...(balance > 0 ? { adjustableMortgage: balance } : {}), ...(/^(yes|true|y|1)$/i.test(rental) ? { rental: true } : {}) } };
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(maturity) || couponRate === '' || !Number.isFinite(Number(couponRate)))
            throw new Error(`${symbol}: a ${assetType} needs a maturity date (YYYY-MM-DD) and a yearly coupon rate.`);
        return { symbol, valueUsd, assetType, details: { maturity, couponRate: Number(couponRate) } };
    });
    if (!holdings.length || new Set(holdings.map(holding => holding.symbol)).size !== holdings.length)
        throw new Error('CSV must contain unique symbol,valueUsd rows with positive values.');
    return holdings;
}
