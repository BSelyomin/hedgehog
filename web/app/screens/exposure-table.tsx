'use client';
import { useState } from 'react';
import type { ExposureEvent, ExposureResponse, Holding, HoldingLink } from '../../../shared/types';
import { money, percent, dateText, href, Empty, TrustBadge } from '../common';

export interface ExposureFilters {
    search: string;
    holding: string;
    link: 'All' | HoldingLink['type'];
    category: string;
    days: number;
    sort: 'reach-desc' | 'reach-asc' | 'date' | 'name' | 'holdings';
}
export const defaultExposureFilters: ExposureFilters = { search: '', holding: '', link: 'All', category: '', days: 0, sort: 'reach-desc' };

// View controls only: reach, probabilities and link classifications come from the API.
export function filterExposure(events: ExposureEvent[], filters: ExposureFilters, now = Date.now()) {
    const term = filters.search.trim().toLowerCase();
    return events.filter(event => {
        const links = event.links.filter(link => !filters.holding || link.symbol === filters.holding);
        return links.some(link => filters.link === 'All' || link.type === filters.link)
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

function ExposureRow({ event, holdings }: { event: ExposureEvent; holdings: Holding[] }) {
    const [outcome, setOutcome] = useState('');
    const market = event.markets.find(m => m.ticker === outcome) ?? event.markets[0];
    return <tr>
        <th scope="row" className="event-column"><a className="event-title" href={href('event', event.ticker)}>{event.title}</a><p className="note">{event.category}<br/>{dateText(event.closeTime)} · market close</p></th>
        <td className="reach-column"><strong className="mono">{percent(event.share)}</strong><p className="mono">{money(event.linkedValue)}</p><span className="note">{event.links.length} linked holdings</span></td>
        <td className="outcome-column">
            {event.markets.length > 1 ? <label>Outcome<select aria-label={`Outcome for ${event.title}`} value={market?.ticker ?? ''} onChange={e => setOutcome(e.target.value)}>{event.markets.map(m => <option key={m.ticker} value={m.ticker}>{m.subtitle || m.title}</option>)}</select></label> : <p>{market?.subtitle || market?.title || 'No outcome available'}</p>}
            {market && <><p className="mono">{percent(market.probability)} yes</p><TrustBadge market={market}/><p className="note">Bid–ask midpoint{market.trust.trackRecord === null ? ' · No track record yet' : ''}</p></>}
        </td>
        {holdings.map(h => {
            const link = event.links.find(l => l.symbol === h.symbol);
            return <td key={h.symbol} className="link-column">{link ? <a href={href('event', event.ticker)} className={`cell ${link.type}`} title={link.evidence} aria-label={`${h.symbol}: ${event.title}, ${link.type}`}>{link.type}</a> : <span className="cell blank" aria-label={`${h.symbol}: no supported link`}>No link</span>}</td>;
        })}
    </tr>;
}

export function ExposureTable({ data }: { data: ExposureResponse }) {
    const [filters, setFilters] = useState<ExposureFilters>(defaultExposureFilters);
    const events = filterExposure(data.events, filters);
    const holdings = data.holdings.filter(h => !filters.holding || h.symbol === filters.holding);
    function update<K extends keyof ExposureFilters>(key: K, value: ExposureFilters[K]) { setFilters(previous => ({ ...previous, [key]: value })); }
    return <>
        <div className="exposure-controls">
            <label className="search-control">Search events or holdings<input type="search" placeholder="Event, outcome or ticker…" value={filters.search} onChange={e => update('search', e.target.value)}/></label>
            <label>Holding<select aria-label="Holding" value={filters.holding} onChange={e => update('holding', e.target.value)}><option value="">All holdings</option>{data.holdings.map(h => <option key={h.symbol}>{h.symbol}</option>)}</select></label>
            <label>Link type<select aria-label="Link type" value={filters.link} onChange={e => update('link', e.target.value as ExposureFilters['link'])}><option>All</option><option>Direct</option><option>Measured</option><option value="Related">Not measured (Related)</option></select></label>
            <label>Category<select aria-label="Category" value={filters.category} onChange={e => update('category', e.target.value)}><option value="">All categories</option>{[...new Set(data.events.map(e => e.category))].sort().map(category => <option key={category}>{category}</option>)}</select></label>
            <label>Closes within<select aria-label="Closes within" value={filters.days} onChange={e => update('days', Number(e.target.value))}><option value={0}>Any date</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
            <label>Sort events<select aria-label="Sort events" value={filters.sort} onChange={e => update('sort', e.target.value as ExposureFilters['sort'])}><option value="reach-desc">Portfolio share: high to low</option><option value="reach-asc">Portfolio share: low to high</option><option value="date">Soonest close</option><option value="holdings">Most linked holdings</option><option value="name">Event name: A–Z</option></select></label>
            <button onClick={() => setFilters(defaultExposureFilters)}>Reset filters</button>
        </div>
        <p className="note" role="status">Showing {events.length} of {data.events.length} linked events. Link filters match at least one visible holding. Portfolio share always uses your full portfolio.</p>
        {events.length ? <div className="scroll exposure-scroll" tabIndex={0} role="region" aria-label="Exposure table; scroll horizontally for more holdings"><table className="exposure-table"><caption className="sr-only">Events by holding, with portfolio reach and selected outcome odds</caption><thead><tr><th scope="col" className="event-column">Event</th><th scope="col">Share of portfolio</th><th scope="col">Outcome</th>{holdings.map(h => <th scope="col" key={h.symbol}><strong>{h.symbol}</strong><p className="mono">{money(h.valueUsd)}</p></th>)}</tr></thead><tbody>{events.map(event => <ExposureRow key={event.ticker} event={event} holdings={holdings}/>)}</tbody></table></div> : <Empty>{data.events.length ? 'No events match these filters. Try another search or reset filters.' : 'No reviewed market links available. Holdings need supported company tags, measured driver links or a reviewed sector mapping.'}</Empty>}
    </>;
}
