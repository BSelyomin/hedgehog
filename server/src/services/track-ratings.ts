import type { TrackRatingsResponse, TrackRatingItem } from '../../../shared/types.ts';
import { FORECAST_HORIZONS } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { historicalRating } from '../math/historical-rating.ts';
import { HISTORY_SUBJECTS, subjectSeries } from './history-subjects.ts';
import { historyLinks, themeLinks } from './history-links.ts';
import { getHoldings } from './holdings.ts';
export async function trackRatings(session:string,horizonHours=24,page=1,search=''):Promise<TrackRatingsResponse> {
    if(!FORECAST_HORIZONS.some(h=>h.hours===horizonHours))throw new Error('Unsupported forecast horizon');
    const [tags,entities,rows,portfolio]=await Promise.all([
        query<{series_ticker:string;tag:string}>('SELECT series_ticker,tag FROM series_tags WHERE reviewed=true'),
        query<{symbol:string;name:string;kind:string}>('SELECT symbol,name,kind FROM track_entities ORDER BY symbol'),
        query<{series_ticker:string;event:string;bid:string|null;ask:string|null;outcome:number;status:string;fetched_at:Date}>(`SELECT m.series_ticker,m.event_ticker event,q.yes_bid bid,q.yes_ask ask,m.outcome,q.status,q.fetched_at FROM track_markets m JOIN track_quotes q ON q.market_id=m.id WHERE q.horizon_hours=$1`,[horizonHours]),
        getHoldings(session),
    ]);
    const links=await historyLinks(session,tags);
    const companies=entities.filter(e=>e.kind==='company');
    const companySymbols=new Set(companies.map(e=>e.symbol));
    const summarize=(series:string[])=>historicalRating(rows.filter(r=>series.includes(r.series_ticker)).map(r=>({...r,bid:r.bid===null?null:Number(r.bid),ask:r.ask===null?null:Number(r.ask)})));
    const themes:TrackRatingItem[]=HISTORY_SUBJECTS.slice(0,6).map(s=>{
        const series=s.id==='companies'?[...new Set(tags.filter(t=>companySymbols.has(t.tag)).map(t=>t.series_ticker))]:subjectSeries(s.id,tags);
        return {id:s.id,name:s.id==='companies'?'Direct company markets':s.title,rating:summarize(series),linkedHoldings:themeLinks(series,links)};
    });
    const term=search.trim().toLowerCase();
    const allCompanies=companies.flatMap(e=>{
        const series=[...new Set(tags.filter(t=>t.tag===e.symbol).map(t=>t.series_ticker))];
        const ownLinks=themeLinks(series,links);
        // Default is companies with a reviewed direct-company series linked to this portfolio.
        if(term?!e.symbol.toLowerCase().includes(term)&&!e.name.toLowerCase().includes(term):!ownLinks.length)return [];
        return [{id:e.symbol,symbol:e.symbol,name:e.name,rating:summarize(series),linkedHoldings:ownLinks}];
    });
    const pageSize=10,totalCompanies=allCompanies.length,safePage=Math.max(1,Math.min(page,Math.max(1,Math.ceil(totalCompanies/pageSize))));
    const asOf=rows.length?iso(new Date(Math.max(...rows.map(r=>r.fetched_at.getTime())))):null;
    return {asOf,horizonHours,themes,companies:allCompanies.slice((safePage-1)*pageSize,safePage*pageSize),page:safePage,pageSize,totalCompanies,
        fundSymbols:portfolio.holdings.filter(h=>entities.some(e=>e.symbol===h.symbol&&e.kind!=='company')).map(h=>h.symbol)};
}
