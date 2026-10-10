import type { TrackGrade, TrackRatingsResponse, TrackRatingItem, TrackSort } from '../../../shared/types.ts';
import { FORECAST_HORIZONS } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { historicalRating } from '../math/historical-rating.ts';
import type { RatingObservation } from '../math/historical-rating.ts';
import { HISTORY_SUBJECTS, SP500_BENCHMARK_SERIES, subjectSeries } from './history-subjects.ts';
import { historyLinks, themeLinks } from './history-links.ts';
import { getHoldings } from './holdings.ts';
// Where each timeframe's history is kept. At 24 hours it is the track record itself: the quote
// standing a day before close, in settled_markets (see AGENTS.md, "Track record"). The other
// timeframes have their own observations. `known` marks a quote published at or after a verified
// release of the result, which is not a forecast. A market noted as unscored counts as such only
// while the record holds no reading for it.
const HISTORY = {
    day: { rows: `SELECT s.series_ticker,COALESCE(s.event_ticker,s.ticker) event,s.prob_24h_before probability,s.outcome,s.loaded_at,(r.released_at IS NOT NULL AND r.released_at<=s.odds_time) known
            FROM settled_markets s LEFT JOIN event_releases r ON r.event_ticker=s.event_ticker WHERE s.series_ticker IS NOT NULL`,
        skips: `SELECT k.series_ticker,k.reason FROM backfill_skips k WHERE k.horizon_hours=$1 AND NOT EXISTS(SELECT 1 FROM settled_markets s WHERE s.ticker=k.ticker)` },
    other: { rows: `SELECT s.series_ticker,COALESCE(s.event_ticker,s.ticker) event,(s.yes_bid+s.yes_ask)/2 probability,s.outcome,s.loaded_at,(r.released_at IS NOT NULL AND r.released_at<=s.odds_time) known
            FROM forecast_observations s LEFT JOIN event_releases r ON r.event_ticker=s.event_ticker WHERE s.horizon_hours=$1`,
        skips: `SELECT k.series_ticker,k.reason FROM backfill_skips k WHERE k.horizon_hours=$1 AND NOT EXISTS(SELECT 1 FROM forecast_observations s WHERE s.ticker=k.ticker AND s.horizon_hours=k.horizon_hours)` },
};
// `view` orders the records and narrows them: by grade, or to those with any scored question.
export async function trackRatings(session:string,horizonHours=24,page=1,search='',fundPage=1,view:{sort?:TrackSort;grade?:TrackGrade|'';scored?:boolean}={}):Promise<TrackRatingsResponse> {
    if(!FORECAST_HORIZONS.some(h=>h.hours===horizonHours))throw new Error('Unsupported forecast horizon');
    const history=horizonHours===24?HISTORY.day:HISTORY.other;
    const [tags,entities,rows,skips,portfolio]=await Promise.all([
        query<{series_ticker:string;tag:string}>('SELECT series_ticker,tag FROM series_tags WHERE reviewed=true'),
        // track_entities names every ticker Kalshi has markets on; a holding it has not reached yet is named from its Yahoo profile.
        query<{symbol:string;name:string;kind:string}>(`SELECT symbol,name,kind FROM track_entities UNION ALL
            SELECT p.symbol,p.name,CASE p.quote_type WHEN 'EQUITY' THEN 'company' WHEN 'INDEX' THEN 'index' ELSE 'fund' END FROM security_profiles p
            WHERE p.name IS NOT NULL AND p.quote_type IN ('EQUITY','ETF','MUTUALFUND','INDEX') AND NOT EXISTS(SELECT 1 FROM track_entities e WHERE e.symbol=p.symbol) ORDER BY symbol`),
        query<{series_ticker:string;event:string;probability:number|string;outcome:number;loaded_at:Date;known:boolean}>(history.rows,horizonHours===24?[]:[horizonHours]),
        query<{series_ticker:string;reason:string}>(history.skips,[horizonHours]),
        getHoldings(session),
    ]);
    const observed=new Map<string,RatingObservation[]>();
    const note=(series:string,observation:RatingObservation)=>{const list=observed.get(series);if(list)list.push(observation);else observed.set(series,[observation]);};
    for(const r of rows)note(r.series_ticker,{event:r.event,probability:Number(r.probability),outcome:r.outcome,status:r.known?'outcome_known':'quoted'});
    for(const k of skips)note(k.series_ticker,{event:'',probability:null,outcome:0,status:k.reason==='no_quote'?'missing':'outcome_known'});
    const links=await historyLinks(session,tags);
    const positions=new Map(portfolio.holdings.map(h=>[h.symbol,h]));
    const total=portfolio.holdings.reduce((sum,h)=>sum+(Number.isFinite(h.valueUsd)?h.valueUsd:0),0);
    const enrich=(items:TrackRatingItem['linkedHoldings']):TrackRatingItem['linkedHoldings']=>items.map(h=>{
        const position=positions.get(h.symbol),value=position&&Number.isFinite(position.valueUsd)?position.valueUsd:null;
        return {...h,name:entities.find(e=>e.symbol===h.symbol)?.name??null,valueUsd:value,share:value!==null&&total>0?value/total:null};
    });
    const companies=entities.filter(e=>e.kind==='company');
    const companySymbols=new Set(companies.map(e=>e.symbol));
    const summarize=(series:string[])=>historicalRating([...new Set(series)].flatMap(s=>observed.get(s)??[]));
    const themes:TrackRatingItem[]=HISTORY_SUBJECTS.slice(0,6).map(s=>{
        const series=s.id==='companies'?[...new Set(tags.filter(t=>companySymbols.has(t.tag)).map(t=>t.series_ticker))]:subjectSeries(s.id,tags);
        return {id:s.id,name:s.id==='companies'?'Direct company markets':s.title,rating:summarize(series),linkedHoldings:enrich(themeLinks(series,links))};
    });
    const dataFirst=(a:TrackRatingItem,b:TrackRatingItem)=>b.rating.evaluated-a.rating.evaluated||a.name.localeCompare(b.name);
    themes.sort(dataFirst);
    // A record with no percentage goes last whichever way accuracy is ordered.
    const byAccuracy=(direction:1|-1)=>(a:TrackRatingItem,b:TrackRatingItem)=>(a.rating.accuracy===null?1:0)-(b.rating.accuracy===null?1:0)||direction*((a.rating.accuracy??0)-(b.rating.accuracy??0))||dataFirst(a,b);
    const order=view.sort==='name'?(a:TrackRatingItem,b:TrackRatingItem)=>a.name.localeCompare(b.name)||dataFirst(a,b):view.sort==='accuracy-high'?byAccuracy(-1):view.sort==='accuracy-low'?byAccuracy(1):dataFirst;
    const kept=(item:TrackRatingItem)=>(!view.scored||item.rating.evaluated>0)&&(!view.grade||(view.grade==='none'?item.rating.grade===null:item.rating.grade===view.grade));
    const arrange=(items:TrackRatingItem[])=>items.filter(kept).sort(order);
    const heldSymbols=new Set(portfolio.holdings.filter(h=>!h.assetType||h.assetType==='security').map(h=>h.symbol));
    const term=search.trim().toLowerCase();
    const allCompanies=companies.flatMap(e=>{
        const series=[...new Set(tags.filter(t=>t.tag===e.symbol).map(t=>t.series_ticker))];
        const ownLinks=themeLinks(series,links);
        // Include verified company holdings even without a direct-company historical series.
        if(term?!e.symbol.toLowerCase().includes(term)&&!e.name.toLowerCase().includes(term):!heldSymbols.has(e.symbol)&&!ownLinks.length)return [];
        return [{id:e.symbol,symbol:e.symbol,name:e.name,rating:summarize(series),kind:'company' as const,linkedHoldings:enrich(ownLinks),relatedThemes:themes.filter(t=>t.id!=='companies'&&t.linkedHoldings.some(h=>h.symbol===e.symbol)).map(t=>t.name)}];
    });
    const shownCompanies=arrange(allCompanies);
    // Public benchmark record; SPY's individual constituents are never expanded.
    const allFunds:TrackRatingItem[]=[{id:'sp500',name:'S&P 500',kind:'benchmark',scope:'S&P 500 index-level predictions · benchmark tracked by SPY',rating:summarize(SP500_BENCHMARK_SERIES),
        linkedHoldings:enrich(portfolio.holdings.filter(h=>h.symbol==='SPY').map(h=>({symbol:h.symbol,type:'Related' as const,evidence:'SPY tracks the S&P 500. This record evaluates index outcomes; it is not a separate forecast record for SPY share prices.'})))}];
    for(const e of entities.filter(e=>e.kind!=='company'&&heldSymbols.has(e.symbol)&&e.symbol!=='SPY')) {
        const own=tags.filter(t=>t.tag===e.symbol).map(t=>t.series_ticker);
        allFunds.push({id:e.symbol,symbol:e.symbol,name:e.name,kind:'fund',scope:own.length?'Questions directly about this fund or index':'No verified fund-specific or benchmark history mapped yet',rating:summarize(own),linkedHoldings:enrich([{symbol:e.symbol,type:'Related',evidence:'This fund is a saved portfolio holding. Broad interest-rate or inflation questions are not substituted for forecasts of this fund.'}])});
    }
    const shownFunds=arrange(allFunds);
    const pageSize=10,totalCompanies=shownCompanies.length,safePage=Math.max(1,Math.min(page,Math.max(1,Math.ceil(totalCompanies/pageSize))));
    const safeFundPage=Math.max(1,Math.min(fundPage,Math.max(1,Math.ceil(shownFunds.length/pageSize))));
    const asOf=iso(rows.reduce<Date|null>((latest,r)=>!latest||r.loaded_at>latest?r.loaded_at:latest,null));
    return {asOf,horizonHours,themes:arrange(themes),funds:shownFunds.slice((safeFundPage-1)*pageSize,safeFundPage*pageSize),fundPage:safeFundPage,totalFunds:shownFunds.length,companies:shownCompanies.slice((safePage-1)*pageSize,safePage*pageSize),page:safePage,pageSize,totalCompanies,
        fundSymbols:portfolio.holdings.filter(h=>entities.some(e=>e.symbol===h.symbol&&e.kind!=='company')).map(h=>h.symbol)};
}
