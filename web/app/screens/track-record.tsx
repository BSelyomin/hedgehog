'use client';
import { useState } from 'react';
import type { TrackRatingItem, TrackRatingsResponse } from '../../../shared/types';
import { FORECAST_HORIZONS } from '../../../shared/types';
import { useData, Card, Fresh, Status, Empty, percent, money, LinkChip, ReloadButton } from '../common';
export function filterLinkedHoldings(holdings:TrackRatingItem['linkedHoldings'],search:string) {
    const term=search.trim().toLowerCase();
    return holdings.filter(h=>!term||h.symbol.toLowerCase().includes(term)||h.name?.toLowerCase().includes(term));
}
export function HoldingDisclosure({name,holdings}:{name:string;holdings:TrackRatingItem['linkedHoldings']}) {
    const [search,setSearch]=useState('');
    const visible=filterLinkedHoldings(holdings,search);
    return <details className="rating-disclosure"><summary>Related to {holdings.length} of your holdings</summary>
        <label className="rating-holding-search">Search holdings<input aria-label={`Search holdings for ${name}`} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ticker or name"/></label>
        <p className="note rating-scroll-hint">{visible.length} of {holdings.length} holdings · Scroll within this list ↓</p>
        <div className="rating-holdings-scroll" role="region" aria-label={`${name} linked holdings`} tabIndex={0}>
        {visible.length?<ul className="rating-holding-list">{visible.map(h=><li key={h.symbol}>
            <div className="rating-holding-top"><strong>{h.symbol}</strong><LinkChip type={h.type}/></div>
            {h.name&&<p className="note">{h.name}</p>}
            <p className="rating-holding-value">{h.valueUsd!=null?<><strong className="mono">{money(h.valueUsd)}</strong>{h.share!=null&&<span> · {percent(h.share)} of portfolio</span>}</>:'Portfolio amount unavailable'}</p>
            <p className="note">{h.evidence}</p>
        </li>)}</ul>:<p className="note">No holdings match your search.</p>}</div>
        <p className="note">Portfolio amounts are the values you entered.</p>
    </details>;
}
export function RatingCard({item}:{item:TrackRatingItem}) {
    const r=item.rating;
    return <Card className="rating-row"><div className="rating-identity"><h2>{item.symbol?`${item.symbol} · ${item.name}`:item.name}</h2>
        {item.relatedThemes?.length ? <p className="note">Linked themes: {item.relatedThemes.join(' · ')}</p> : null}
        {item.scope?<p className="note">{item.scope}</p>:item.kind!=='fund'&&item.kind!=='benchmark'&&item.symbol&&<p className="note">Company-specific questions, including earnings-call mentions</p>}
        </div><div className={`rating-result${r.accuracy!==null?' has-score':''}`}><p className="big mono">{r.accuracy===null?'—':percent(r.accuracy)}</p>
        <p><strong>{r.grade?`${r.grade} · `:''}{r.label}</strong></p></div><div className="rating-context">
        <p className="note">{r.evaluated?`${r.matched} of ${r.evaluated} questions matched the favored outcome · ${r.eventCount} event IDs`:r.missing?`${r.missing} settled questions checked; historical quotes are missing at this timeframe.`:r.tied?'Available quotes had no favored outcome (50/50).':item.kind==='fund'?'No usable fund-specific or benchmark history collected at this timeframe.':item.symbol?'No company-specific history collected at this timeframe.':'No usable earlier quotes and final outcomes collected at this timeframe.'}</p>
        {r.accuracy!==null&&!r.grade&&<p className="note">An observed percentage, with too little history to assign a grade.</p>}
        {item.linkedHoldings.length>0?<HoldingDisclosure name={item.name} holdings={item.linkedHoldings}/>:!item.relatedThemes?.length&&<p className="note">No reviewed connection to your current holdings.</p>}
        </div></Card>;
}
export function TrackRecord({initialView='assets'}:{initialView?:string}={}) {
    const [view,setView]=useState(['companies','funds'].includes(initialView)?initialView:'assets');
    const [fundPage,setFundPage]=useState(1);
    const [horizon,setHorizon]=useState(24),[page,setPage]=useState(1),[search,setSearch]=useState(''),[draft,setDraft]=useState('');
    const {data,error,reload}=useData<TrackRatingsResponse>(`/track-record/ratings?horizon=${horizon}&page=${page}&fundPage=${fundPage}&search=${encodeURIComponent(search)}`);
    return <><div className="row"><h1>How often did Kalshi get it right?</h1><ReloadButton onReload={reload}/></div>
        <p>See how earlier Kalshi predictions compared with real outcomes, before you put weight on today's odds.</p>
        <div className="toolbar"><label>Prediction timeframe<select value={horizon} onChange={e=>{setHorizon(Number(e.target.value));setPage(1);setFundPage(1);}}>{FORECAST_HORIZONS.map(h=><option key={h.hours} value={h.hours}>{h.label} before trading close</option>)}</select></label></div>
        <p className="note">We compare the outcome favored by the earlier odds with Kalshi’s final Yes or No result. Trading close and settlement are separate times.</p>
        <div className="toggle history-tabs" role="tablist" aria-label="Track record views" onKeyDown={e=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
            e.preventDefault();const tabs=['assets','companies','funds'],index=tabs.indexOf(view);const next=e.key==='Home'?'assets':e.key==='End'?'funds':tabs[(index+(e.key==='ArrowRight'?1:2))%3];setView(next);document.getElementById(`rating-${next}`)?.focus();
        }}>{['assets','companies','funds'].map(id=><button key={id} id={`rating-${id}`} role="tab" tabIndex={view===id?0:-1} aria-selected={view===id} aria-controls="rating-panel" className={view===id?'active':''} onClick={()=>setView(id)}>{id==='assets'?'Asset holdings':id==='companies'?'Companies':'ETFs & index funds'}</button>)}</div>
        {view==='companies'&&<form className="toolbar" onSubmit={e=>{e.preventDefault();setSearch(draft.trim());setPage(1);}}><label>Look up a company<input value={draft} maxLength={80} onChange={e=>setDraft(e.target.value)} placeholder="Company name or ticker"/></label><button type="submit">Search</button>{search&&<button type="button" onClick={()=>{setSearch('');setDraft('');setPage(1);}}>My linked companies</button>}</form>}
        <Status error={error} loading={!data&&!error}/><Fresh asOf={data?.asOf??null}/>
        {data&&<div id="rating-panel" role="tabpanel" aria-labelledby={`rating-${view}`}>
            <p>{view==='funds'?'Evaluate funds and benchmarks as single records. S&P 500 predictions are used for SPY’s benchmark; constituent companies are not expanded.':view==='assets'?'Compare the record of each market theme. Expand a row to see its reviewed connection to your holdings.':search?`Company search results for “${search}”.`:'Your company holdings and companies with reviewed portfolio links. Linked themes provide context; percentages score company-specific questions.'}</p>
            <div className="rating-list">{(view==='assets'?data.themes:view==='companies'?data.companies:data.funds).map(item=><RatingCard key={item.id} item={item}/>)}</div>
            {view==='companies'&&!data.companies.length&&<Empty>{search?'No matching verified company in the current catalog.':'No linked companies yet. Add holdings or look up a company.'}</Empty>}
            {view==='companies'&&data.totalCompanies>data.pageSize&&<nav className="toolbar" aria-label="Company pages"><button disabled={data.page===1} onClick={()=>setPage(data.page-1)}>Previous</button><span>Page {data.page} of {Math.ceil(data.totalCompanies/data.pageSize)}</span><button disabled={data.page*data.pageSize>=data.totalCompanies} onClick={()=>setPage(data.page+1)}>Next</button></nav>}
            {view==='funds'&&data.totalFunds>data.pageSize&&<nav className="toolbar" aria-label="Fund pages"><button disabled={data.fundPage===1} onClick={()=>setFundPage(data.fundPage-1)}>Previous</button><span>Page {data.fundPage} of {Math.ceil(data.totalFunds/data.pageSize)}</span><button disabled={data.fundPage*data.pageSize>=data.totalFunds} onClick={()=>setFundPage(data.fundPage+1)}>Next</button></nav>}
            {view==='companies'&&<p className="note">Funds and indexes{data.fundSymbols.length?` (${data.fundSymbols.join(', ')})`:''} have a separate ETFs &amp; index funds tab. Their constituent companies are not automatically expanded into this list.</p>}
            {view==='funds'&&<p className="note">SPY’s benchmark mapping comes from <a href="https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy" target="_blank" rel="noreferrer">State Street’s fund information</a>. A benchmark record measures the index questions, with the same historical scoring rules. Funds without verified matching questions stay unscored.</p>}
        </div>}
        <details><summary>What this percentage means</summary><p>Accuracy is the share of scored questions whose favored Yes or No outcome happened. The midpoint of the historical bid and ask decides the favored side; exact 50% quotes are excluded. Missing quotes and quotes at or after a known outcome are excluded rather than estimated.</p><p>Quotes must fall within one minute before the selected target. Coverage is limited to collected, reviewed series. Outcome-release timestamps are incomplete, so a close-relative quote is not guaranteed to precede the public release. A grade requires at least 30 scored questions across 10 event IDs. Several questions can concern the same release, so they are not independent tests.</p><p>A: 90% or more · B: 75–89.9% · C: 50–74.9% · D: below 50%. These describe this historical sample, not future reliability or investment returns. A large number of easy threshold questions can inflate accuracy.</p></details>
        <details><summary>How this differs from the trust score</summary><p>This page measures whether the historically favored outcome happened. The existing trust score combines today’s spread, trading activity and open interest with the original category’s 24-hour calibration history. Calibration compares stated probabilities with how often outcomes occur. These are different measures; changing this page’s timeframe does not change trust scores.</p></details>
    </>;
}
