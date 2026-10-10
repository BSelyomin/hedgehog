import type { TrackRatingsResponse, TrackRatingItem } from '../../../shared/types.ts';
import { FORECAST_HORIZONS } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { historicalRating } from '../math/historical-rating.ts';
import { HISTORY_SUBJECTS, subjectSeries } from './history-subjects.ts';
import { historyLinks, themeLinks } from './history-links.ts';
import { getHoldings } from './holdings.ts';
export async function trackRatings(session:string,horizonHours=24,page=1,search='',fundPage=1):Promise<TrackRatingsResponse> {
    if(!FORECAST_HORIZONS.some(h=>h.hours===horizonHours))throw new Error('Unsupported forecast horizon');
    const [tags,entities,rows,portfolio,benchmarks]=await Promise.all([
        query<{series_ticker:string;tag:string}>('SELECT series_ticker,tag FROM series_tags WHERE reviewed=true UNION SELECT series_ticker,symbol tag FROM track_company_series'),
        query<{symbol:string;name:string;kind:string}>('SELECT symbol,name,kind FROM track_entities ORDER BY symbol'),
        query<{series_ticker:string;event:string;bid:string|null;ask:string|null;outcome:number;status:string;fetched_at:Date}>(`SELECT m.series_ticker,m.event_ticker event,q.yes_bid bid,q.yes_ask ask,m.outcome,q.status,q.fetched_at FROM track_markets m JOIN track_quotes q ON q.market_id=m.id WHERE q.horizon_hours=$1`,[horizonHours]),
        getHoldings(session),
        query<{benchmark:string;series_ticker:string}>('SELECT benchmark,series_ticker FROM track_benchmark_series'),
    ]);
    const links=await historyLinks(session,tags);
    const positions=new Map(portfolio.holdings.map(h=>[h.symbol,h]));
    const total=portfolio.holdings.reduce((sum,h)=>sum+(Number.isFinite(h.valueUsd)?h.valueUsd:0),0);
    const enrich=(items:TrackRatingItem['linkedHoldings']):TrackRatingItem['linkedHoldings']=>items.map(h=>{
        const position=positions.get(h.symbol),value=position&&Number.isFinite(position.valueUsd)?position.valueUsd:null;
        return {...h,name:entities.find(e=>e.symbol===h.symbol)?.name??null,valueUsd:value,share:value!==null&&total>0?value/total:null};
    });
    const companies=entities.filter(e=>e.kind==='company');
    const companySymbols=new Set(companies.map(e=>e.symbol));
    const summarize=(series:string[])=>historicalRating(rows.filter(r=>series.includes(r.series_ticker)).map(r=>({...r,bid:r.bid===null?null:Number(r.bid),ask:r.ask===null?null:Number(r.ask)})));
    const themes:TrackRatingItem[]=HISTORY_SUBJECTS.slice(0,6).map(s=>{
        const series=s.id==='companies'?[...new Set(tags.filter(t=>companySymbols.has(t.tag)).map(t=>t.series_ticker))]:subjectSeries(s.id,tags);
        return {id:s.id,name:s.id==='companies'?'Direct company markets':s.title,rating:summarize(series),linkedHoldings:enrich(themeLinks(series,links))};
    });
    const dataFirst=(a:TrackRatingItem,b:TrackRatingItem)=>b.rating.evaluated-a.rating.evaluated||a.name.localeCompare(b.name);
    themes.sort(dataFirst);
    const heldSymbols=new Set(portfolio.holdings.filter(h=>!h.assetType||h.assetType==='security').map(h=>h.symbol));
    const term=search.trim().toLowerCase();
    const allCompanies=companies.flatMap(e=>{
        const series=[...new Set(tags.filter(t=>t.tag===e.symbol).map(t=>t.series_ticker))];
        const ownLinks=themeLinks(series,links);
        // Include verified company holdings even without a direct-company historical series.
        if(term?!e.symbol.toLowerCase().includes(term)&&!e.name.toLowerCase().includes(term):!heldSymbols.has(e.symbol)&&!ownLinks.length)return [];
        return [{id:e.symbol,symbol:e.symbol,name:e.name,rating:summarize(series),kind:'company' as const,linkedHoldings:enrich(ownLinks),relatedThemes:themes.filter(t=>t.id!=='companies'&&t.linkedHoldings.some(h=>h.symbol===e.symbol)).map(t=>t.name)}];
    });
    allCompanies.sort(dataFirst);
    const indexSeries=[...new Set(benchmarks.filter(b=>b.benchmark==='sp500').map(b=>b.series_ticker))];
    // Public benchmark record; SPY's individual constituents are never expanded.
    const allFunds:TrackRatingItem[]=[{id:'sp500',name:'S&P 500',kind:'benchmark',scope:'S&P 500 index-level predictions · benchmark tracked by SPY',rating:summarize(indexSeries),
        linkedHoldings:enrich(portfolio.holdings.filter(h=>h.symbol==='SPY').map(h=>({symbol:h.symbol,type:'Related' as const,evidence:'SPY tracks the S&P 500. This record evaluates index outcomes; it is not a separate forecast record for SPY share prices.'})))}];
    for(const e of entities.filter(e=>e.kind!=='company'&&heldSymbols.has(e.symbol)&&e.symbol!=='SPY')) {
        const own=tags.filter(t=>t.tag===e.symbol).map(t=>t.series_ticker);
        allFunds.push({id:e.symbol,symbol:e.symbol,name:e.name,kind:'fund',scope:own.length?'Questions directly about this fund or index':'No verified fund-specific or benchmark history mapped yet',rating:summarize(own),linkedHoldings:enrich([{symbol:e.symbol,type:'Related',evidence:'This fund is a saved portfolio holding. Broad interest-rate or inflation questions are not substituted for forecasts of this fund.'}])});
    }
    allFunds.sort(dataFirst);
    const pageSize=10,totalCompanies=allCompanies.length,safePage=Math.max(1,Math.min(page,Math.max(1,Math.ceil(totalCompanies/pageSize))));
    const safeFundPage=Math.max(1,Math.min(fundPage,Math.max(1,Math.ceil(allFunds.length/pageSize))));
    const asOf=rows.length?iso(new Date(Math.max(...rows.map(r=>r.fetched_at.getTime())))):null;
    return {asOf,horizonHours,themes,funds:allFunds.slice((safeFundPage-1)*pageSize,safeFundPage*pageSize),fundPage:safeFundPage,totalFunds:allFunds.length,companies:allCompanies.slice((safePage-1)*pageSize,safePage*pageSize),page:safePage,pageSize,totalCompanies,
        fundSymbols:portfolio.holdings.filter(h=>entities.some(e=>e.symbol===h.symbol&&e.kind!=='company')).map(h=>h.symbol)};
}
