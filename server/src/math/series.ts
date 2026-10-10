export interface PricePoint {
    date: string;
    close: number;
}
// Align price endpoints BEFORE taking returns. Never match returns covering different dates.
export function alignedChanges(series: PricePoint[][], yieldIndices: number[] = []) {
    const maps = series.map(rows => new Map(rows.filter(r => Number.isFinite(r.close)).map(r => [r.date, r.close])));
    const dates = [...maps[0].keys()].filter(d => maps.every(m => m.has(d))).sort();
    const rows: number[][] = [];
    const endDates: string[] = [];
    for (let i = 1; i < dates.length; i++) {
        // A return needs a positive price at both ends. Crude futures closed below zero on
        // 2020-04-20; a "return" into or out of that close is not a percentage move.
        const values = maps.map((m, j) => { const current = m.get(dates[i])!, previous = m.get(dates[i - 1])!; return yieldIndices.includes(j) ? current - previous : previous > 0 && current > 0 ? current / previous - 1 : NaN; });
        if (values.every(Number.isFinite)) {
            rows.push(values);
            endDates.push(dates[i]);
        }
    }
    return { dates: endDates, columns: series.map((_, j) => rows.map(row => row[j])) };
}
// Sample standard deviation: the size of a typical period's change.
export function standardDeviation(values: number[]) {
    if (values.length < 2 || values.some(v => !Number.isFinite(v)))
        throw new Error('Invalid series');
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}
// How far a holding typically moves with a driver: |b| times the driver's typical change.
// Unlike b, this is in the holding's own return units, so drivers can be compared with each other.
export function typicalEffect(b: number, driverChanges: number[]) {
    return Math.abs(b) * standardDeviation(driverChanges);
}
