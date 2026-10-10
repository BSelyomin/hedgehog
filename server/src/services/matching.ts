import type { DriverRank, Holding, HoldingLink, Sensitivity } from '../../../shared/types.ts';
import { DRIVERS, MATERIAL_SHARE, driverFor } from '../config/drivers.ts';
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
// A holding's reliable measurements that are big enough to draw a link from. A daily driver
// counts when its typical effect is at least MATERIAL_SHARE of the holding's biggest. A weekly
// driver is measured on another scale, so it counts when a daily driver of its family does: a
// mortgage-rate link needs the holding to be tied to interest rates day to day. A row whose size
// is unknown, or a holding with nothing daily to compare against, is left in.
export function materialRows(symbol: string, measurements: MeasuredRow[]): MeasuredRow[] {
    const own = measurements.filter(m => m.symbol === symbol && reliableRow(m));
    const ranked = rankDrivers(symbol, measurements), top = ranked[0]?.typicalEffect;
    if (top === undefined)
        return own;
    const big = new Set(ranked.filter(r => r.typicalEffect >= MATERIAL_SHARE * top).map(r => r.driver));
    const families = new Set([...big].map(driver => driverFor(driver)?.family));
    return own.filter(m => effect(m) === null || (driverFor(m.driver)?.period === 'day' ? big.has(m.driver) : families.has(driverFor(m.driver)?.family)));
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
    const reliable = measurements.filter(m => m.symbol === holding.symbol && shared.some(t => drivers[t] === m.driver) && reliableRow(m))
        .sort((a, b) => (effect(b) ?? 0) - (effect(a) ?? 0));
    const material = materialRows(holding.symbol, measurements), measured = reliable.find(m => material.includes(m));
    if (measured) {
        const sensitivity: Sensitivity = { b: measured.b, low: measured.b - 1.96 * measured.se, high: measured.b + 1.96 * measured.se, days: measured.days, driver: measured.driver, computedAt: measured.computed_at.toISOString(), typicalEffect: effect(measured) };
        return { ...holding, type: 'Measured', sensitivity, lead: rankDrivers(holding.symbol, measurements)[0] ?? null, evidence: `Measured ${driverFor(measured.driver)?.period === 'week' ? 'weekly' : 'daily'} returns against ${measured.driver}${measured.driver === 'SPY' ? '' : ' with SPY as a control'}. Historical association with the driver; not an event-outcome forecast.` };
    }
    // Reliable but faint: say so, with how it compares, and draw no link from it.
    const faint = reliable[0], lead = rankDrivers(holding.symbol, measurements)[0];
    if (faint && lead) {
        const size = effect(faint), daily = driverFor(faint.driver)?.period === 'day';
        const why = daily && size !== null ? `a typical move in it moves ${holding.symbol} about ${Math.round(size / lead.typicalEffect * 100)}% as much as a typical move in ${lead.driver}`
            : `${holding.symbol} has no sizeable link to that kind of driver day to day; ${lead.driver} matters most to it`;
        return { ...holding, type: 'Related', lead, sensitivity: null, evidence: `Measured against ${faint.driver}, but small: ${why}. Under the ${MATERIAL_SHARE * 100}% floor for a link, so no move estimate is shown.` };
    }
    return { ...holding, type: 'Related', evidence: `Shared reviewed tags: ${shared.join(', ')}. No reliable sensitivity; no move estimate shown.`, sensitivity: null };
}
export const linkRank = { Direct: 0, Calculated: 1, Measured: 2, Related: 3 };
