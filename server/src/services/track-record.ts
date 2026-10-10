import type { TrackRecordResponse, CategoryRecord } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { brier, calibration, wilson } from '../math/statistics.ts';
import { HISTORY_SUBJECTS, subjectSeries } from './history-subjects.ts';
import { TRUST } from '../config/trust.ts';
export async function trackRecord(session?: string): Promise<TrackRecordResponse> {
    const rows = await query<{
        ticker: string; title: string | null; category: string; series_ticker: string | null; event_ticker: string | null;
        prob_24h_before: number; outcome: number; close_time: Date; odds_time: Date; loaded_at: Date;
    }>(`SELECT s.*,COALESCE(s.title,m.title) title,COALESCE(s.series_ticker,m.series_ticker) series_ticker,COALESCE(s.event_ticker,m.event_ticker) event_ticker FROM settled_markets s LEFT JOIN markets m ON m.ticker=s.ticker ORDER BY s.close_time DESC,s.ticker`);
    const reviewed = await query<{count: string}>('SELECT count(DISTINCT series_ticker) count FROM series_tags WHERE reviewed=true');
    // Category relevance means a reviewed series shares a tag with a saved holding.
    // It is not a claim that every historical market in that category concerns that holding.
    const links = session ? await query<{category: string; symbol: string}>(`SELECT DISTINCT e.category,h.symbol
        FROM holdings h JOIN series_tags t ON t.reviewed=true AND
        (t.tag=h.symbol OR EXISTS(SELECT 1 FROM stock_tags st WHERE st.symbol=h.symbol AND st.tag=t.tag))
        JOIN events e ON e.series_ticker=t.series_ticker WHERE h.session_id=$1 ORDER BY e.category,h.symbol`, [session]) : [];
    const relevantCategories = [...new Set(links.map(l => l.category))].map(category => ({category, holdings: links.filter(l => l.category===category).map(l => l.symbol)}));
    const categories: CategoryRecord[] = [];
    function summarize(category:string,data:typeof rows):CategoryRecord {
        const probs = data.map(r => r.prob_24h_before), outcomes = data.map(r => r.outcome);
        const { avgMiss, buckets } = calibration(probs, outcomes);
        const headline = data.filter(r => r.prob_24h_before >= 0.65 && r.prob_24h_before < 0.75);
        const yesRate = outcomes.reduce((s, o) => s + o, 0) / outcomes.length;
        const shown = headline.length >= TRUST.minHeadline, yes = headline.reduce((s, r) => s + r.outcome, 0);
        const range = shown ? wilson(yes, headline.length) : null;
        const closes = data.map(r => r.close_time.getTime());
        return { category, count: data.length, avgMiss, brier: brier(probs, outcomes), buckets, eventCount: new Set(data.flatMap(r => r.event_ticker ? [r.event_ticker] : [])).size, baseRateBrier: yesRate * (1 - yesRate),
            firstClose: new Date(Math.min(...closes)).toISOString(), lastClose: new Date(Math.max(...closes)).toISOString(),
            eligibleForTrust: data.length >= TRUST.minSettled,
            relevantHoldings: relevantCategories.find(c => c.category===category)?.holdings ?? [],
            examples: data.slice(0,12).map(r => ({ticker:r.ticker,title:r.title ?? r.ticker,probability:r.prob_24h_before,outcome:r.outcome,closeTime:r.close_time.toISOString(),oddsTime:r.odds_time.toISOString()})),
            headline70: headline.length ? { count: headline.length, observedRate: shown ? yes / headline.length : null, low: range?.low ?? null, high: range?.high ?? null } : null };
    }
    for (const category of new Set(rows.map(r=>r.category))) categories.push(summarize(category,rows.filter(r=>r.category===category)));
    // Subject groupings are separate from the category statistics used in trust scoring.
    const tags=await query<{series_ticker:string;tag:string}>('SELECT series_ticker,tag FROM series_tags WHERE reviewed=true');
    const subjects=[{id:'all',title:'All history',seriesTickers:[...new Set(rows.flatMap(r=>r.series_ticker?[r.series_ticker]:[]))]},...HISTORY_SUBJECTS.map(s=>({...s,seriesTickers:subjectSeries(s.id,tags)}))].map(s=>{
        const data=s.id==='all'?rows:rows.filter(r=>r.series_ticker!==null&&s.seriesTickers.includes(r.series_ticker));
        return {id:s.id,title:s.title,seriesTickers:s.seriesTickers,record:data.length?summarize(s.title,data):null,
            eventCount:new Set(data.flatMap(r=>r.event_ticker?[r.event_ticker]:[])).size,
            unknownEventMarkets:data.filter(r=>!r.event_ticker).length,kalshiCategories:[...new Set(data.map(r=>r.category))]};
    });
    return { subjects, categories: categories.sort((a,b)=>b.count-a.count), totalMarkets: rows.length,
        reviewedSeries: Number(reviewed[0]?.count ?? 0), relevantCategories, minSettled: TRUST.minSettled,
        asOf: iso(rows.reduce<Date | null>((d,r)=>!d || r.loaded_at>d?r.loaded_at:d,null)) };
}
