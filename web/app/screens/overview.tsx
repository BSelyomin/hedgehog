'use client';
import { useState } from 'react';
import { ExposureTable } from './exposure-table';
import type { ReactNode, FormEvent } from 'react';
import type { Holding, HoldingsResponse, ExposureResponse, ExposureEvent, Market, CalendarResponse, EventResponse, MovesResponse, EarningsResponse, TrackRecordResponse, BriefingResponse, CategoryRecord, OddsPoint } from '../../../shared/types';
import { money, percent, number, dateText, href, api, useData, Card, Fresh, Status, Empty, TrustBadge, Progress, EventList, ReloadButton } from '../common';

export function Overview() { const { data, error, reload } = useData<ExposureResponse>('/exposure'); const [briefingKey, setBriefingKey] = useState(0); return <><div className="row"><div><h1>Your exposure map</h1><p>Your holdings and the events linked to them</p></div><div className="toolbar"><ReloadButton onReload={async () => { setBriefingKey(k => k + 1); await reload(); }}/><a href="#holdings">Edit holdings →</a></div></div><Status error={error} loading={!data && !error}/>{data && <><Fresh asOf={data.asOf}/><div className="stats"><Card><span className="muted">Portfolio value · entered by you</span><strong className="number">{money(data.totalValue)}</strong><span className="muted">{data.holdings.length} holdings</span></Card><Card><span className="muted">Widest-reaching event</span><h3>{data.events[0]?.title ?? 'No links yet'}</h3><p>{data.events[0] ? `${percent(data.events[0].share)} of your value linked` : 'Add holdings and review market tags.'}</p></Card><Card><span className="muted">Linked events (all future dates)</span><strong className="number">{data.events.length}</strong><p className="note">Calendar shows only the next 14 days.</p><a href="#calendar">Open calendar →</a></Card><Card><span className="muted">Daily price changes</span><h3>Understand your move</h3><a href="#moves">Open move explainer →</a></Card></div><Card><div className="row"><div><h2>Which events touch which holdings</h2><p className="note">Select an event for odds, trust and evidence.</p></div><div className="toolbar">{(['Direct', 'Measured', 'Related'] as const).map(type => <span key={type} className={`chip ${type}`}>{type}</span>)}</div></div><ExposureTable data={data}/><p className="note">Share counts the full value of every linked holding. It shows how far an event reaches into your portfolio, not how much those holdings would move.</p></Card></>}<Briefing key={briefingKey}/></>; }

export function Briefing() {
    const { data, error, reload } = useData<BriefingResponse>('/briefing');
    return <Card>
        <div className="row"><h2>Your saved briefing</h2><ReloadButton label="Reload briefing" onReload={() => reload('/briefing/reload')}/></div>
        <Status error={error} loading={!data && !error}/>
        {data && <>
            <p className="note" role="status">{data.text ? 'Cached briefing for your current holdings.' : 'No cached briefing for your current holdings. Select Reload briefing to prepare one from available data.'}</p>
            {data.generatedAt && <p className="note">Saved <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString()}</time>. This briefing describes that snapshot; current market figures may differ. Unchanged holdings reuse this saved briefing.</p>}
            {data.audioUrl && <audio controls preload="none" src={data.audioUrl}/>}
            {data.text && <details><summary>Read briefing</summary><p>{data.text}</p></details>}
            <Fresh asOf={data.asOf}/>
        </>}
    </Card>;
}
