'use client';
import { useState } from 'react';
import type { CalendarResponse, ExposureResponse } from '../../../shared/types';
import { percent, href, useData, Card, Fresh, Status, Empty, Progress, EventList } from '../common';

export function Calendar() {
    const [days, setDays] = useState(14);
    const [filter, setFilter] = useState('All');
    const { data, error } = useData<CalendarResponse | ExposureResponse>(days ? `/calendar?days=${days}` : '/exposure');
    const events = (data?.events.filter(event => filter === 'All' || (filter === 'Company') === event.links.some(link => link.type === 'Direct')) ?? [])
        .sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime));
    const windowLabel = days ? `the next ${days} days` : 'all future dates';
    return <>
        <div className="row">
            <div><h1>Event calendar</h1><p>Kalshi events linked to your holdings, ordered by market close</p></div>
            <div className="toolbar">
                <label>Date range<select aria-label="Calendar date range" value={days} onChange={event => setDays(Number(event.target.value))}>
                    <option value={14}>Next 14 days</option><option value={30}>Next 30 days</option><option value={90}>Next 90 days</option><option value={0}>All future dates</option>
                </select></label>
                <div className="toggle" aria-label="Event type">{['All', 'Macro', 'Company'].map(type => <button key={type} onClick={() => setFilter(type)} aria-pressed={filter === type} className={filter === type ? 'active' : ''}>{type}</button>)}</div>
            </div>
        </div>
        <p className="note">Overview counts linked events at all future dates. Calendar defaults to the next 14 days; choose All future dates to see the same events.</p>
        <Status error={error} loading={!data && !error}/><Fresh asOf={data?.asOf ?? null}/>
        {data && <p className="note" role="status">Showing {events.length} of {data.events.length} linked events in {windowLabel}. Event type: {filter}.</p>}
        <div className="split">
            <Card>{events.length ? <EventList events={events} showYear/> : data && <Empty>No linked events match this event type and date range. Choose All events or a wider range.</Empty>}</Card>
            <Card><h2>Biggest events for you</h2><p className="note">Ranked by share of portfolio linked.</p>
                {[...events].sort((a, b) => b.share - a.share).slice(0, 6).map(event => <div className="event-row" key={event.ticker}><a href={href('event', event.ticker)}>{event.title}</a><p className="mono">{percent(event.share)}</p><Progress value={event.share}/></div>)}
                <p className="note">Times come from Kalshi market close times.</p>
            </Card>
        </div>
    </>;
}
