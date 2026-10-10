import type { DriverRank, Holding, HoldingLink, Sensitivity } from '../../../shared/types.ts';
import { DRIVERS, driverFor } from '../config/drivers.ts';
// Topic tag -> the series that measures it.
export const drivers: Record<string, string> = Object.fromEntries(DRIVERS.flatMap(driver => driver.tags.map(tag => [tag, driver.key])));
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
    /** |b| times the driver's typical change; null on rows measured before it was stored. */
    effect?: number | null;
}
export const reliableRow = (m: MeasuredRow) => m.reliable && m.days >= 60 && Number.isFinite(m.b) && Number.isFinite(m.se) && m.se >= 0 && (m.b - 1.96 * m.se > 0 || m.b + 1.96 * m.se < 0);
const effect = (m: MeasuredRow) => typeof m.effect === 'number' && Number.isFinite(m.effect) ? m.effect : null;
// A holding's reliable daily drivers, most important first. Importance is the typical daily effect,
// which is comparable across drivers; weekly drivers are measured on a different period and left out.
export function rankDrivers(symbol: string, measurements: MeasuredRow[]): DriverRank[] {
    return measurements.filter(m => m.symbol === symbol && reliableRow(m) && effect(m) !== null && driverFor(m.driver)?.period === 'day')
        .map(m => ({ driver: m.driver, typicalEffect: effect(m)! })).sort((a, b) => b.typicalEffect - a.typicalEffect);
}
// One row per driver family: the member that typically moves the holding most. The 2-year and
// 10-year yields usually move together, so on a day they diverge their two separately fitted
// estimates would otherwise be shown as opposing drivers of the same holding.
export function strongestPerFamily(rows: MeasuredRow[]): MeasuredRow[] {
    const kept = new Map<string, MeasuredRow>();
    for (const row of rows) {
        const family = driverFor(row.driver)?.family ?? row.driver, held = kept.get(family);
        if (!held || (effect(row) ?? 0) > (effect(held) ?? 0))
            kept.set(family, row);
    }
    return [...kept.values()];
}
export function matchHolding(holding: Holding, eventTags: string[], stockTags: string[], measurements: MeasuredRow[]): HoldingLink | null {
    if (eventTags.includes(holding.symbol))
        return { ...holding, type: 'Direct', evidence: 'Reviewed company tag: a Kalshi market about this ticker.', sensitivity: null };
    const shared = eventTags.filter(t => stockTags.includes(t));
    if (!shared.length)
        return null;
    // An event can carry tags for several drivers; show the one that moves this holding most.
    const measured = measurements.filter(m => m.symbol === holding.symbol && shared.some(t => drivers[t] === m.driver) && reliableRow(m))
        .sort((a, b) => (effect(b) ?? 0) - (effect(a) ?? 0))[0];
    if (measured) {
        const sensitivity: Sensitivity = { b: measured.b, low: measured.b - 1.96 * measured.se, high: measured.b + 1.96 * measured.se, days: measured.days, driver: measured.driver, computedAt: measured.computed_at.toISOString(), typicalEffect: effect(measured) };
        return { ...holding, type: 'Measured', sensitivity, lead: rankDrivers(holding.symbol, measurements)[0] ?? null, evidence: `Measured ${driverFor(measured.driver)?.period === 'week' ? 'weekly' : 'daily'} returns against ${measured.driver}${measured.driver === 'SPY' ? '' : ' with SPY as a control'}. Historical association with the driver; not an event-outcome forecast.` };
    }
    return { ...holding, type: 'Related', evidence: `Shared reviewed tags: ${shared.join(', ')}. No reliable sensitivity; no move estimate shown.`, sensitivity: null };
}
export const linkRank = { Direct: 0, Calculated: 1, Measured: 2, Related: 3 };
