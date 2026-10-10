'use client';
import { useState } from 'react';
import { ExposureTable } from './exposure-table';
import type { ExposureResponse, CalendarResponse, BriefingResponse } from '../../../shared/types';
import { money, percent, dateText, href, api, useData, Card, Fresh, Status, LinkChip } from '../common';

export function Overview() {
    const { data, error } = useData<ExposureResponse>('/exposure');
    const widest = data?.events[0];
    return <>
        <div className="row"><div><h1>Your exposure map</h1><p>Your holdings and the events linked to them</p></div><a href="#holdings">Edit holdings →</a></div>
        <Status error={error} loading={!data && !error}/>
        {data && <>
            <Fresh asOf={data.asOf}/>
            <div className="stats overview-stats">
                <Card><span className="muted">Portfolio value · entered by you</span><strong className="number">{money(data.totalValue)}</strong><span className="muted">{data.holdings.length} holdings</span></Card>
                <Card className="widest-event"><span className="muted">Widest-reaching event</span><h3>{widest?.title ?? 'No links yet'}</h3>
                    <p>{widest ? `${percent(widest.share)} of your value linked` : 'Add holdings and review market tags.'}</p>
                    {widest && <p className="note">Ends <time dateTime={widest.closeTime}>{dateText(widest.closeTime, true)}</time> · Kalshi market close</p>}
                </Card>
                <EndingSoon/>
                <Card><span className="muted">Linked events (all future dates)</span><strong className="number">{data.events.length}</strong><p className="note">Calendar defaults to the next 14 days.</p><a href="#calendar">Open calendar →</a></Card>
                <Card><span className="muted">Daily price changes</span><h3>Understand your move</h3><a href="#moves">Open move explainer →</a></Card>
            </div>
            <Card className="exposure-map">
                <div className="row exposure-map-heading"><div><h2>Which events touch which holdings</h2><p className="note">Expand an event for details. Use the wheel to scroll its holdings.</p></div>
                    <div className="exposure-legend">{(['Direct', 'Measured'] as const).map(type => <LinkChip key={type} type={type}/>)}</div>
                </div>
                <ExposureTable data={data}/>
                <details className="exposure-help"><summary>How to read this table</summary><p className="note">Red = Direct; blue = Related, backed by historical measurements. Only connected holdings appear, strongest links first. Color describes the link, not the direction of a price move. Share and linked-holding counts use all source links, including those hidden by filters, and your full portfolio value. They show portfolio reach, not how much holdings would move.</p></details>
            </Card>
            <Briefing/>
        </>}
    </>;
}

function EndingSoon() {
    const { data, error } = useData<CalendarResponse>('/calendar?days=14');
    const next = data?.events[0];
    return <Card className="ending-soon"><span className="muted">Events ending soon</span>
        {error ? <p className="note">Upcoming events unavailable.</p> : !data ? <p className="note" role="status">Loading upcoming events…</p> : <>
            <strong className="number">{data.events.length}</strong><p className="note">In the next 14 days</p>
            {next ? <><a href={href('event', next.ticker)}>{next.title}</a><p className="note">Next close: <time dateTime={next.closeTime}>{dateText(next.closeTime, true)}</time></p></> : <p className="note">No linked events close in this window.</p>}
        </>}
        <a href="#calendar">View upcoming events →</a>
    </Card>;
}

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
    return <Card>
        <div className="row"><h2>Your morning briefing</h2><button disabled={busy} onClick={() => void refresh()}>{busy ? 'Preparing briefing…' : 'Refresh briefing'}</button></div>
        <p className="note">Prepared daily from 8 a.m. New York time. Refresh to hear an updated check-in now.</p>
        {data?.audioUrl ? <audio key={revision} controls preload="none" src={`${data.audioUrl}?revision=${revision}`}/> : <p className="note">Audio is not ready yet. The daily briefing appears when source data and the voice service are available.</p>}
        {data?.text && <details><summary>Read briefing</summary><p>{data.text}</p></details>}
        {(refreshError || error) && <p role="alert" className="note">{refreshError || 'Briefing unavailable.'}</p>}
        <Fresh asOf={data?.asOf ?? null}/>
    </Card>;
}
