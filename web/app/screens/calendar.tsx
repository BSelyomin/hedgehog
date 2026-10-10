'use client';
import { useId, useRef, useState } from 'react';
import type { CalendarResponse, ExposureResponse } from '../../../shared/types';
import { percent, href, useData, Card, Fresh, Status, Empty, Progress, EventList } from '../common';
import { defaultCalendarFilters, filterCalendarEvents, type CalendarFilters } from './calendar-filters';

export function Calendar() {
    const [days, setDays] = useState(14);
    const [filters, setFilters] = useState<CalendarFilters>(defaultCalendarFilters);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const listHeading = useRef<HTMLHeadingElement>(null);
    const filtersId = useId();
    const { data, error } = useData<CalendarResponse | ExposureResponse>(days ? `/calendar?days=${days}` : '/exposure');
    const events = filterCalendarEvents(data?.events ?? [], filters);
    const pageCount = Math.max(1, Math.ceil(events.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const firstIndex = (currentPage - 1) * pageSize;
    const pageEvents = events.slice(firstIndex, firstIndex + pageSize);
    const windowLabel = days === 1 ? 'the next 24 hours' : days ? `the next ${days} days` : 'all future dates';
    // Keep a selected option visible when a narrower date range has no matches.
    const holdings = [...new Set([filters.holding, ...(data?.events.flatMap(event => event.links.map(link => link.symbol)) ?? [])])].filter(Boolean).sort();
    const categories = [...new Set([filters.category, ...(data?.events.map(event => event.category) ?? [])])].filter(Boolean).sort();
    const activeFilters = [Boolean(filters.holding), Boolean(filters.category), filters.link !== 'All', filters.minShare > 0, filters.trust !== 'All'].filter(Boolean).length;
    const changed = activeFilters > 0 || filters.search !== '' || filters.type !== 'All' || filters.sort !== 'date' || days !== 14;
    function update<K extends keyof CalendarFilters>(key: K, value: CalendarFilters[K]) { setFilters(previous => ({ ...previous, [key]: value })); setPage(1); }
    function reset() { setFilters(defaultCalendarFilters); setDays(14); setPage(1); }
    function changePage(next: number) {
        setPage(Math.max(1, Math.min(next, pageCount)));
        listHeading.current?.focus({ preventScroll: true });
        listHeading.current?.scrollIntoView({ block: 'start' });
    }
    return <>
        <h1>Event calendar</h1><p>Explore the events linked to your holdings by event date and portfolio reach.</p>
        <Card className="calendar-filters">
            <div className="calendar-toolbar">
                <label>Search events or holdings<input type="search" placeholder="Event, outcome, category or ticker…" value={filters.search} onChange={event => update('search', event.target.value)}/></label>
                <label>Date range<select aria-label="Calendar date range" value={days} onChange={event => { setDays(Number(event.target.value)); setPage(1); }}>
                    <option value={1}>Next 24 hours</option><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option><option value={90}>Next 90 days</option><option value={0}>All future dates</option>
                </select></label>
                <label>Sort events<select value={filters.sort} onChange={event => update('sort', event.target.value as CalendarFilters['sort'])}>
                    <option value="date">Soonest event</option><option value="date-desc">Latest event</option><option value="reach">Most portfolio reach</option><option value="holdings">Most linked holdings</option><option value="name">Event name: A–Z</option>
                </select></label>
            </div>
            <div className="calendar-filter-actions">
                <div className="toggle" role="group" aria-label="Event type">{(['All', 'Company', 'Other'] as const).map(type => <button key={type} onClick={() => update('type', type)} aria-pressed={filters.type === type} className={filters.type === type ? 'active' : ''}>{type === 'Other' ? 'Other events' : type}</button>)}</div>
                <button className="filter-toggle" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(value => !value)}>More filters{activeFilters > 0 && <span className="filter-count">{activeFilters}</span>}<span className="disclosure-chevron" aria-hidden="true">›</span></button>
            </div>
            <div className="calendar-filter-grid" id={filtersId} hidden={!filtersOpen}>
                <label>Holding<select value={filters.holding} onChange={event => update('holding', event.target.value)}><option value="">All holdings</option>{holdings.map(symbol => <option key={symbol}>{symbol}</option>)}</select></label>
                <label>Category<select value={filters.category} onChange={event => update('category', event.target.value)}><option value="">All categories</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
                <label>Connection type<select value={filters.link} onChange={event => update('link', event.target.value as CalendarFilters['link'])}><option value="All">All links</option><option value="Affected">Affected only</option><option value="Direct">Direct</option><option value="Calculated">Calculated</option><option value="Measured">Related</option></select></label>
                <label>Minimum portfolio share<select value={filters.minShare} onChange={event => update('minShare', Number(event.target.value))}><option value={0}>Any share</option><option value={0.1}>At least 10%</option><option value={0.25}>At least 25%</option><option value={0.5}>At least 50%</option><option value={0.75}>At least 75%</option></select></label>
                <label>Outcome trust<select value={filters.trust} onChange={event => update('trust', event.target.value as CalendarFilters['trust'])}><option value="All">Any trust score</option><option>High</option><option>Medium</option><option>Low</option><option value="Unavailable">Trust unavailable</option></select></label>
                <p className="note calendar-filter-help">Red = Direct; green = Calculated from a holding’s own terms; blue = Related, backed by historical measurements. Affected only includes all three. With a holding selected, its own link must match. Trust matches when at least one outcome has that rating; open the event to see each outcome’s score.</p>
            </div>
            <div className="calendar-results">
                <p className="note" role="status">{data ? `Showing ${events.length} of ${data.events.length} linked events in ${windowLabel}.${activeFilters ? ` ${activeFilters} additional ${activeFilters === 1 ? 'filter' : 'filters'} active.` : ''}` : `Date range: ${windowLabel}.`}</p>
                {changed && <button className="reset-filters" onClick={reset}>Reset filters</button>}
            </div>
        </Card>
        <p className="note">Events are placed on the date Kalshi expects them to happen; when it gives none, on the market close. Overview counts all future dates. Choose All future dates here to use the same range. Company events have a direct holding link; other events include macro, politics and other categories. Portfolio share always uses your full portfolio.</p>
        <Status error={error} loading={!data && !error}/><Fresh asOf={data?.asOf ?? null}/>
        <div className="split calendar-content">
            <Card className="calendar-events"><h2 ref={listHeading} tabIndex={-1}>Upcoming events</h2>
                <div className="calendar-page-settings"><p className="note" role="status">{events.length ? `Events ${firstIndex + 1}–${firstIndex + pageEvents.length} of ${events.length}` : '0 events'}</p>
                    <label>Events per page<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>
                </div>
                {pageCount > 1 && <CalendarPagination page={currentPage} pageCount={pageCount} onPageChange={changePage} position="top"/>}
                {events.length ? <EventList events={pageEvents} showYear/> : data && <Empty>No linked events match these filters. Try resetting the filters or widening the date range.</Empty>}
                {pageCount > 1 && <CalendarPagination page={currentPage} pageCount={pageCount} onPageChange={changePage} position="bottom"/>}
            </Card>
            <Card className="calendar-biggest"><h2>Biggest events for you</h2><p className="note">Ranked by share of portfolio linked, using your current filters.</p>
                {[...events].sort((a, b) => b.share - a.share || Date.parse(a.eventTime) - Date.parse(b.eventTime)).slice(0, 6).map(event => <div className="event-row" key={event.ticker}><a href={href('event', event.ticker)}>{event.title}</a><p className="mono">{percent(event.share)}</p><Progress value={event.share}/></div>)}
                {data && !events.length && <Empty>No matching events to rank.</Empty>}
                <p className="note">Dates use Kalshi’s own event time where it gives one, otherwise the market close. Each event says which.</p>
            </Card>
        </div>
    </>;
}

function CalendarPagination({ page, pageCount, onPageChange, position }: {
    page: number; pageCount: number; onPageChange: (page: number) => void; position: 'top' | 'bottom';
}) {
    return <nav className="calendar-pagination" aria-label={`Calendar pages (${position})`}>
        <button disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        <label>Page<select aria-label={`Calendar page (${position})`} value={page} onChange={event => onPageChange(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select><span>of {pageCount}</span></label>
        <button disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>Next</button>
    </nav>;
}
