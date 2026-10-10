import type { BrokeragePosition, Holding } from '../../../shared/types.ts';
import { BrokerageError } from './client.ts';
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BrokerageError('SnapTrade returned unexpected data. Previous holdings were preserved.');
    return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))
        throw new BrokerageError('SnapTrade returned an invalid account identifier.');
    return value.toLowerCase();
}
export function timestamp(value: unknown): string | null {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 60_000 ? new Date(value).toISOString() : null;
}
// Exact decimal multiplication; round once to USD cents. Never use cost basis as value.
export function positionValue(units: string, price: string): number | null {
    function decimal(s: string) {
        if (!/^\d{1,18}(\.\d{1,12})?$/.test(s)) return null;
        const [whole, fraction = ''] = s.split('.');
        return { n: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
    }
    const a = decimal(units), b = decimal(price);
    if (!a || !b || a.n === 0n || b.n === 0n) return null;
    const scale = a.scale * b.scale;
    const cents = (a.n * b.n * 100n + scale / 2n) / scale;
    return cents > 0n && cents <= 100_000_000_000_000n ? Number(cents) / 100 : null;
}
/** Convert the documented V2 position response into Hedgehog's read-only position model. */
export function convertSnapTradePositions(input: unknown): { positions: BrokeragePosition[]; asOf: string | null } {
    const response = object(input);
    if (!Array.isArray(response.results) || response.results.length > 10_000) throw new BrokerageError('SnapTrade returned unexpected positions. Previous holdings were preserved.');
    const positions = response.results.map(value => {
        const row = object(value), instrument = object(row.instrument);
        const symbol = typeof instrument.raw_symbol === 'string' ? instrument.raw_symbol : '';
        const kind = typeof instrument.kind === 'string' ? instrument.kind : 'other';
        const units = typeof row.units === 'string' ? row.units : null;
        const price = typeof row.price === 'string' ? row.price : null;
        const currency = typeof row.currency === 'string' ? row.currency : null;
        let excludedReason: string | null = null;
        if (!['stock', 'etf', 'adr'].includes(kind) || row.cash_equivalent === true) excludedReason = 'Only stocks, ETFs and ADRs are supported; cash and other instruments are excluded.';
        else if (currency !== 'USD' || instrument.currency !== 'USD' || !['XNAS','XNYS','ARCX','BATS','IEXG','XASE','MEMX','EDGX','EDGA','BATY'].includes(String(instrument.exchange))) excludedReason = 'Only verified US listings priced in USD are supported; no FX conversion is applied.';
        else if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)) excludedReason = 'Ticker cannot be matched safely to US price history.';
        else if (!units || !price) excludedReason = 'Quantity or last known price is unavailable.';
        else if (units.startsWith('-')) excludedReason = 'Short positions are excluded from long-only exposure.';
        const valueUsd = excludedReason || !units || !price ? null : positionValue(units, price);
        if (!excludedReason && valueUsd === null) excludedReason = 'A positive USD value cannot be calculated from quantity and price.';
        return { symbol: symbol || 'Unavailable', kind, units, price, currency, valueUsd, excludedReason };
    });
    const freshness = response.data_freshness ? object(response.data_freshness) : {};
    return { positions, asOf: timestamp(freshness.as_of) };
}
export const parsePositions = convertSnapTradePositions;

/** Only supported positions become holdings; transaction cash flows never enter this calculation. */
export function positionsToHoldings(positions: BrokeragePosition[]): Holding[] {
    const cents = new Map<string, number>();
    for (const position of positions) {
        if (position.excludedReason || position.valueUsd === null) continue;
        const value = position.valueUsd;
        if (!Number.isFinite(value) || value <= 0 || value > 1e12 || !/^[A-Z][A-Z0-9.\-]{0,14}$/.test(position.symbol))
            throw new BrokerageError('A brokerage position cannot be converted safely into a holding.');
        const total = (cents.get(position.symbol) ?? 0) + Math.round(value * 100);
        if (!Number.isSafeInteger(total) || total > 1e14) throw new BrokerageError('Combined brokerage position value exceeds the supported range.');
        cents.set(position.symbol, total);
    }
    return [...cents].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, value]) => ({ symbol, valueUsd: value / 100 }));
}
