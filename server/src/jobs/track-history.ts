import { query } from '../db.ts';
import { kalshi } from '../services/kalshi.ts';
import type { KalshiMarket } from '../services/kalshi.ts';
import { loadCandles, oddsBeforeClose, outcomeAlreadyKnown } from './backfill.ts';
import { FORECAST_HORIZONS } from '../../../shared/types.ts';
import { yahoo } from './prices.ts';

export function finalBinary(m:KalshiMarket,now=Date.now()) {
    return !m.mve_collection_ticker&&!m.mve_selected_legs?.length&&m.status==='finalized' && m.is_provisional!==true && (!m.market_type||m.market_type==='binary') &&
        (m.result==='yes'||m.result==='no') && Boolean(m.event_ticker) && Number.isFinite(Date.parse(m.close_time)) && Date.parse(m.close_time)<=now &&
        Boolean(m.settlement_ts)&&Number.isFinite(Date.parse(m.settlement_ts!))&&Date.parse(m.settlement_ts!)<=now;
}
export function quoteOutcomeKnown(m:KalshiMarket,ts:number,release?:Date) {
    return outcomeAlreadyKnown(m,ts,release)||Boolean(m.settlement_ts&&Date.parse(m.settlement_ts)<=ts*1000);
}
// Small shared identity cache; funds are never expanded into inferred company constituents.
export async function trackEntities(limit=20) {
    const rows=await query<{symbol:string}>(`SELECT a.tag symbol FROM allowed_tags a LEFT JOIN track_entities e ON e.symbol=a.tag
        WHERE a.tag ~ '^[A-Z][A-Z0-9.\\-^=]{0,14}$' AND (e.symbol IS NULL OR e.updated_at<now()-interval '7 days')
        ORDER BY EXISTS(SELECT 1 FROM holdings h WHERE h.symbol=a.tag) DESC,a.tag LIMIT $1`,[limit]);
    if(!rows.length)return;
    const quotes=await yahoo.quote(rows.map(r=>r.symbol));
    for(const q of quotes) {
        const kind=q.quoteType==='EQUITY'?'company':['ETF','MUTUALFUND'].includes(q.quoteType)?'fund':q.quoteType==='INDEX'?'index':null;
        const name=q.longName??q.shortName;
        if(!kind||!name||!rows.some(r=>r.symbol===q.symbol))continue;
        await query(`INSERT INTO track_entities(symbol,name,kind) VALUES($1,$2,$3) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name,kind=excluded.kind,updated_at=now()`,[q.symbol,name,kind]);
    }
}
// Bounded, resumable collection. Only these new track_* tables are written.
export async function trackHistory(options:{maxMarkets?:number;maxSeries?:number;series?:string[]}={}) {
    const maxMarkets=Math.max(1,Math.min(50,options.maxMarkets??25));
    const maxSeries=Math.max(1,Math.min(6,options.maxSeries??3));
    const available=await query<{series_ticker:string}>(`SELECT t.series_ticker FROM series_tags t LEFT JOIN track_sync s ON s.series_ticker=t.series_ticker
        WHERE t.reviewed=true GROUP BY t.series_ticker ORDER BY COALESCE(min(s.updated_at),'epoch'::timestamptz),t.series_ticker`);
    const series=available.filter(s=>!options.series?.length||options.series.includes(s.series_ticker)).slice(0,maxSeries);
    const releases=await query<{event_ticker:string;released_at:Date}>('SELECT event_ticker,released_at FROM event_releases');
    let processed=0;
    for(const s of series)for(const source of ['historical','live'] as const) {
        if(processed>=maxMarkets)return {processed};
        const state=(await query<{cursor:string;page_offset:number}>('SELECT cursor,page_offset FROM track_sync WHERE series_ticker=$1 AND source=$2',[s.series_ticker,source]))[0];
        const cursor=state?.cursor??'',start=state?.page_offset??0;
        const page=await kalshi<{markets:KalshiMarket[];cursor:string}>(source==='historical'?'/historical/markets':'/markets',
            {series_ticker:s.series_ticker,limit:'100',...(source==='live'?{status:'settled',mve_filter:'exclude'}:{}),...(cursor?{cursor}:{})});
        if(!Array.isArray(page.markets))throw new Error('Invalid historical market listing');
        let offset=start;
        for(;offset<page.markets.length;offset++) {
            if(processed>=maxMarkets)break;
            const m=page.markets[offset];
            if(!finalBinary(m))continue;
            processed++;
            const occurred=m.occurrence_datetime&&Number.isFinite(Date.parse(m.occurrence_datetime))?m.occurrence_datetime:null;
            const stored=await query<{id:string}>(`INSERT INTO track_markets(ticker,series_ticker,event_ticker,close_time,settlement_time,occurrence_time,outcome,source)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(ticker) DO UPDATE SET close_time=excluded.close_time,settlement_time=excluded.settlement_time,
                occurrence_time=excluded.occurrence_time,outcome=excluded.outcome,source=excluded.source,fetched_at=now() RETURNING id`,
                [m.ticker,s.series_ticker,m.event_ticker,m.close_time,m.settlement_ts,occurred,m.result==='yes'?1:0,source]);
            const release=releases.find(r=>r.event_ticker===m.event_ticker)?.released_at;
            for(const {hours}of FORECAST_HORIZONS) {
                const target=Math.floor(Date.parse(m.close_time)/1000)-hours*3600;
                const previous=(await query<{quote_time:Date|null;status:string}>(`SELECT quote_time,status FROM track_quotes WHERE market_id=$1 AND horizon_hours=$2`,[stored[0].id,hours]))[0];
                // Reuse exact quotes, but re-evaluate timing when source metadata changes.
                if(previous?.status==='quoted'&&previous.quote_time&&previous.quote_time.getTime()/1000<=target&&previous.quote_time.getTime()/1000>=target-60&&!quoteOutcomeKnown(m,previous.quote_time.getTime()/1000,release))continue;
                const candles=await loadCandles(s.series_ticker,m.ticker,{start_ts:String(target-60),end_ts:String(target),period_interval:'1'},source==='historical');
                const odds=oddsBeforeClose(candles,m.close_time,hours);
                const status=!odds?'missing':quoteOutcomeKnown(m,odds.ts,release)?'outcome_known':'quoted';
                const candle=odds?candles.find(c=>c.end_period_ts===odds.ts):undefined;
                await query(`INSERT INTO track_quotes(market_id,horizon_hours,quote_time,yes_bid,yes_ask,status) VALUES($1,$2,$3,$4,$5,$6)
                    ON CONFLICT(market_id,horizon_hours) DO UPDATE SET quote_time=excluded.quote_time,yes_bid=excluded.yes_bid,yes_ask=excluded.yes_ask,status=excluded.status,fetched_at=now()`,
                    [stored[0].id,hours,status==='quoted'?new Date(odds!.ts*1000):null,status==='quoted'?candle!.yes_bid.close_dollars:null,status==='quoted'?candle!.yes_ask.close_dollars:null,status]);
            }
        }
        const done=offset>=page.markets.length,next=done?(page.cursor??''):cursor;
        if(done&&next&&next===cursor)throw new Error('Repeated history cursor');
        await query(`INSERT INTO track_sync(series_ticker,source,cursor,page_offset) VALUES($1,$2,$3,$4)
            ON CONFLICT(series_ticker,source) DO UPDATE SET cursor=excluded.cursor,page_offset=excluded.page_offset,updated_at=now()`,[s.series_ticker,source,next,done?0:offset]);
    }
    return {processed};
}
