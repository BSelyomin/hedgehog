import {query} from '../db.ts';
import {kalshi,KALSHI_BASE} from '../services/kalshi.ts';
interface Series {ticker:string;title:string;category:string;settlement_sources?:{name:string;url:string}[]}
// Reviewed index-price questions across daily, weekly, monthly and yearly series.
// Hourly-duration and constituent-membership markets are excluded.
const SP500_SERIES=new Set(['KXINX','KXINXU','KXINXAB','KXINXW','KXINXM','KXINXY']);
export function sp500Series(s:Series) {
    return SP500_SERIES.has(s.ticker)&&s.category==='Financials'&&/^S&P\s*500\s+(range|above\/below|close above\/below|yearly range)$/i.test(s.title)&&
        Array.isArray(s.settlement_sources)&&s.settlement_sources.some(source=>typeof source.url==='string'&&source.url.startsWith('https://www.google.com/finance/quote/.INX:INDEXSP'));
}
export async function trackFunds() {
    const catalog=await kalshi<{series:Series[]}>('/series');
    if(!Array.isArray(catalog.series))throw new Error('Invalid Kalshi series catalog');
    let mapped=0;
    for(const s of catalog.series.filter(sp500Series)) {
        await query(`INSERT INTO track_benchmark_series(benchmark,series_ticker,title,source_url,evidence) VALUES($1,$2,$3,$4,$5)
            ON CONFLICT(series_ticker) DO UPDATE SET title=excluded.title,source_url=excluded.source_url,evidence=excluded.evidence,verified_at=now()`,
            ['sp500',s.ticker,s.title,`${KALSHI_BASE}/series/${s.ticker}`,`Kalshi ${s.title}; settlement source identifies the S&P 500 index (.INX:INDEXSP).`]);
        mapped++;
    }
    return {mapped};
}
