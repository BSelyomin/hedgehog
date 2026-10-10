'use client';
import { useState } from 'react';
import type { TrackRatingItem, TrackRatingsResponse } from '../../../shared/types';
import { FORECAST_HORIZONS } from '../../../shared/types';
import { useData, Card, Fresh, Status, Empty, percent, LinkChip } from '../common';
export function RatingCard({item}:{item:TrackRatingItem}) {
    const r=item.rating;
    return <Card><h2>{item.symbol?`${item.symbol} · ${item.name}`:item.name}</h2>
        <p className="big mono">{r.accuracy===null?'—':percent(r.accuracy)}</p>
        <p><strong>{r.grade?`${r.grade} · `:''}{r.label}</strong></p>
        <p className="note">{r.evaluated?`${r.matched} of ${r.evaluated} questions matched the favored outcome · ${r.eventCount} event IDs`:'No usable earlier quotes and final outcomes collected at this timeframe.'}</p>
        {r.accuracy!==null&&!r.grade&&<p className="note">An observed percentage, with too little history to assign a grade.</p>}
        {item.linkedHoldings.length>0?<details><summary>Related to {item.linkedHoldings.length} of your holdings</summary>{item.linkedHoldings.map(h=><p key={h.symbol}><strong>{h.symbol}</strong> <LinkChip type={h.type}/> <span className="note">{h.evidence}</span></p>)}</details>:<p className="note">No reviewed connection to your current holdings.</p>}
    </Card>;
}
export function TrackRecord({initialView='assets'}:{initialView?:string}={}) {
    const [view,setView]=useState(initialView==='companies'?'companies':'assets');
    const [horizon,setHorizon]=useState(24),[page,setPage]=useState(1),[search,setSearch]=useState(''),[draft,setDraft]=useState('');
    const {data,error}=useData<TrackRatingsResponse>(`/track-record/ratings?horizon=${horizon}&page=${page}&search=${encodeURIComponent(search)}`);
    return <><h1>How often did Kalshi get it right?</h1>
        <p>See how earlier Kalshi predictions compared with real outcomes, before you put weight on today's odds.</p>
        <div className="toolbar"><label>Prediction timeframe<select value={horizon} onChange={e=>{setHorizon(Number(e.target.value));setPage(1);}}>{FORECAST_HORIZONS.map(h=><option key={h.hours} value={h.hours}>{h.label} before trading close</option>)}</select></label></div>
        <p className="note">We compare the outcome favored by the earlier odds with Kalshi’s final Yes or No result. Trading close and settlement are separate times.</p>
        <div className="toggle history-tabs" role="tablist" aria-label="Track record views" onKeyDown={e=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
            e.preventDefault();const next=e.key==='Home'?'assets':e.key==='End'?'companies':view==='assets'?'companies':'assets';setView(next);document.getElementById(`rating-${next}`)?.focus();
        }}>{['assets','companies'].map(id=><button key={id} id={`rating-${id}`} role="tab" tabIndex={view===id?0:-1} aria-selected={view===id} aria-controls="rating-panel" className={view===id?'active':''} onClick={()=>setView(id)}>{id==='assets'?'Asset holdings':'Companies'}</button>)}</div>
        {view==='companies'&&<form className="toolbar" onSubmit={e=>{e.preventDefault();setSearch(draft.trim());setPage(1);}}><label>Look up a company<input value={draft} maxLength={80} onChange={e=>setDraft(e.target.value)} placeholder="Company name or ticker"/></label><button type="submit">Search</button>{search&&<button type="button" onClick={()=>{setSearch('');setDraft('');setPage(1);}}>My linked companies</button>}</form>}
        <Status error={error} loading={!data&&!error}/><Fresh asOf={data?.asOf??null}/>
        {data&&<div id="rating-panel" role="tabpanel" aria-labelledby={`rating-${view}`}>
            <p>{view==='assets'?'Compare the record of each market theme. Expand a card to see its reviewed connection to your holdings.':search?`Company search results for “${search}”.`:'Companies with reviewed market links to your current holdings.'}</p>
            <div className="rating-grid">{(view==='assets'?data.themes:data.companies).map(item=><RatingCard key={item.id} item={item}/>)}</div>
            {view==='companies'&&!data.companies.length&&<Empty>{search?'No matching verified company in the current catalog.':'No linked companies yet. Add holdings or look up a company.'}</Empty>}
            {view==='companies'&&data.totalCompanies>data.pageSize&&<nav className="toolbar" aria-label="Company pages"><button disabled={data.page===1} onClick={()=>setPage(data.page-1)}>Previous</button><span>Page {data.page} of {Math.ceil(data.totalCompanies/data.pageSize)}</span><button disabled={data.page*data.pageSize>=data.totalCompanies} onClick={()=>setPage(data.page+1)}>Next</button></nav>}
            {view==='companies'&&<p className="note">Funds and indexes{data.fundSymbols.length?` (${data.fundSymbols.join(', ')})`:''} use the Asset holdings themes. Their constituent companies are not automatically expanded into this list.</p>}
        </div>}
        <details><summary>What this percentage means</summary><p>Accuracy is the share of scored questions whose favored Yes or No outcome happened. The midpoint of the historical bid and ask decides the favored side; exact 50% quotes are excluded. Missing quotes and quotes at or after a known outcome are excluded rather than estimated.</p><p>Quotes must fall within one minute before the selected target. Coverage is limited to collected, reviewed series. Outcome-release timestamps are incomplete, so a close-relative quote is not guaranteed to precede the public release. A grade requires at least 30 scored questions across 10 event IDs. Several questions can concern the same release, so they are not independent tests.</p><p>A: 90% or more · B: 75–89.9% · C: 50–74.9% · D: below 50%. These describe this historical sample, not future reliability or investment returns. A large number of easy threshold questions can inflate accuracy.</p></details>
        <details><summary>How this differs from the trust score</summary><p>This page measures whether the historically favored outcome happened. The existing trust score combines today’s spread, trading activity and open interest with the original category’s 24-hour calibration history. Calibration compares stated probabilities with how often outcomes occur. These are different measures; changing this page’s timeframe does not change trust scores.</p></details>
    </>;
}
