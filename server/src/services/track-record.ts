import type { TrackRecordResponse, CategoryRecord } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { brier, calibration, wilson } from '../math/statistics.ts';
import { HISTORY_SUBJECTS, subjectSeries } from './history-subjects.ts';
import { TRUST } from '../config/trust.ts';
import { historyLinks, themeLinks } from './history-links.ts';
import { FORECAST_HORIZONS } from '../../../shared/types.ts';
export async function trackRecord(session?: string, horizonHours = 24): Promise<TrackRecordResponse> {
    if (!FORECAST_HORIZONS.some(h => h.hours === horizonHours)) throw new Error('Unsupported forecast horizon');
    const rows = await query<{
        ticker: string; title: string | null; category: string; series_ticker: string | null; event_ticker: string | null;
        prob_24h_before: number; outcome: number; close_time: Date; odds_time: Date; loaded_at: Date;
        released_at?: Date | null; source_url?: string | null;
        yes_bid?: number; yes_ask?: number;
    }>(horizonHours === 24
        ? `SELECT s.*,COALESCE(s.title,m.title) title,COALESCE(s.series_ticker,m.series_ticker) series_ticker,COALESCE(s.event_ticker,m.event_ticker) event_ticker,r.released_at,r.source_url FROM settled_markets s LEFT JOIN markets m ON m.ticker=s.ticker LEFT JOIN event_releases r ON r.event_ticker=COALESCE(s.event_ticker,m.event_ticker) ORDER BY s.close_time DESC,s.ticker`
        : `SELECT s.*,(s.yes_bid+s.yes_ask)/2 AS prob_24h_before,r.released_at,r.source_url FROM forecast_observations s LEFT JOIN event_releases r ON r.event_ticker=s.event_ticker WHERE horizon_hours=$1 ORDER BY close_time DESC,ticker`, horizonHours === 24 ? [] : [horizonHours], 'track_record');
    const reviewed = await query<{count: string}>('SELECT count(DISTINCT series_ticker) count FROM series_tags WHERE reviewed=true');
    // Category relevance means a reviewed series shares a tag with a saved holding.
    // It is not a claim that every historical market in that category concerns that holding.
    const links = session ? await query<{category: string; symbol: string}>(`SELECT DISTINCT e.category,h.symbol
        FROM portfolio_holdings h JOIN series_tags t ON t.reviewed=true AND
        (h.asset_type='security' AND (t.tag=h.symbol OR EXISTS(SELECT 1 FROM stock_tags st WHERE st.symbol=h.symbol AND st.tag=t.tag)))
        JOIN events e ON e.series_ticker=t.series_ticker WHERE h.session_id=$1 ORDER BY e.category,h.symbol`, [session]) : [];
    const relevantCategories = [...new Set(links.map(l => l.category))].map(category => ({category, holdings: links.filter(l => l.category===category).map(l => l.symbol)}));
    const categories: CategoryRecord[] = [];
    type Skip = { category: string; series_ticker: string; reason: 'no_quote' | 'outcome_known' };
    function summarize(category:string,data:typeof rows,skipped:Skip[]):CategoryRecord {
        const probs = data.map(r => r.prob_24h_before), outcomes = data.map(r => r.outcome);
        const { avgMiss, buckets } = calibration(probs, outcomes);
        const headline = data.filter(r => r.prob_24h_before >= 0.65 && r.prob_24h_before < 0.75);
        const yesRate = outcomes.reduce((s, o) => s + o, 0) / outcomes.length;
        const shown = headline.length >= TRUST.minHeadline, yes = headline.reduce((s, r) => s + r.outcome, 0);
        const range = shown ? wilson(yes, headline.length) : null;
        const closes = data.map(r => r.close_time.getTime());
        return { category, count: data.length, avgMiss, brier: brier(probs, outcomes), buckets, coverage: { scored: data.length, noQuote: skipped.filter(k => k.reason === 'no_quote').length, outcomeKnown: skipped.filter(k => k.reason === 'outcome_known').length }, eventCount: new Set(data.flatMap(r => r.event_ticker ? [r.event_ticker] : [])).size, baseRateBrier: yesRate * (1 - yesRate),
            firstClose: new Date(Math.min(...closes)).toISOString(), lastClose: new Date(Math.max(...closes)).toISOString(),
            eligibleForTrust: data.length >= TRUST.minSettled,
            knownReleaseCount: new Set(data.flatMap(r => r.released_at && r.source_url ? [r.source_url+'|'+r.released_at.toISOString()] : [])).size,
            marketsWithRelease: data.filter(r => r.released_at && r.source_url).length,
            relevantHoldings: relevantCategories.find(c => c.category===category)?.holdings ?? [],
            examples: data.slice(0,12).map(r => ({ticker:r.ticker,title:r.title ?? r.ticker,probability:r.prob_24h_before,outcome:r.outcome,closeTime:r.close_time.toISOString(),oddsTime:r.odds_time.toISOString(),eventTicker:r.event_ticker,bid:r.yes_bid??null,ask:r.yes_ask??null,release:r.released_at&&r.source_url?{at:r.released_at.toISOString(),sourceUrl:r.source_url}:null})),
            headline70: headline.length ? { count: headline.length, observedRate: shown ? yes / headline.length : null, low: range?.low ?? null, high: range?.high ?? null } : null };
    }
    // Subject groupings are separate from the category statistics used in trust scoring.
    const tags=await query<{series_ticker:string;tag:string}>('SELECT series_ticker,tag FROM series_tags WHERE reviewed=true');
    const skips = await query<Skip>('SELECT category,series_ticker,reason FROM backfill_skips WHERE horizon_hours=$1', [horizonHours]);
    const holdingLinks = session ? await historyLinks(session, tags) : new Map();
    for (const category of new Set(rows.map(r=>r.category))) categories.push(summarize(category,rows.filter(r=>r.category===category),skips.filter(k=>k.category===category)));
    const subjects=[{id:'all',title:'All markets',seriesTickers:[...new Set([...tags.map(t=>t.series_ticker),...rows.flatMap(r=>r.series_ticker?[r.series_ticker]:[])])]},...HISTORY_SUBJECTS.map(s=>({...s,seriesTickers:subjectSeries(s.id,tags)}))].map(s=>{
        const data=s.id==='all'?rows:rows.filter(r=>r.series_ticker!==null&&s.seriesTickers.includes(r.series_ticker));
        const skipped=s.id==='all'?skips:skips.filter(k=>s.seriesTickers.includes(k.series_ticker));
        return {id:s.id,title:s.title,seriesTickers:s.seriesTickers,record:data.length?summarize(s.title,data,s.id==='all'?skips:skips.filter(k=>s.seriesTickers.includes(k.series_ticker))):null,
            coverage:{scored:data.length,noQuote:skipped.filter(k=>k.reason==='no_quote').length,outcomeKnown:skipped.filter(k=>k.reason==='outcome_known').length},
            eventCount:new Set(data.flatMap(r=>r.event_ticker?[r.event_ticker]:[])).size,
            linkedHoldings: themeLinks(s.seriesTickers, holdingLinks),
            unknownEventMarkets:data.filter(r=>!r.event_ticker).length,kalshiCategories:[...new Set(data.map(r=>r.category))]};
    });
    return { horizonHours, subjects, categories: categories.sort((a,b)=>b.count-a.count), totalMarkets: rows.length,
        reviewedSeries: Number(reviewed[0]?.count ?? 0), relevantCategories, minSettled: TRUST.minSettled, trustScoring: { spread: TRUST.spreadMax, activity: TRUST.activityMax, depth: TRUST.depthMax, trackRecord: TRUST.trackMax, high: TRUST.high, medium: TRUST.medium },
        asOf: iso(rows.reduce<Date | null>((d,r)=>!d || r.loaded_at>d?r.loaded_at:d,null)) };
}
