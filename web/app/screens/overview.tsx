'use client';
import { useState } from 'react';
import { ExposureTable } from './exposure-table';
import type { ReactNode, FormEvent } from 'react';
import type { Holding, HoldingsResponse, ExposureResponse, ExposureEvent, Market, CalendarResponse, EventResponse, MovesResponse, EarningsResponse, TrackRecordResponse, BriefingResponse, CategoryRecord, OddsPoint } from '../../../shared/types';
import { money, percent, number, dateText, href, api, useData, Card, Fresh, Status, Empty, TrustBadge, Progress, EventList } from '../common';

export function Overview() { const { data, error } = useData<ExposureResponse>('/exposure'); return <><div className="row"><div><h1>Your exposure map</h1><p>Your holdings and the events linked to them</p></div><a href="#holdings">Edit holdings →</a></div><Status error={error} loading={!data && !error}/>{data && <><Fresh asOf={data.asOf}/><div className="stats"><Card><span className="muted">Portfolio value · entered by you</span><strong className="number">{money(data.totalValue)}</strong><span className="muted">{data.holdings.length} holdings</span></Card><Card><span className="muted">Widest-reaching event</span><h3>{data.events[0]?.title ?? 'No links yet'}</h3><p>{data.events[0] ? `${percent(data.events[0].share)} of your value linked` : 'Add holdings and review market tags.'}</p></Card><Card><span className="muted">Linked events (all future dates)</span><strong className="number">{data.events.length}</strong><p className="note">Calendar shows only the next 14 days.</p><a href="#calendar">Open calendar →</a></Card><Card><span className="muted">Daily price changes</span><h3>Understand your move</h3><a href="#moves">Open move explainer →</a></Card></div><Card><div className="row"><div><h2>Which events touch which holdings</h2><p className="note">Select an event for odds, trust and evidence.</p></div><div className="toolbar">{(['Direct', 'Measured', 'Related'] as const).map(type => <span key={type} className={`chip ${type}`}>{type}</span>)}</div></div><ExposureTable data={data}/><p className="note">Share counts the full value of every linked holding. It shows how far an event reaches into your portfolio, not how much those holdings would move.</p></Card><Briefing /></>}</>; }

export function Briefing() {
    const { data: saved, error } = useData<BriefingResponse>('/briefing');
    const [updated, setUpdated] = useState<BriefingResponse | null>(null);
    const [busy, setBusy] = useState(false), [refreshError, setRefreshError] = useState(''), [revision, setRevision] = useState(0);
    const data = updated ?? saved;
    async function refresh() {
        setBusy(true); setRefreshError('');
        try { setUpdated(await api<BriefingResponse>('/briefing/refresh', {method:'POST', body:'{}'})); setRevision(r => r + 1); }
        catch (e) { setRefreshError((e as Error).message); }
        finally { setBusy(false); }
    }
    return <Card><div className="row"><h2>Your morning briefing</h2><button disabled={busy} onClick={() => void refresh()}>{busy ? 'Preparing briefing…' : 'Refresh briefing'}</button></div><p className="note">Prepared daily from 8 a.m. New York time. Refresh to hear an updated check-in now.</p>{data?.audioUrl ? <audio key={revision} controls preload="none" src={`${data.audioUrl}?revision=${revision}`}/> : <p className="note">Audio is not ready yet. The daily briefing appears when source data and the voice service are available.</p>}{data?.text && <details><summary>Read briefing</summary><p>{data.text}</p></details>}{(refreshError || error) && <p role="alert" className="note">{refreshError || 'Briefing unavailable.'}</p>}<Fresh asOf={data?.asOf ?? null}/></Card>;
}
