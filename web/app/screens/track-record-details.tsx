'use client';
import { HoldingsHistory } from './holdings-history';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TrackRecordResponse, CategoryRecord, ExposureResponse, HistorySubject } from '../../../shared/types';
import { FORECAST_HORIZONS } from '../../../shared/types';
import { percent, number, dateText, useData, Card, Fresh, Status, Empty, href, Progress, LinkChip } from '../common';
const historyDate = (s:string|null) => s ? new Date(s).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'unavailable';
const horizonName = (hours:number) => FORECAST_HORIZONS.find(h=>h.hours===hours)?.label ?? '24 hours';
export function visibleThemes(subjects:HistorySubject[],relevant:boolean,symbols?:string[]) {
    return subjects.filter(s=>s.id!=='all'&&(!relevant||Boolean(s.linkedHoldings?.some(h=>!symbols||symbols.includes(h.symbol)))));
}
export function contextLine(view:string,data:TrackRecordResponse,subject?:HistorySubject) {
    const all=!subject||subject.id==='all';
    if(view==='holdings') return `Showing past events linked to the holdings you have today${all?', across all topics.':`, about ${subject!.title.toLowerCase()}.`}`;
    return all?`Showing all ${data.totalMarkets} settled markets at this horizon. Choose a theme to compare similar markets.`:`Showing the ${subject!.record?.count??0} settled markets about ${subject!.title.toLowerCase()}, ${horizonName(data.horizonHours??24)} before trading close.`;
}
export function TrackRecord({initialView='accuracy'}:{initialView?:string}={}) {
    const [view,setView]=useState(initialView==='holdings'?'holdings':'accuracy');
    const [horizon,setHorizon]=useState(24);
    const {data,error}=useData<TrackRecordResponse>(`/track-record?horizon=${horizon}`);
    const {data:portfolio,error:portfolioError}=useData<ExposureResponse>('/exposure');
    const [selected,setSelected]=useState('all'),[relevant,setRelevant]=useState(false),[holding,setHolding]=useState(''),[showMoves,setShowMoves]=useState(false);
    const securities=portfolio?.holdings.filter(h=>!h.assetType||h.assetType==='security')??[];
    const heldSymbols=holding&&securities.some(h=>h.symbol===holding)?[holding]:securities.map(h=>h.symbol);
    const themes=visibleThemes(data?.subjects??[],view==='holdings'||relevant,view==='holdings'?heldSymbols:undefined).filter(s=>s.record||s.seriesTickers.length).map(s=>view==='holdings'?{...s,linkedHoldings:s.linkedHoldings?.filter(h=>heldSymbols.includes(h.symbol))}:s);
    const subject=selected==='all'?undefined:themes.find(s=>s.id===selected);
    const selection=subject?.id??'all';
    return <><h1>How did Kalshi’s earlier odds hold up?</h1>
    <p>See how earlier Kalshi predictions compared with real outcomes, before you put weight on today's odds.</p>
    <div className="toggle history-tabs" role="tablist" aria-label="Track record views" onKeyDown={e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault();const next=e.key==='Home'?'accuracy':e.key==='End'?'holdings':view==='accuracy'?'holdings':'accuracy';
        setView(next);document.getElementById(next==='accuracy'?'accuracy-tab':'holdings-tab')?.focus();
    }}><button role="tab" tabIndex={view==='accuracy'?0:-1} id="accuracy-tab" aria-selected={view==='accuracy'} aria-controls="accuracy-panel" className={view==='accuracy'?'active':''} onClick={()=>setView('accuracy')}>By Market</button><button role="tab" tabIndex={view==='holdings'?0:-1} id="holdings-tab" aria-selected={view==='holdings'} aria-controls="holdings-panel" className={view==='holdings'?'active':''} onClick={()=>setView('holdings')}>By Holding</button></div>
    <div className="toolbar history-controls">
        <label>Market theme<select value={selection} onChange={e=>setSelected(e.target.value)}><option value="all">All markets</option>{themes.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        {view==='accuracy'?<label>Portfolio relevance<select value={relevant?'holdings':'all'} onChange={e=>setRelevant(e.target.value==='holdings')}><option value="all">All markets</option><option value="holdings">Linked to my holdings</option></select></label>:<label>Holding<select value={holding&&heldSymbols.includes(holding)?holding:''} onChange={e=>setHolding(e.target.value)}><option value="">All stocks and funds</option>{securities.map(h=><option key={h.symbol} value={h.symbol}>{h.symbol}</option>)}</select></label>}
        <label>Forecast horizon<select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>{FORECAST_HORIZONS.map(h=><option key={h.hours} value={h.hours}>{h.label} before trading close</option>)}</select></label>
    </div>
    <Status error={error} loading={!data&&!error}/><Fresh asOf={data?.asOf??null}/>
    {data&&<div id={view==='accuracy'?'accuracy-panel':'holdings-panel'} role="tabpanel" aria-labelledby={view==='accuracy'?'accuracy-tab':'holdings-tab'}>
        {view==='holdings'&&<Status error={portfolioError} loading={!portfolio&&!portfolioError}/>}
        <p className="note">{view==='holdings'?'Showing historical market records linked to your current stocks and funds. Choose a holding to inspect its relevant themes.':relevant?'Showing themes linked to your current holdings.':'Choose a market theme to see its record and connection to your holdings.'} Each record evaluates the whole theme’s reviewed markets, not your investment returns.</p>
        <p className="note">Quotes are bid–ask midpoints from about {horizonName(horizon)} before trading close, within one minute of that target. Trading close is not the time an outcome was released or settled.</p>
        {!subject?<ThemeOverview themes={themes} horizonHours={horizon} relevant={view==='holdings'||relevant} select={setSelected}/>:
        subject.record?<CategoryEvidence category={subject.record} subject={subject} minSettled={data.minSettled} horizonHours={horizon} connections={<ThemeConnections subject={subject} events={portfolio?.events??[]} symbols={view==='holdings'?heldSymbols:undefined}/>}/>:
        <><Card><h2>{subject.title}: not enough history yet</h2><p>No usable earlier quotes and reported outcomes have been stored for this theme at {horizonName(horizon)} before trading close.</p><p className="note">A quote from a different horizon is never substituted. Your holdings CSV adds portfolio context; it cannot supply historical Kalshi predictions.</p>{subject.coverage&&<p className="note">Recorded exclusions: {subject.coverage.noQuote} without a usable quote; {subject.coverage.outcomeKnown} with the outcome already known. An empty record does not mean poor forecasting.</p>}</Card><ThemeConnections subject={subject} events={portfolio?.events??[]} symbols={view==='holdings'?heldSymbols:undefined}/></>}
        {view==='holdings'&&securities.length>0&&<details onToggle={e=>setShowMoves(e.currentTarget.open)}><summary>Explore price changes around past events</summary><p className="note">These closing-price comparisons use the existing 24-hour history. They add context to the historical event outcomes; the forecast horizon selector above applies to the market records.</p>{showMoves&&<HoldingsHistory subject={selection} symbols={heldSymbols}/>}</details>}
        <details><summary>How this history fits into trust scoring</summary><TrustExplainer t={data.trustScoring} minSettled={data.minSettled}/><p className="note">The existing trust score uses the original Kalshi category’s 24-hour record. Selecting a theme or a different horizon does not change that score.</p></details>
    </div>}
    <details><summary>About this data</summary><p className="note">Themes group reviewed Kalshi series by their subject. A market can appear in more than one theme. These are retrospective comparisons of available quotes and Kalshi-reported Yes/No outcomes; missing quotes are not estimated. Only the 24-hour view includes the existing legacy history.</p><p className="note">Historical comparisons do not establish how your investments performed. Your current holdings and reviewed links explain relevance, not past ownership or causation.</p></details></>;
}
export function ThemeOverview({themes,horizonHours,relevant,select}:{themes:HistorySubject[];horizonHours:number;relevant:boolean;select:(id:string)=>void}) {
    const available=themes.filter(s=>s.record),missing=themes.filter(s=>!s.record);
    const cards=(items:HistorySubject[]) => <div className="history-theme-grid">{items.map(s=><button key={s.id} className="history-theme-card" onClick={()=>select(s.id)}><strong>{s.title}</strong><span>{s.record?`${s.record.count} contracts · ${s.eventCount} Kalshi event IDs`:'No usable history at this horizon yet'}</span><span className="note">{s.linkedHoldings?.length?`Linked holdings: ${s.linkedHoldings.map(h=>h.symbol).join(', ')}`:'No current holding connection'}</span><span className="blue">Explore evidence →</span></button>)}</div>;
    return <><h2>Explore the market records</h2><p>Compare similar questions at {horizonName(horizonHours)} before trading close. Each theme keeps its own sample.</p>
    {!themes.length?<Empty>{relevant?'No reviewed market themes are linked to your current stocks and funds yet. Add holdings or choose All markets.':'No reviewed market themes are available.'}</Empty>:<>
        {available.length?cards(available):<Empty>No historical quotes have been stored for these themes at this horizon yet. Choose another horizon or inspect the reviewed connections below.</Empty>}
        {missing.length>0&&<details><summary>Reviewed markets without history at this horizon ({missing.length})</summary>{cards(missing)}</details>}
    </>}
    <p className="note">Contract and event counts are not independent samples. Several event IDs can share one real-world release; theme totals can overlap. Other themes appear when reviewed connections or scored history are available.</p></>;
}
export function ThemeConnections({subject,events,symbols}:{subject:HistorySubject;events:ExposureResponse['events'];symbols?:string[]}) {
    const links=(subject.linkedHoldings??[]).filter(h=>!symbols||symbols.includes(h.symbol));
    const linkedEvents=events.filter(e=>subject.seriesTickers.includes(e.seriesTicker??'')&&(!symbols||e.links.some(l=>symbols.includes(l.symbol))));
    return <Card><h2>How this connects to your holdings</h2>
    {links.length?<><p>Reviewed series in <strong>{subject.title}</strong> connect to these holdings you have today. This record evaluates those kinds of Kalshi questions, rather than your holdings’ returns.</p>
    {links.slice(0,3).map(l=><div className="event-row" key={l.symbol}><strong>{l.symbol}</strong> <LinkChip type={l.type}/><p>{l.evidence}</p></div>)}
    {links.length>3&&<details><summary>See all {links.length} linked holdings</summary>{links.slice(3).map(l=><div className="event-row" key={l.symbol}><strong>{l.symbol}</strong> <LinkChip type={l.type}/><p>{l.evidence}</p></div>)}</details>}
    {linkedEvents.length>0&&<details><summary>Current events you’re following</summary>{linkedEvents.slice(0,6).map(e=><p key={e.ticker}><a href={href('event',e.ticker)}>{e.title}</a></p>)}</details>}</>:
    <p>No reviewed {subject.title.toLowerCase()} series is linked to your current holdings. You can still examine its historical market record.</p>}
    <p className="note">A reviewed topic establishes relevance. A measured driver relationship is a historical association; it does not show that a particular event caused a price move.</p></Card>;
}
export function TrustExplainer({t,minSettled}:{t:TrackRecordResponse['trustScoring'];minSettled:number}) {
    return <Card><h2>How trust is scored</h2><p>Each market gets a score from 0 to {t.spread+t.activity+t.depth+t.trackRecord}, built from four parts. The event page shows every part.</p>
    <div className="scroll"><table><thead><tr><th>Part</th><th>Up to</th><th>What it rewards</th></tr></thead><tbody>
    <tr><td>Spread</td><td className="mono">{t.spread}</td><td>A narrow gap between the bid and the ask, so the midpoint is a firm estimate.</td></tr>
    <tr><td>Activity</td><td className="mono">{t.activity}</td><td>More contracts traded in the last 24 hours.</td></tr>
    <tr><td>Depth</td><td className="mono">{t.depth}</td><td>More open contracts, so one trade moves the price less.</td></tr>
    <tr><td>Track record</td><td className="mono">{t.trackRecord}</td><td>A small average gap between earlier odds and outcomes in the market's category (the evidence on this page).</td></tr></tbody></table></div>
    <p className="note">Bands: High {t.high} or more, Medium {t.medium}–{t.high-1}, Low below {t.medium}. A category needs at least {minSettled} settled markets before its track record counts; otherwise the other three parts are rescaled and the score says "no track record yet".</p></Card>;
}
export function CategoryEvidence({category:c,minSettled,subject,horizonHours=24,connections}:{category:CategoryRecord;minSettled:number;subject?:HistorySubject;horizonHours?:number;connections?:ReactNode}) {
    return <><Card><span className="eyebrow">{c.category} · Historical evidence</span><h2>{c.eligibleForTrust?'What the historical sample shows':'An early sample — use caution'}</h2>
    <p><strong>{c.count} contracts</strong> across <strong>{c.eventCount} distinct events</strong> (Kalshi event IDs), closing between {historyDate(c.firstClose)} and {historyDate(c.lastClose)}.</p>
    <p className="note">Forecast horizon: about {horizonName(horizonHours)} before trading close. Multiple contracts can belong to one event, and multiple event IDs can refer to one underlying release. These are not independent events.</p>
    {c.marketsWithRelease!==undefined&&<p className="note">Official release timing is available for {c.marketsWithRelease} contracts, across {c.knownReleaseCount??0} sourced releases. Other release times are unknown; close time is not a substitute.</p>}
    {subject&&subject.unknownEventMarkets>0&&<p className="note">Event identity is missing for {subject.unknownEventMarkets} contracts.</p>}
    {c.eligibleForTrust?<p>Across probability groups, the mean predictions and observed outcomes differed by <strong>{number(c.avgMiss)} percentage points</strong> on average. This describes this sample; it is not a percentage of predictions that were correct.</p>:<p>This sample is below the {minSettled}-market threshold for the existing trust component. There is not enough evidence for a strong forecasting claim.</p>}
    <Coverage c={c}/></Card>
    {connections}
    <Card><h2>Historical examples</h2><p>What Kalshi predicted, and what actually happened.</p><p className="note">Up to twelve recent actual observations at this horizon. Outcomes are reported by Kalshi. Expand a question to inspect its timestamps and any stored official release source.</p>
    <div className="scroll historical-prediction-scroll" tabIndex={0} role="region" aria-label="Historical forecast evidence"><table><thead><tr><th>Historical question</th><th>Earlier Yes odds</th><th>What happened</th></tr></thead><tbody>{c.examples.map(e=><tr key={e.ticker}><td><details><summary>{e.title}</summary><p className="note mono">Market: {e.ticker}<br/>Event: {e.eventTicker??'Identity unavailable'}</p><p className="note">Quote recorded: {dateText(e.oddsTime,true)}<br/>Trading closed: {dateText(e.closeTime,true)}</p>{e.release?<><p className="note">Official release: {dateText(e.release.at,true)}. {Date.parse(e.oddsTime)<Date.parse(e.release.at)?'Quote preceded this release.':'Quote at/after release; this is not a prior forecast of that release.'}</p><a href={e.release.sourceUrl} target="_blank" rel="noreferrer">Official release source</a></>:<p className="note">Underlying release time and independent settlement source have not been stored. The result shown is Kalshi’s reported result.</p>}</details></td><td className="mono">{percent(e.probability)}{e.bid!=null&&e.ask!=null&&<p className="note">Bid {percent(e.bid)} / ask {percent(e.ask)}</p>}</td><td>{e.outcome===1?'Yes — it happened':'No — it did not happen'}</td></tr>)}</tbody></table></div></Card>
    <details><summary>Explore the details: chart, probability groups and Brier score</summary>
    <Card><h2>When the odds said “around 70%”</h2>{c.headline70?c.headline70.observedRate===null?<p><strong>Only {c.headline70.count} markets</strong> were quoted between 65% and 75%. Too few to report a rate.</p>:<><p>For {c.headline70.count} contracts quoted between 65% and 75%, Yes happened {percent(c.headline70.observedRate)} of the time.</p><p className="note">The conventional binomial interval is {percent(c.headline70.low)}–{percent(c.headline70.high)}. It assumes independent observations; related contracts can make this interval too narrow.</p></>:<p>No contracts in this sample were quoted between 65% and 75%.</p>}</Card>
    <div className="split history-details"><Card><h2>Calibration at a glance</h2><p className="note">Across: predicted chance. Up: how often Yes happened. Dots near the diagonal show closer agreement.</p><CalibrationChart category={c}/><details><summary>How to read the dots</summary><p>A dot at 70% across and 50% up means those contracts predicted about 70%, but half resolved Yes. Below the line, Yes happened less often than predicted; above it, more often. Counts are contracts, not independent releases.</p></details></Card>
    <Card><h2>Probability groups</h2><div className="scroll probability-scroll" tabIndex={0} role="region" aria-label="Scrollable probability groups"><table><thead><tr><th>Earlier odds</th><th>Markets</th><th>Mean prediction</th><th>Actually happened</th></tr></thead><tbody>{c.buckets.map(b=><tr key={b.low}><td>{Math.round(b.low*100)}–{Math.round(b.high*100)}%</td><td>{b.count}</td><td>{percent(b.meanProb)}</td><td>{percent(b.observedRate)}</td></tr>)}</tbody></table></div><p className="note">Empty groups have no estimate. Larger dots represent more contracts; faint dots contain fewer than five.</p><details className="brier-explanation"><summary>Brier score: {number(c.brier,3)}</summary><p>Average squared difference between each probability and outcome. Lower is better. Always predicting 50% scores 0.25.</p><p>Predicting this sample’s own Yes rate scores {number(c.baseRateBrier,3)}. This reference is fitted to the same outcomes; beating it does not prove future skill.</p></details></Card></div></details></>;
}
function Coverage({c}:{c:CategoryRecord}) {
    const {scored,noQuote,outcomeKnown}=c.coverage,skipped=noQuote+outcomeKnown;
    if(!skipped) return <p className="note">No unscored markets have been recorded for this sample. This does not establish complete backfill coverage.</p>;
    return <p className="note"><strong>Recorded coverage: {scored} of {scored+skipped} settled markets scored.</strong> {noQuote>0&&`${noQuote} had no bid–ask quote at the selected horizon. `}{outcomeKnown>0&&`${outcomeKnown} were excluded because the event had already happened. `}This denominator includes recorded exclusions, not every market Kalshi has ever listed.</p>;
}
export function CalibrationChart({ category }: {
    category: CategoryRecord;
}) { return <svg className="chart calibration-chart" viewBox="0 0 420 420" role="img" aria-label={`${category.category}: predicted odds versus observed outcomes`}><line x1="40" y1="375" x2="390" y2="25" stroke="#647084" strokeDasharray="7 7"/>{[0, .5, 1].map(p => <g key={p}><line x1="40" y1={375 - p * 350} x2="390" y2={375 - p * 350} stroke="#2A313C"/><text x="0" y={380 - p * 350} fill="#A3ADBA" fontSize="15">{percent(p)}</text><text x={32 + p * 350} y="405" fill="#A3ADBA" fontSize="15">{percent(p)}</text></g>)}{category.buckets.filter(b => b.count && b.meanProb !== null && b.observedRate !== null).map(b => <circle key={b.low} cx={40 + b.meanProb! * 350} cy={375 - b.observedRate! * 350} r={Math.min(14, 4 + Math.sqrt(b.count))} fill="#5AA2FF" fillOpacity={b.count < 5 ? .35 : 1}><title>{`${percent(b.meanProb)} predicted, ${percent(b.observedRate)} observed; ${b.count} markets`}</title></circle>)}</svg>; }
