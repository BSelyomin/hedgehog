import {query} from '../db.ts';
import {kalshi,KALSHI_BASE} from '../services/kalshi.ts';
interface CompanySeries {ticker:string;title:string;category:string;settlement_sources?:{name:string;url:string}[]}
const normalized=(s:string)=>s.toLowerCase().replace(/\b(incorporated|corporation|inc|corp|holdings|group|company|co|the)\b/g,'').replace(/[^a-z0-9]/g,'');
export function companySeriesEvidence(s:CompanySeries,c:{symbol:string;name:string}):string|null {
    if(typeof s.ticker!=='string'||typeof s.title!=='string')return null;
    if(!['Financials','Companies','Mentions','Science and Technology','Economics'].includes(s.category))return null;
    // Exact symbol-specific earnings series, backed by an identified issuer source.
    const names=[normalized(c.name),...(c.symbol==='GOOGL'?['google']:[])].filter(n=>n.length>=4);
    const source=Array.isArray(s.settlement_sources)?s.settlement_sources.find(x=>x&&typeof x.name==='string'&&typeof x.url==='string'&&names.some(n=>normalized(x.name).startsWith(n))&&/^https?:\/\//.test(x.url)):undefined;
    const titleMatch=names.some(n=>n.length>=6&&normalized(s.title).includes(n));
    const titleSource=titleMatch&&Array.isArray(s.settlement_sources)?s.settlement_sources.find(x=>x&&typeof x.name==='string'&&typeof x.url==='string'&&/^https?:\/\//.test(x.url)):undefined;
    const verifiedSource=source??titleSource;
    if(!verifiedSource)return null;
    const explicit=s.ticker===`KXEARNINGSMENTION${c.symbol}`||names.some(n=>normalized(s.title).includes(n));
    return explicit?`Kalshi series: ${s.title}. Settlement source: ${verifiedSource.name} (${verifiedSource.url}).`:null;
}
export async function trackCompanies() {
    const companies=await query<{symbol:string;name:string}>(`SELECT DISTINCT e.symbol,e.name FROM track_entities e JOIN holdings h ON h.symbol=e.symbol WHERE e.kind='company' ORDER BY e.symbol`);
    if(!companies.length)return {mapped:0};
    const catalog=await kalshi<{series:CompanySeries[]}>('/series');
    if(!Array.isArray(catalog.series))throw new Error('Invalid Kalshi series catalog');
    let mapped=0;
    for(const s of catalog.series) {
        const matches=companies.flatMap(c=>{const evidence=companySeriesEvidence(s,c);return evidence?[{...c,evidence}]:[];});
        if(matches.length!==1)continue;
        const c=matches[0];
        await query(`INSERT INTO track_company_series(series_ticker,symbol,title,source_url,evidence) VALUES($1,$2,$3,$4,$5)
            ON CONFLICT(series_ticker) DO UPDATE SET symbol=excluded.symbol,title=excluded.title,source_url=excluded.source_url,evidence=excluded.evidence,verified_at=now()`,
            [s.ticker,c.symbol,s.title,`${KALSHI_BASE}/series/${encodeURIComponent(s.ticker)}`,c.evidence]);
        mapped++;
    }
    return {mapped};
}
