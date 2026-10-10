import type {HoldingsHistoryResponse,HoldingEventHistory,HoldingLink} from '../../../shared/types.ts';
import {query,iso} from '../db.ts';
import {seedFile} from '../seed.ts';
import {getHoldings} from './holdings.ts';
import {matchHolding,linkRank} from './matching.ts';
import type {MeasuredRow} from './matching.ts';
import {HISTORY_SUBJECTS,subjectSeries} from './history-subjects.ts';
import {releaseWindow,observedMove} from '../math/event-window.ts';
import type {PricePoint} from '../math/series.ts';
interface HistoryRow {
    ticker:string;event_ticker:string;series_ticker:string;title:string|null;
    prob_24h_before:number;outcome:number;odds_time:Date;close_time:Date;loaded_at:Date;
    event_title:string|null;released_at:Date|null;source_url:string|null;
}
// Counts what happened and names the largest miss. Quotes taken at or after the release are not forecasts, so they never count as a miss.
export function summarizeOutcome(contracts:{title:string;probability:number;outcome:number}[],before:(boolean|null)[]):HoldingEventHistory['outcome'] {
    const usable=contracts.filter((_,i)=>before[i]!==false);
    const worst=usable.reduce<typeof usable[number]|null>((w,c)=>!w||Math.abs(c.probability-c.outcome)>Math.abs(w.probability-w.outcome)?c:w,null);
    return {contracts:contracts.length,yes:contracts.filter(c=>c.outcome===1).length,biggestMiss:worst&&Math.abs(worst.probability-worst.outcome)>=.5?worst:null};
}
export async function holdingsHistory(session:string,subject='all',symbol?:string):Promise<HoldingsHistoryResponse> {
    const saved=await getHoldings(session),symbols=saved.holdings.map(h=>h.symbol);
    const empty:HoldingsHistoryResponse={holdings:symbols,totalLinkedEvents:0,displayedEvents:0,comparableEvents:0,currentHoldings:true,events:[],asOf:null};
    const holdings=symbol?saved.holdings.filter(h=>h.symbol===symbol):saved.holdings;
    if(!holdings.length) return empty;
    const tags=await query<{series_ticker:string;tag:string}>('SELECT series_ticker,tag FROM series_tags WHERE reviewed=true');
    const stockTags=await query<{symbol:string;tag:string}>('SELECT symbol,tag FROM stock_tags WHERE symbol=ANY($1)',[holdings.map(h=>h.symbol)]);
    const measurements=await query<MeasuredRow>('SELECT * FROM measured_links WHERE symbol=ANY($1)',[holdings.map(h=>h.symbol)]);
    const allowed=subject==='all'?null:subjectSeries(subject,tags);
    const links=new Map<string,HoldingLink[]>();
    for(const series of new Set(tags.map(t=>t.series_ticker))) {
        if(allowed&&!allowed.includes(series)) continue;
        const eventTags=tags.filter(t=>t.series_ticker===series).map(t=>t.tag);
        const matched=holdings.map(h=>matchHolding(h,eventTags,stockTags.filter(t=>t.symbol===h.symbol).map(t=>t.tag),measurements)).filter((l):l is HoldingLink=>l!==null);
        if(matched.length) links.set(series,matched);
    }
    if(!links.size) return empty;
    const series=[...links.keys()];
    const count=await query<{count:string}>('SELECT count(DISTINCT event_ticker) count FROM settled_markets WHERE series_ticker=ANY($1) AND event_ticker IS NOT NULL',[series]);
    const rows=await query<HistoryRow>(`SELECT s.*,COALESCE(s.title,m.title) title,COALESCE(r.title,e.title) event_title,r.released_at,r.source_url
        FROM settled_markets s LEFT JOIN markets m ON m.ticker=s.ticker LEFT JOIN events e ON e.ticker=s.event_ticker
        LEFT JOIN event_releases r ON r.event_ticker=s.event_ticker
        WHERE s.series_ticker=ANY($1) AND s.event_ticker IN
        (SELECT event_ticker FROM settled_markets WHERE series_ticker=ANY($1) AND event_ticker IS NOT NULL
            GROUP BY event_ticker ORDER BY (event_ticker IN (SELECT event_ticker FROM event_releases)) DESC,max(close_time) DESC,event_ticker LIMIT 12)
        ORDER BY (r.event_ticker IS NOT NULL) DESC,s.close_time DESC,s.event_ticker,s.ticker`,[series]);
    const released=rows.flatMap(r=>r.released_at?[r.released_at.toISOString().slice(0,10)]:[]).sort();
    const prices=released.length?await query<{symbol:string;ts:Date;close:number}>(`SELECT symbol,ts,close FROM prices
        WHERE symbol=ANY($1) AND ts>=$2::date-interval '7 days' AND ts<=$3::date ORDER BY ts`,[[...new Set([...holdings.map(h=>h.symbol),'SPY'])],released[0],released.at(-1)]):[];
    const points=(symbol:string):PricePoint[]=>prices.filter(p=>p.symbol===symbol).map(p=>({date:p.ts.toISOString().slice(0,10),close:p.close}));
    const supportedSymbols=new Set(await seedFile<string[]>('price_window_symbols'));
    const events:HoldingEventHistory[]=[];
    for(const event of new Set(rows.map(r=>r.event_ticker))) {
        const data=rows.filter(r=>r.event_ticker===event),first=data[0];
        const release=first.released_at&&first.source_url?{at:first.released_at.toISOString(),sourceUrl:first.source_url}:null;
        const window=release?releaseWindow(release.at,points('SPY')):null;
        const holdingMoves=(links.get(first.series_ticker)??[]).sort((a,b)=>linkRank[a.type]-linkRank[b.type]).map(l=>{
            const supported=supportedSymbols.has(l.symbol);
            const move=supported?observedMove(points(l.symbol),window):null;
            const spy=observedMove(points('SPY'),window);
            return {symbol:l.symbol,type:l.type,evidence:l.evidence,measuredAt:l.sensitivity?.computedAt??null,
                vsSpy:move&&spy?move.change-spy.change:null,
                moveNote:!supported?'U.S. close timing has not been verified for this symbol.':window&&!move?'A closing price is missing for the common comparison window.':null,move};
        });
        events.push({eventTicker:event,seriesTicker:first.series_ticker,title:first.event_title??event,
            subjects:HISTORY_SUBJECTS.filter(s=>subjectSeries(s.id,tags).includes(first.series_ticker)).map(s=>s.title),
            release,windowNote:!release?'Release time has not been verified. Market close time is not used as a substitute.':!window?'No supported, complete daily-close window for this release yet.':null,
            spyMove:observedMove(points('SPY'),window),
            predictions:data.map(r=>({ticker:r.ticker,title:r.title??r.ticker,probability:r.prob_24h_before,outcome:r.outcome,quoteAt:r.odds_time.toISOString(),closeAt:r.close_time.toISOString(),predatesRelease:release?r.odds_time.getTime()<Date.parse(release.at):null})),
            outcome:summarizeOutcome(data.map(r=>({title:r.title??r.ticker,probability:r.prob_24h_before,outcome:r.outcome})),data.map(r=>release?r.odds_time.getTime()<Date.parse(release.at):null)),
            holdings:holdingMoves});
    }
    return {...empty,totalLinkedEvents:Number(count[0]?.count??0),displayedEvents:events.length,events,comparableEvents:events.filter(e=>e.release&&e.spyMove&&e.holdings.some(h=>h.move)).length,asOf:iso(rows.reduce<Date|null>((latest,r)=>!latest||r.loaded_at>latest?r.loaded_at:latest,null))};
}
