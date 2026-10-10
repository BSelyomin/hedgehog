import YahooFinance from 'yahoo-finance2';
import { query } from '../db.ts';
import { seedFile } from '../seed.ts';
import { storePrices } from './price-storage.ts';
export const yahoo = new YahooFinance();
export async function prices() {
    const symbols = new Set([...(await seedFile<string[]>('demo_symbols')), ...(await query<{
            symbol: string;
        }>('SELECT DISTINCT symbol FROM portfolio_holdings')).map(r => r.symbol), 'SPY', 'CL=F']);
    const start = new Date();
    start.setUTCFullYear(start.getUTCFullYear() - 10);
    for (const symbol of symbols) {
        try {
            const history = await yahoo.chart(symbol, { period1: start, interval: '1d' });
            const rows = history.quotes.flatMap(row => typeof row.close === 'number' && Number.isFinite(row.close)
                ? [{ date: row.date.toISOString().slice(0, 10), close: row.close }] : []);
            await storePrices(symbol, rows);
            console.log('Price history loaded', symbol, rows.length);
        }
        catch {
            console.warn('Price load failed for symbol', symbol);
        }
    }
    if (!process.env.FRED_API_KEY) {
        console.warn('FRED_API_KEY missing; DGS2 unavailable');
        return;
    }
    const url = new URL('https://api.stlouisfed.org/fred/series/observations');
    url.search = new URLSearchParams({ series_id: 'DGS2', api_key: process.env.FRED_API_KEY, file_type: 'json', observation_start: start.toISOString().slice(0, 10) }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok)
        throw new Error('FRED load failed');
    const data = await response.json() as {
        observations: {
            date: string;
            value: string;
        }[];
    };
    await storePrices('DGS2', data.observations.flatMap(row => row.value !== '.' && Number.isFinite(Number(row.value))
        ? [{ date: row.date, close: Number(row.value) }] : []));
}
