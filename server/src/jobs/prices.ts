import YahooFinance from 'yahoo-finance2';
import { query } from '../db.ts';
import { seedFile } from '../seed.ts';
export const yahoo = new YahooFinance();
export async function prices() {
    const symbols = new Set([...(await seedFile<string[]>('demo_symbols')), ...(await query<{
            symbol: string;
        }>('SELECT DISTINCT symbol FROM holdings')).map(r => r.symbol), 'SPY', 'CL=F']);
    const start = new Date();
    start.setUTCFullYear(start.getUTCFullYear() - 10);
    for (const symbol of symbols) {
        try {
            const history = await yahoo.chart(symbol, { period1: start, interval: '1d' });
            for (const row of history.quotes)
                if (typeof row.close === 'number' && Number.isFinite(row.close))
                    await query(`INSERT INTO prices(ts,symbol,close) VALUES($1,$2,$3) ON CONFLICT(ts,symbol) DO UPDATE SET close=excluded.close,loaded_at=now()`, [row.date.toISOString().slice(0, 10), symbol, row.close]);
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
    for (const row of data.observations)
        if (row.value !== '.' && Number.isFinite(Number(row.value)))
            await query(`INSERT INTO prices(ts,symbol,close) VALUES($1,'DGS2',$2) ON CONFLICT(ts,symbol) DO UPDATE SET close=excluded.close,loaded_at=now()`, [row.date, Number(row.value)]);
}
