'use client';
import { useState } from 'react';
import type { ExposureEvent, ExposureResponse, Holding, HoldingLink } from '../../../shared/types';
import { money, percent, dateText, href, Empty, TrustBadge } from '../common';

export interface ExposureFilters {
    search: string;
    holding: string;
    link: 'All' | 'Affected' | 'Direct' | 'Measured';
    category: string;
    days: number;
    sort: 'reach-desc' | 'reach-asc' | 'date' | 'name' | 'holdings';
}
export const defaultExposureFilters: ExposureFilters = { search: '', holding: '', link: 'All', category: '', days: 0, sort: 'reach-desc' };

function matchesLink(link: HoldingLink, filter: ExposureFilters['link']) {
    return link.type !== 'Related' && (filter === 'All' || filter === 'Affected' || link.type === filter);
}

// The API's Measured classification remains the source of historically supported links.
const linkLabel = (type: HoldingLink['type']) => type === 'Measured' ? 'Related' : type;

// View controls only: reach, probabilities and link classifications come from the API.
export function filterExposure(events: ExposureEvent[], filters: ExposureFilters, now = Date.now()) {
    const term = filters.search.trim().toLowerCase();
    return events.filter(event => {
        const links = event.links.filter(link => (!filters.holding || link.symbol === filters.holding) && matchesLink(link, filters.link));
        return links.length > 0
            && (!filters.category || event.category === filters.category)
            && (!filters.days || (Date.parse(event.closeTime) >= now && Date.parse(event.closeTime) <= now + filters.days * 86400000))
            && (!term || [event.title, event.ticker, ...event.markets.flatMap(m => [m.title, m.subtitle, m.ticker]), ...links.map(l => l.symbol)].some(s => s.toLowerCase().includes(term)));
    }).sort((a, b) => {
        const comparison = filters.sort === 'reach-asc' ? a.share - b.share
            : filters.sort === 'date' ? Date.parse(a.closeTime) - Date.parse(b.closeTime)
            : filters.sort === 'name' ? a.title.localeCompare(b.title)
            : filters.sort === 'holdings' ? b.links.length - a.links.length : b.share - a.share;
        return comparison || a.title.localeCompare(b.title) || a.ticker.localeCompare(b.ticker);
    });
}

export function filterExposureHoldings(holdings: Holding[], events: ExposureEvent[], filters: ExposureFilters) {
    return holdings.filter(holding => (!filters.holding || holding.symbol === filters.holding)
        && events.some(event => event.links.some(link => link.symbol === holding.symbol && matchesLink(link, filters.link))));
}

export function eventHoldings(event: ExposureEvent, holdings: Holding[], filter: ExposureFilters['link']) {
    const rank = { Direct: 0, Measured: 1, Related: 2 };
    return holdings.flatMap(holding => {
        const link = event.links.find(link => link.symbol === holding.symbol);
        return link && matchesLink(link, filter) ? [{ holding, link }] : [];
    }).sort((a, b) => rank[a.link.type] - rank[b.link.type]
            || b.holding.valueUsd - a.holding.valueUsd || a.holding.symbol.localeCompare(b.holding.symbol));
}

function HoldingTiles({ event, holdings, linkFilter }: { event: ExposureEvent; holdings: Holding[]; linkFilter: ExposureFilters['link'] }) {
    const ordered = eventHoldings(event, holdings, linkFilter);
    return <ul className="holding-tiles" tabIndex={0} aria-label={`Holdings for ${event.title}, strongest links first; scroll horizontally for more`}>
            {ordered.map(({ holding, link }) => <li key={holding.symbol}>
                <a href={href('event', event.ticker)} className={`cell ${link.type}`} title={`${linkLabel(link.type)}: ${link.evidence}`} aria-label={`${holding.symbol}: ${event.title}, ${linkLabel(link.type)}, ${money(holding.valueUsd)}`}>
                    <strong>{holding.symbol}</strong><span className="holding-value">{money(holding.valueUsd)}</span>
                </a>
            </li>)}
        </ul>;
}

function ExposureRow({ event, holdings, linkFilter }: { event: ExposureEvent; holdings: Holding[]; linkFilter: ExposureFilters['link'] }) {
    const [outcome, setOutcome] = useState('');
    const market = event.markets.find(m => m.ticker === outcome) ?? event.markets[0];
    return <tr>
        <th scope="row" className="event-column"><a className="event-title" href={href('event', event.ticker)}>{event.title}</a><p className="note">{event.category}<br/>{dateText(event.closeTime, true)} · market close</p></th>
        <td className="reach-column"><strong className="mono">{percent(event.share)}</strong><p className="mono">{money(event.linkedValue)}</p><span className="note">{event.links.length} linked holdings</span></td>
        <td className="outcome-column">
            {event.markets.length > 1 ? <label>Outcome<select aria-label={`Outcome for ${event.title}`} value={market?.ticker ?? ''} onChange={e => setOutcome(e.target.value)}>{event.markets.map(m => <option key={m.ticker} value={m.ticker}>{m.subtitle || m.title}</option>)}</select></label> : <p>{market?.subtitle || market?.title || 'No outcome available'}</p>}
            {market && <><p className="mono">{percent(market.probability)} yes</p><TrustBadge market={market}/><p className="note">Bid–ask midpoint{market.trust.trackRecord === null ? ' · No track record yet' : ''}</p></>}
        </td>
        <td className="holdings-column"><HoldingTiles event={event} holdings={holdings} linkFilter={linkFilter}/></td>
    </tr>;
}

export function ExposureTable({ data }: { data: ExposureResponse }) {
    const [filters, setFilters] = useState<ExposureFilters>(defaultExposureFilters);
    const [view, setView] = useState<'event' | 'holding'>('event');
    const events = filterExposure(data.events, filters);
    const holdings = filterExposureHoldings(data.holdings, events, filters);
    function update<K extends keyof ExposureFilters>(key: K, value: ExposureFilters[K]) { setFilters(previous => ({ ...previous, [key]: value })); }
    return <>
        <div className="toggle" aria-label="Exposure view"><button aria-pressed={view === 'event'} className={view === 'event' ? 'active' : ''} onClick={() => setView('event')}>By event</button><button aria-pressed={view === 'holding'} className={view === 'holding' ? 'active' : ''} onClick={() => setView('holding')}>By holding</button></div>
        <div className="exposure-controls">
            <label className="search-control">Search events or holdings<input type="search" placeholder="Event, outcome or ticker…" value={filters.search} onChange={e => update('search', e.target.value)}/></label>
            <label>Holding<select aria-label="Holding" value={filters.holding} onChange={e => update('holding', e.target.value)}><option value="">All holdings</option>{data.holdings.map(h => <option key={h.symbol}>{h.symbol}</option>)}</select></label>
            <label>Link type<select aria-label="Link type" value={filters.link} onChange={e => update('link', e.target.value as ExposureFilters['link'])}><option>All</option><option value="Affected">Affected only</option><option>Direct</option><option value="Measured">Related</option></select></label>
            <label>Category<select aria-label="Category" value={filters.category} onChange={e => update('category', e.target.value)}><option value="">All categories</option>{[...new Set(data.events.map(e => e.category))].sort().map(category => <option key={category}>{category}</option>)}</select></label>
            <label>Closes within<select aria-label="Closes within" value={filters.days} onChange={e => update('days', Number(e.target.value))}><option value={0}>Any date</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
            <label className="sort-control">Sort events<select aria-label="Sort events" value={filters.sort} onChange={e => update('sort', e.target.value as ExposureFilters['sort'])}><option value="reach-desc">Most portfolio reach</option><option value="reach-asc">Least portfolio reach</option><option value="date">Soonest close</option><option value="holdings">Most linked holdings</option><option value="name">Event name: A–Z</option></select></label>
            <button onClick={() => setFilters(defaultExposureFilters)}>Reset filters</button>
        </div>
        <p className="note" role="status">Showing {events.length} of {data.events.length} linked events and {holdings.length} of {data.holdings.length} holdings. {filters.link === 'Affected' ? 'Affected only shows Direct or Related holdings within each event.' : 'Related links are backed by historical measurements. Direct holdings come first.'} Portfolio share always uses your full portfolio.</p>
        {events.length ? view === 'holding' ? <ByHolding events={events} holdings={holdings} linkFilter={filters.link}/> : <div className="scroll exposure-scroll" tabIndex={0} role="region" aria-label="Exposure table"><table className="exposure-table"><caption className="sr-only">Events with portfolio reach, selected outcome odds and holdings ordered by connection</caption><thead><tr><th scope="col" className="event-column">Event</th><th scope="col" className="reach-column">Share of portfolio</th><th scope="col" className="outcome-column">Outcome</th><th scope="col" className="holdings-column">Holdings · strongest links first</th></tr></thead><tbody>{events.map(event => <ExposureRow key={event.ticker} event={event} holdings={holdings} linkFilter={filters.link}/>)}</tbody></table></div> : <Empty>{data.events.length ? 'No events match these filters. Try another search or reset filters.' : 'No reviewed market links available. Holdings need supported company tags, measured driver links or a reviewed sector mapping.'}</Empty>}
    </>;
}

function ByHolding({ events, holdings, linkFilter }: { events: ExposureEvent[]; holdings: Holding[]; linkFilter: ExposureFilters['link'] }) {
    return <>{holdings.map(holding => <div className="event-row" key={holding.symbol}><h3>{holding.symbol} <span className="mono muted">{money(holding.valueUsd)}</span></h3>{events.filter(event => event.links.some(link => link.symbol === holding.symbol && matchesLink(link, linkFilter))).map(event => { const link = event.links.find(link => link.symbol === holding.symbol)!; return <p key={event.ticker}><span className={`chip ${link.type}`}>{linkLabel(link.type)}</span> <a href={href("event", event.ticker)}>{event.title}</a></p>; })}</div>)}</>;
}
