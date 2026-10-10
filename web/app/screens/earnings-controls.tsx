'use client';
import { useId, useState } from 'react';
import { Card } from '../common';
import type { EarningsFilters } from './earnings-filters';

export function EarningsControls({ filters, categories, onChange, onReset }: {
    filters: EarningsFilters; categories: string[];
    onChange: <K extends keyof EarningsFilters>(key: K, value: EarningsFilters[K]) => void;
    onReset: () => void;
}) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const active = [filters.kind !== 'All', filters.trust !== 'All', filters.quotes !== 'All', Boolean(filters.category), filters.days > 0].filter(Boolean).length;
    return <Card className="earnings-filters">
        <div className="earnings-toolbar">
            <label>Search outcomes<input type="search" placeholder="Event, outcome or market ticker…" value={filters.search} onChange={event => onChange('search', event.target.value)}/></label>
            <label>Sort outcomes<select value={filters.sort} onChange={event => onChange('sort', event.target.value as EarningsFilters['sort'])}><option value="date">Soonest event close</option><option value="date-desc">Latest event close</option><option value="trust">Highest trust</option><option value="probability-desc">Highest raw midpoint</option><option value="probability-asc">Lowest raw midpoint</option><option value="name">Outcome name: A–Z</option></select></label>
            <button className="filter-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>More filters{active > 0 && <span className="filter-count">{active}</span>}<span className="disclosure-chevron" aria-hidden="true">›</span></button>
        </div>
        <div className="earnings-filter-grid" id={id} hidden={!open}>
            <label>Market type<select value={filters.kind} onChange={event => onChange('kind', event.target.value as EarningsFilters['kind'])}><option value="All">All types</option><option value="bracket">Bracket / range</option><option value="mention">Call mentions</option><option value="kpi">Other company markets</option></select></label>
            <label>Outcome trust<select value={filters.trust} onChange={event => onChange('trust', event.target.value as EarningsFilters['trust'])}><option value="All">Any trust score</option><option>High</option><option>Medium</option><option>Low</option><option value="Unavailable">Trust unavailable</option></select></label>
            <label>Quote availability<select value={filters.quotes} onChange={event => onChange('quotes', event.target.value as EarningsFilters['quotes'])}><option value="All">All outcomes</option><option value="Available">Midpoint available</option><option value="Unavailable">Midpoint unavailable</option></select></label>
            <label>Category<select value={filters.category} onChange={event => onChange('category', event.target.value)}><option value="">All categories</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
            <label>Event closes within<select value={filters.days} onChange={event => onChange('days', Number(event.target.value))}><option value={0}>All future dates</option><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option><option value={90}>Next 90 days</option></select></label>
        </div>
        {(active > 0 || filters.search || filters.sort !== 'date') && <div className="earnings-filter-status"><span className="note">{active > 0 ? `${active} additional ${active === 1 ? 'filter' : 'filters'} active` : 'Search or sort applied'}</span><button className="reset-filters" onClick={onReset}>Reset filters</button></div>}
    </Card>;
}
