import type { Holding, HoldingLink, Sensitivity } from '../../../shared/types.ts';
export const drivers: Record<string, string> = { 'oil': 'CL=F', 'fed-rates': 'DGS2', 'inflation': 'DGS2', 'sp500': 'SPY' };
export interface MeasuredRow {
    symbol: string;
    driver: string;
    b: number;
    se: number;
    low: number;
    high: number;
    days: number;
    reliable: boolean;
    computed_at: Date;
}
export function matchHolding(holding: Holding, eventTags: string[], stockTags: string[], measurements: MeasuredRow[]): HoldingLink | null {
    if (eventTags.includes(holding.symbol))
        return { ...holding, type: 'Direct', evidence: 'Reviewed company tag: a Kalshi market about this ticker.', sensitivity: null };
    const shared = eventTags.filter(t => stockTags.includes(t));
    if (!shared.length)
        return null;
    const measured = measurements.find(m => m.symbol === holding.symbol && shared.some(t => drivers[t] === m.driver) && m.reliable && m.days >= 60 && Number.isFinite(m.b) && Number.isFinite(m.se) && m.se >= 0 && (m.b - 1.96 * m.se > 0 || m.b + 1.96 * m.se < 0));
    if (measured) {
        const sensitivity: Sensitivity = { b: measured.b, low: measured.b - 1.96 * measured.se, high: measured.b + 1.96 * measured.se, days: measured.days, driver: measured.driver, computedAt: measured.computed_at.toISOString() };
        return { ...holding, type: 'Measured', sensitivity, evidence: `Measured daily returns against ${measured.driver}${measured.driver === 'SPY' ? '' : ' with SPY as a control'}. Historical association with the driver; not an event-outcome forecast.` };
    }
    return { ...holding, type: 'Related', evidence: `Shared reviewed tags: ${shared.join(', ')}. No reliable sensitivity; no move estimate shown.`, sensitivity: null };
}
export const linkRank = { Direct: 0, Measured: 1, Related: 2 };
