import type { ExposureEvent, HoldingLink, Trust } from '../../../shared/types';

export interface CalendarFilters {
    search: string;
    type: 'All' | 'Company' | 'Other';
    holding: string;
    category: string;
    link: 'All' | 'Affected' | 'Direct' | 'Measured';
    minShare: number;
    trust: 'All' | 'Unavailable' | NonNullable<Trust['band']>;
    sort: 'date' | 'date-desc' | 'reach' | 'holdings' | 'name';
}

export const defaultCalendarFilters: CalendarFilters = {
    search: '', type: 'All', holding: '', category: '', link: 'All',
    minShare: 0, trust: 'All', sort: 'date',
};

function matchesLink(link: HoldingLink, filter: CalendarFilters['link']) {
    return filter === 'All' || (filter === 'Affected' ? link.type === 'Direct' || link.type === 'Measured' : link.type === filter);
}

export function filterCalendarEvents(events: ExposureEvent[], filters: CalendarFilters): ExposureEvent[] {
    const search = filters.search.trim().toLowerCase();
    return events.filter(event => {
        const company = event.links.some(link => link.type === 'Direct');
        if (filters.type !== 'All' && (filters.type === 'Company') !== company) return false;
        if (filters.category && event.category !== filters.category) return false;
        if (event.share < filters.minShare) return false;
        // The selected holding must itself have the selected connection type.
        if ((filters.holding || filters.link !== 'All') && !event.links.some(link =>
            (!filters.holding || link.symbol === filters.holding) && matchesLink(link, filters.link))) return false;
        if (filters.trust !== 'All' && !event.markets.some(market => filters.trust === 'Unavailable'
            ? market.trust.total === null
            : market.trust.total !== null && market.trust.band === filters.trust)) return false;
        if (search && ![event.title, event.ticker, event.category, ...event.links.map(link => link.symbol),
            ...event.markets.flatMap(market => [market.title, market.subtitle, market.ticker])]
            .some(text => text.toLowerCase().includes(search))) return false;
        return true;
    }).sort((a, b) => {
        const dateOrder = Date.parse(a.closeTime) - Date.parse(b.closeTime);
        switch (filters.sort) {
            case 'date-desc': return -dateOrder || a.ticker.localeCompare(b.ticker);
            case 'reach': return b.share - a.share || dateOrder || a.ticker.localeCompare(b.ticker);
            case 'holdings': return new Set(b.links.map(link => link.symbol)).size - new Set(a.links.map(link => link.symbol)).size || dateOrder || a.ticker.localeCompare(b.ticker);
            case 'name': return a.title.localeCompare(b.title) || dateOrder || a.ticker.localeCompare(b.ticker);
            default: return dateOrder || a.ticker.localeCompare(b.ticker);
        }
    });
}
