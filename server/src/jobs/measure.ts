import { query } from '../db.ts';
import { estimateSensitivity, checkSensitivity } from '../math/index.ts';
import { alignedChanges } from '../math/series.ts';
import type { PricePoint } from '../math/series.ts';
import { drivers } from '../services/matching.ts';
export async function syncMeasuredTags(symbol: string, driver: string, reliable: boolean) {
    const tags = Object.keys(drivers).filter(tag => drivers[tag] === driver);
    // Only remove links owned by this job; retain human/filing mappings.
    await query("DELETE FROM stock_tags WHERE symbol=$1 AND tag=ANY($2) AND link_type='measured'", [symbol, tags]);
    if (reliable)
        await query("INSERT INTO stock_tags(symbol,tag,link_type) SELECT $1,tag,'measured' FROM allowed_tags WHERE tag=ANY($2) ON CONFLICT DO NOTHING", [symbol, tags]);
}
export async function loadSeries(symbol: string, years = 10): Promise<PricePoint[]> { return (await query<{
    ts: Date;
    close: number;
}>(`SELECT ts,close FROM prices WHERE symbol=$1 AND ts>=now()-($2::text||' years')::interval ORDER BY ts`, [symbol, years])).map(r => ({ date: r.ts.toISOString().slice(0, 10), close: r.close })); }
export async function measure() {
    const symbols = await query<{
        symbol: string;
    }>('SELECT DISTINCT symbol FROM holdings');
    const spy = await loadSeries('SPY');
    for (const { symbol } of symbols)
        for (const driver of ['CL=F', 'DGS2', 'SPY']) {
            try {
                const stock = await loadSeries(symbol, driver === 'SPY' ? 5 : 10);
                const source = driver === 'SPY' ? await loadSeries('SPY', 5) : await loadSeries(driver);
                const data = alignedChanges(driver === 'SPY' ? [stock, source] : [stock, source, spy], driver === 'DGS2' ? [1] : []);
                const { b, se } = estimateSensitivity(data.columns[0], data.columns[1], data.columns[2]);
                const checked = checkSensitivity(b, se, data.dates.length);
                await query(`INSERT INTO measured_links VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(symbol,driver) DO UPDATE SET b=excluded.b,se=excluded.se,low=excluded.low,high=excluded.high,days=excluded.days,reliable=excluded.reliable,computed_at=excluded.computed_at`, [symbol, driver, b, se, checked.low, checked.high, checked.days, checked.reliable]);
                await syncMeasuredTags(symbol, driver, checked.reliable);
            }
            catch {
                await query('DELETE FROM measured_links WHERE symbol=$1 AND driver=$2', [symbol, driver]);
                await syncMeasuredTags(symbol, driver, false);
                console.warn('Insufficient aligned history', symbol, driver);
            }
        }
}
