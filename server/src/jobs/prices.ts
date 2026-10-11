import YahooFinance from 'yahoo-finance2';
import { query } from '../db.ts';
import { seedFile } from '../seed.ts';
import { storePrices } from './price-storage.ts';
import { completedPriceDate } from '../services/price-date.ts';
import { CONTROL, DRIVERS } from '../config/drivers.ts';
import { runWithoutRetry } from '../services/no-retry.ts';
export const yahoo = new YahooFinance();
export async function prices() {
    // Only listed securities have a price history; cash, bonds held directly and property do not.
    const symbols = new Set([CONTROL, ...(await seedFile<string[]>('demo_symbols')), ...(await query<{
            symbol: string;
        }>("SELECT DISTINCT symbol FROM portfolio_holdings WHERE asset_type='security'")).map(r => r.symbol), ...DRIVERS.filter(d => d.source === 'yahoo').map(d => d.key),
        ...DRIVERS.flatMap(d => d.levelReference ? [d.levelReference.symbol] : [])]);
    const start = new Date();
    start.setUTCFullYear(start.getUTCFullYear() - 10);
    const cutoff = completedPriceDate();
    const coverage = await query<{ symbol: string; first: Date; last: Date }>(
        'SELECT symbol,min(ts) AS first,max(ts) AS last FROM prices WHERE symbol=ANY($1::text[]) GROUP BY symbol', [[...symbols]]);
    for (const symbol of symbols) {
        try {
            const saved = coverage.find(row => row.symbol === symbol);
            // Bootstrap the full measurement window once. Subsequent runs refresh
            // the recent week, including provider corrections and the latest close.
            const period1 = saved && saved.first.getTime() <= start.getTime() + 45 * 86400000
                ? new Date(Math.max(start.getTime(), saved.last.getTime() - 7 * 86400000)) : start;
            const history = await runWithoutRetry(`prices:yahoo:${symbol}`, () => yahoo.chart(symbol, { period1, interval: '1d' }));
            if (!history) continue;
            const rows = history.quotes.flatMap(row => row.date.toISOString().slice(0, 10) <= cutoff && typeof row.close === 'number' && Number.isFinite(row.close)
                ? [{ date: row.date.toISOString().slice(0, 10), close: row.close }] : []);
            await storePrices(symbol, rows);
            console.log('Price history loaded', symbol, rows.length);
        }
        catch {
            console.warn('Price load failed for symbol', symbol);
        }
    }
    if (!process.env.FRED_API_KEY) {
        console.warn('FRED_API_KEY missing; yield series unavailable');
        return;
    }
    for (const driver of DRIVERS.filter(d => d.source === 'fred')) {
        try {
            const url = new URL('https://api.stlouisfed.org/fred/series/observations');
            url.search = new URLSearchParams({ series_id: driver.key, api_key: process.env.FRED_API_KEY, file_type: 'json', observation_start: start.toISOString().slice(0, 10) }).toString();
            const data = await runWithoutRetry(`prices:fred:${driver.key}`, async () => {
                const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
                if (!response.ok) throw new Error('FRED load failed');
                return await response.json() as {
                observations: {
                    date: string;
                    value: string;
                }[];
                };
            });
            if (!data) continue;
            const rows = data.observations.flatMap(row => row.date <= cutoff && row.value !== '.' && Number.isFinite(Number(row.value))
                ? [{ date: row.date, close: Number(row.value) }] : []);
            await storePrices(driver.key, rows);
            console.log('Yield history loaded', driver.key, rows.length);
        }
        catch {
            // One unavailable series must not stop the others or the measurements that follow.
            console.warn('FRED load failed for series', driver.key);
        }
    }
}
