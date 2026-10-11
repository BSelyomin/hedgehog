'use client';
import { useId, useState } from 'react';
import type { ExposureEvent, ExposureResponse, Holding, HoldingLink } from '../../../shared/types';
import { money, percent, dateText, href, linkLabel, Empty, Fresh, TrustBadge, LinkChip } from '../common';
import { describeDrivers, describeImportance, driverName } from './sensitivity';
import { selectEvents, selectedSymbols, useCategorySelection } from './category-filter';

export interface ExposureFilters {
    search: string;
    holding: string;
    link: 'All' | 'Affected' | 'Direct' | 'Calculated' | 'Measured';
    category: string;
    days: number;
    sort: 'reach-desc' | 'reach-asc' | 'date' | 'name' | 'holdings';
}
export const defaultExposureFilters: ExposureFilters = { search: '', holding: '', link: 'All', category: '', days: 0, sort: 'reach-desc' };

function matchesLink(link: HoldingLink, filter: ExposureFilters['link']) {
    return link.type !== 'Related' && (filter === 'All' || filter === 'Affected' || link.type === filter);
}

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

// Every holding linked to the event, strongest links first: by link type, then holdings whose
// most important measured driver is this event's driver, then by value.
export function eventHoldings(event: ExposureEvent, holdings: Holding[], filter: ExposureFilters['link']) {
    const rank = { Direct: 0, Calculated: 1, Measured: 2, Related: 3 };
    const minor = (link: HoldingLink) => link.sensitivity && link.lead && link.lead.driver !== link.sensitivity.driver ? 1 : 0;
    return holdings.flatMap(holding => {
        const link = event.links.find(link => link.symbol === holding.symbol);
        return link && matchesLink(link, filter) ? [{ holding, link }] : [];
    }).sort((a, b) => rank[a.link.type] - rank[b.link.type] || minor(a.link) - minor(b.link)
            || b.holding.valueUsd - a.holding.valueUsd || a.holding.symbol.localeCompare(b.holding.symbol));
}

// A holding's value over the whole portfolio's. Null when the portfolio's total is not known.
export const holdingShare = (holding: Holding, totalValue: number) => totalValue > 0 ? holding.valueUsd / totalValue : null;

// The tiles wrap onto further lines, so no linked holding is hidden off the edge of the row. Each
// says what the holding is worth, as entered, and its share of the whole portfolio.
function HoldingTiles({ event, holdings, linkFilter, totalValue }: { event: ExposureEvent; holdings: Holding[]; linkFilter: ExposureFilters['link']; totalValue: number }) {
    const ordered = eventHoldings(event, holdings, linkFilter);
    const share = (holding: Holding) => { const part = holdingShare(holding, totalValue); return part === null ? '' : `${percent(part)} of portfolio`; };
    return <ul className="holding-tiles" aria-label={`${ordered.length} ${ordered.length === 1 ? 'holding' : 'holdings'} for ${event.title}, strongest links first`}>
            {ordered.map(({ holding, link }) => <li key={holding.symbol}>
                <a href={href('event', event.ticker)} className={`cell ${link.type}`} title={`${holding.symbol} · ${money(holding.valueUsd)}${share(holding) && ` · ${share(holding)}`} · ${linkLabel(link.type)}: ${link.evidence}`} aria-label={`${holding.symbol}: ${event.title}, ${linkLabel(link.type)}, ${money(holding.valueUsd)}${share(holding) && `, ${share(holding)}`}`}>
                    <strong>{holding.symbol}</strong><span className="holding-value">{money(holding.valueUsd)}{share(holding) && <> · {percent(holdingShare(holding, totalValue))}</>}</span>
                </a>
            </li>)}
        </ul>;
}

function ExposureRow({ event, holdings, linkFilter, totalValue }: { event: ExposureEvent; holdings: Holding[]; linkFilter: ExposureFilters['link']; totalValue: number }) {
    const [outcome, setOutcome] = useState('');
    const [expanded, setExpanded] = useState(false);
    const detailId = useId();
    const market = event.markets.find(m => m.ticker === outcome) ?? event.markets[0];
    const linked = eventHoldings(event, holdings, linkFilter);
    const closeDate = new Date(event.closeTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return <><tr className={`exposure-summary${expanded ? ' expanded' : ''}`}>
        <th scope="row" className="event-column">
            <button className="event-disclosure" aria-expanded={expanded} aria-controls={detailId} aria-label={`${expanded ? 'Hide' : 'Show'} details for ${event.title}`} onClick={() => setExpanded(value => !value)}>
                <span className="disclosure-chevron" aria-hidden="true">›</span>
                <span className="event-heading"><span className="event-title" title={event.title}>{event.title}</span><span className="event-close">Closes <time dateTime={event.closeTime}>{closeDate}</time></span></span>
            </button>
        </th>
        <td className="reach-column" data-label="Portfolio share"><strong className="mono">{percent(event.share)}</strong></td>
        <td className="outcome-column">
            {event.markets.length > 1 ? <select aria-label={`Outcome for ${event.title}`} title={market?.subtitle || market?.title} value={market?.ticker ?? ''} onChange={e => setOutcome(e.target.value)}>{event.markets.map(m => <option key={m.ticker} value={m.ticker}>{m.subtitle || m.title}</option>)}</select> : <span className="single-outcome" title={market?.subtitle || market?.title}>{market?.subtitle || market?.title || 'No outcome available'}</span>}
            {market && <span className="outcome-odds"><strong className="mono">{market.probability === null ? 'Unavailable' : `${percent(market.probability)} yes`}</strong><span>midpoint</span></span>}
        </td>
        <td className="holdings-column"><HoldingTiles event={event} holdings={holdings} linkFilter={linkFilter} totalValue={totalValue}/></td>
    </tr>
        <tr id={detailId} className="exposure-detail-row" hidden={!expanded}><td colSpan={4}>{expanded && <div className="exposure-detail-grid">
            <section><h3>{event.title}</h3><dl className="exposure-facts">
                <dt>Category</dt><dd>{event.category}</dd>
                <dt>Market close</dt><dd><time dateTime={event.closeTime}>{dateText(event.closeTime, true)}</time></dd>
                <dt>Linked value</dt><dd className="mono">{money(event.linkedValue)}</dd>
                <dt>Holdings</dt><dd>{event.links.length} linked · {linked.length} shown</dd>
            </dl><a className="open-event" href={href('event', event.ticker)}>Open full event →</a></section>
            <section><h3>Selected outcome</h3><p className="selected-outcome-title">{market?.subtitle || market?.title || 'No outcome available'}</p>
                {market && <><p className="mono">{market.probability === null ? 'Probability unavailable' : `${percent(market.probability)} yes`}</p><TrustBadge market={market}/>
                    <p className="note">Probability is the bid–ask midpoint.{market.trust.trackRecord === null ? ' No track record yet.' : ` Category track record: ${market.trust.categoryCount} settled markets.`}</p>
                    <Fresh asOf={market.asOf}/><a className="open-event" href={href('event', market.ticker)}>View outcome and trust details →</a></>}
            </section>
            <section><h3>Holdings shown · {linked.length}</h3><ul className="exposure-holding-details" tabIndex={0} aria-label={`Holding values and evidence for ${event.title}`}>
                {linked.map(({ holding, link }) => <li key={holding.symbol}><div><span className={`chip ${link.type}`}>{holding.symbol}</span><strong className="mono">{money(holding.valueUsd)}</strong>{holdingShare(holding, totalValue) !== null && <span className="note mono">{percent(holdingShare(holding, totalValue))} of portfolio</span>}<span className="note">{linkLabel(link.type)}</span></div><p className="note">{link.evidence}</p>{describeImportance(link) && <p className="note driver-note">{describeImportance(link)!.text}</p>}</li>)}
            </ul></section>
        </div>}</td></tr>
    </>;
}

export function ExposureTable({ data }: { data: ExposureResponse }) {
    const [filters, setFilters] = useState<ExposureFilters>(defaultExposureFilters);
    const [view, setView] = useState<'event' | 'holding'>('event');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterId = useId();
    // The shared category choice narrows the table first; the table's own filters apply within it.
    const selection = useCategorySelection(), chosen = selectedSymbols(data.categories, selection);
    const inCategory = chosen ? data.holdings.filter(holding => chosen.has(holding.symbol)) : data.holdings;
    const events = filterExposure(selectEvents(data.events, data.categories, selection, false), filters);
    const holdings = filterExposureHoldings(inCategory, events, filters);
    const activeFilters = [Boolean(filters.holding), filters.link !== 'All', Boolean(filters.category), filters.days > 0].filter(Boolean).length;
    const changed = activeFilters > 0 || Boolean(filters.search) || filters.sort !== defaultExposureFilters.sort;
    function update<K extends keyof ExposureFilters>(key: K, value: ExposureFilters[K]) { setFilters(previous => ({ ...previous, [key]: value })); }
    return <>
        <div className="exposure-toolbar">
            <div className="toggle" aria-label="Exposure view"><button aria-pressed={view === 'event'} className={view === 'event' ? 'active' : ''} onClick={() => setView('event')}>By event</button><button aria-pressed={view === 'holding'} className={view === 'holding' ? 'active' : ''} onClick={() => setView('holding')}>By holding</button></div>
            <label className="search-control"><span className="sr-only">Search events or holdings</span><input type="search" placeholder="Search events or holdings…" value={filters.search} onChange={e => update('search', e.target.value)}/></label>
            <label className="sort-control"><span className="sr-only">Sort events</span><select aria-label="Sort events" value={filters.sort} onChange={e => update('sort', e.target.value as ExposureFilters['sort'])}><option value="reach-desc">Most portfolio reach</option><option value="reach-asc">Least portfolio reach</option><option value="date">Soonest close</option><option value="holdings">Most linked holdings</option><option value="name">Event name: A–Z</option></select></label>
            <button className="filter-toggle" aria-expanded={filtersOpen} aria-controls={filterId} onClick={() => setFiltersOpen(value => !value)}>Filters{activeFilters > 0 && <span className="filter-count">{activeFilters}</span>}<span className="disclosure-chevron" aria-hidden="true">›</span></button>
        </div>
        <div className="exposure-controls" id={filterId} hidden={!filtersOpen}>
            <label>Holding<select aria-label="Holding" value={filters.holding} onChange={e => update('holding', e.target.value)}><option value="">All holdings</option>{inCategory.map(h => <option key={h.symbol}>{h.symbol}</option>)}</select></label>
            <label>Link type<select aria-label="Link type" value={filters.link} onChange={e => update('link', e.target.value as ExposureFilters['link'])}><option>All</option><option value="Affected">Affected only</option><option>Direct</option><option>Calculated</option><option value="Measured">Related</option></select></label>
            <label>Category<select aria-label="Category" value={filters.category} onChange={e => update('category', e.target.value)}><option value="">All categories</option>{[...new Set(data.events.map(e => e.category))].sort().map(category => <option key={category}>{category}</option>)}</select></label>
            <label>Closes within<select aria-label="Closes within" value={filters.days} onChange={e => update('days', Number(e.target.value))}><option value={0}>Any date</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
        </div>
        <div className="exposure-result-bar"><p className="note" role="status">{events.length} of {data.events.length} events · {holdings.length} of {data.holdings.length} holdings{chosen ? ' · category filter on' : ''}{activeFilters > 0 ? ` · ${activeFilters} active ${activeFilters === 1 ? 'filter' : 'filters'}` : ''}</p>{changed && <button className="reset-filters" onClick={() => setFilters(defaultExposureFilters)}>Reset filters</button>}</div>
        {events.length ? view === 'holding' ? <ByHolding events={events} holdings={holdings} linkFilter={filters.link} ranks={data.byHolding} totalValue={data.totalValue}/> : <div className="scroll exposure-scroll" tabIndex={0} role="region" aria-label="Exposure table"><table className="exposure-table"><caption className="sr-only">Events with portfolio reach, selected outcome odds and holdings ordered by connection. Expand an event for values, trust and evidence.</caption><thead><tr><th scope="col" className="event-column">Event / close date</th><th scope="col" className="reach-column">Portfolio share</th><th scope="col" className="outcome-column">Outcome</th><th scope="col" className="holdings-column">Holdings <span className="muted">· all linked, strongest first</span></th></tr></thead><tbody>{events.map(event => <ExposureRow key={event.ticker} event={event} holdings={holdings} linkFilter={filters.link} totalValue={data.totalValue}/>)}</tbody></table></div> : <Empty>{data.events.length ? `No events match these filters. Try another search${chosen ? ', clear the category' : ''} or reset filters.` : 'No reviewed market links available. Holdings need supported company tags, measured driver links or a reviewed sector mapping.'}</Empty>}
    </>;
}

function ByHolding({ events, holdings, linkFilter, ranks, totalValue }: { events: ExposureEvent[]; holdings: Holding[]; linkFilter: ExposureFilters['link']; ranks: ExposureResponse['byHolding']; totalValue: number }) {
    return <>{holdings.map(holding => {
        const linked = events.filter(event => event.links.some(link => link.symbol === holding.symbol && matchesLink(link, linkFilter)));
        // The holding's most important measured driver is always shown, so a minor link is not mistaken for the main one.
        const drivers = ranks.find(rank => rank.symbol === holding.symbol)?.drivers ?? [];
        return <details className="holding-event-group" key={holding.symbol}><summary><strong>{holding.symbol}</strong><span className="mono muted">{money(holding.valueUsd)}{holdingShare(holding, totalValue) !== null && ` · ${percent(holdingShare(holding, totalValue))} of portfolio`}</span><span className="note">{linked.length} events</span>{drivers[0] && <span className="note driver-top">Moves most with <strong>{driverName(drivers[0].driver).toLowerCase()}</strong></span>}</summary><div>{drivers.length > 0 && <p className="driver-lead">{describeDrivers(drivers)}</p>}{linked.map(event => { const link = event.links.find(link => link.symbol === holding.symbol)!; return <p key={event.ticker}><LinkChip type={link.type}/> <a href={href('event', event.ticker)}>{event.title}</a></p>; })}</div></details>;
    })}</>;
}
