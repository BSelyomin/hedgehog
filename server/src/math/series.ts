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
        const values = maps.map((m, j) => { const current = m.get(dates[i])!, previous = m.get(dates[i - 1])!; return yieldIndices.includes(j) ? current - previous : previous > 0 ? current / previous - 1 : NaN; });
        if (values.every(Number.isFinite)) {
            rows.push(values);
            endDates.push(dates[i]);
        }
    }
    return { dates: endDates, columns: series.map((_, j) => rows.map(row => row[j])) };
}
