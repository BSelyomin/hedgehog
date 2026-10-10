import { query } from '../db.ts';
import { estimateSensitivity, checkSensitivity } from '../math/index.ts';
import { alignedChanges, typicalEffect } from '../math/series.ts';
import type { PricePoint } from '../math/series.ts';
import { drivers } from '../services/matching.ts';
import { CONTROL, DRIVERS, MIN_TYPICAL_EFFECT } from '../config/drivers.ts';
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
// One holding against one driver. Regressions use the periods both series share, so a weekly
// driver is measured on weekly changes. Throws when the pair cannot be measured.
export function measureLink(symbol: string, driver: string, yieldChange: boolean, stock: PricePoint[], source: PricePoint[], control: PricePoint[]) {
    // Holding the market fixed leaves nothing to explain when the holding is the market.
    if (symbol === CONTROL && driver !== CONTROL)
        throw new Error('Holding is the control series');
    const data = alignedChanges(driver === CONTROL ? [stock, source] : [stock, source, control], yieldChange ? [1] : []);
    const { b, se } = estimateSensitivity(data.columns[0], data.columns[1], data.columns[2]);
    const checked = checkSensitivity(b, se, data.dates.length);
    const effect = typicalEffect(b, data.columns[1]);
    return { ...checked, se, effect, reliable: checked.reliable && effect >= MIN_TYPICAL_EFFECT };
}
export async function measure() {
    const symbols = await query<{
        symbol: string;
    }>("SELECT DISTINCT symbol FROM holdings WHERE asset_type='security'");
    const control = await loadSeries(CONTROL);
    for (const { symbol } of symbols)
        for (const driver of DRIVERS) {
            try {
                const own = driver.key === CONTROL;
                const stock = await loadSeries(symbol, own ? 5 : 10);
                const source = own ? await loadSeries(CONTROL, 5) : await loadSeries(driver.key);
                const link = measureLink(symbol, driver.key, driver.change === 'difference', stock, source, control);
                await query(`INSERT INTO measured_links(symbol,driver,b,se,low,high,days,reliable,computed_at,effect) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT(symbol,driver) DO UPDATE SET b=excluded.b,se=excluded.se,low=excluded.low,high=excluded.high,days=excluded.days,reliable=excluded.reliable,computed_at=excluded.computed_at,effect=excluded.effect`, [symbol, driver.key, link.b, link.se, link.low, link.high, link.days, link.reliable, link.effect]);
                await syncMeasuredTags(symbol, driver.key, link.reliable);
            }
            catch {
                await query('DELETE FROM measured_links WHERE symbol=$1 AND driver=$2', [symbol, driver.key]);
                await syncMeasuredTags(symbol, driver.key, false);
                console.warn('Insufficient aligned history', symbol, driver.key);
            }
        }
}
