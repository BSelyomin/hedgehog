import type { BrokerageActivity } from '../../../shared/types.ts';
import { BrokerageError } from './client.ts';
import { object } from './positions.ts';

function activityDate(value: unknown): string | null {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12)
        throw new BrokerageError('SnapTrade returned an invalid transaction number.');
    return value;
}
/** Activities are historical records. Their amount/price cannot stand in for current position value. */
export function convertSnapTradeActivities(input: unknown): {
    activities: BrokerageActivity[]; pagination: { offset: number; limit: number; total: number };
} {
    const response = object(input), pagination = object(response.pagination);
    if (!Array.isArray(response.data) || response.data.length > 1000)
        throw new BrokerageError('SnapTrade returned unexpected transaction data.');
    for (const field of ['offset', 'limit', 'total']) {
        if (typeof pagination[field] !== 'number' || !Number.isSafeInteger(pagination[field]) || (pagination[field] as number) < 0)
            throw new BrokerageError('SnapTrade returned invalid transaction pagination.');
    }
    const offset = pagination.offset as number, limit = pagination.limit as number, total = pagination.total as number;
    if (limit < 1 || limit > 1000 || response.data.length > limit || total < response.data.length)
        throw new BrokerageError('SnapTrade returned inconsistent transaction pagination.');
    const activities = response.data.map(value => {
        const row = object(value);
        if (typeof row.id !== 'string' || !row.id || typeof row.type !== 'string' || !row.type)
            throw new BrokerageError('SnapTrade returned a transaction without an identifier or type.');
        const symbol = row.symbol === null || row.symbol === undefined ? null : object(row.symbol);
        const currency = row.currency === null || row.currency === undefined ? null : object(row.currency);
        const code = currency && typeof currency.code === 'string' && /^[A-Z]{3}$/.test(currency.code) ? currency.code : null;
        return {
            id: row.id, type: row.type, symbol: symbol && typeof symbol.symbol === 'string' ? symbol.symbol : null,
            quantity: nullableNumber(row.units), price: nullableNumber(row.price), amount: nullableNumber(row.amount),
            currency: code, fee: nullableNumber(row.fee), tradeDate: activityDate(row.trade_date), settlementDate: activityDate(row.settlement_date),
            description: typeof row.description === 'string' ? row.description : null,
        };
    });
    return { activities, pagination: { offset, limit, total } };
}
