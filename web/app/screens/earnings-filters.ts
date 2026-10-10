import type { EarningsResponse, ExposureEvent, ExposureResponse, Market } from '../../../shared/types';

export interface EarningsFilters {
    search: string;
    kind: 'All' | Market['kind'];
    trust: 'All' | 'Unavailable' | NonNullable<Market['trust']['band']>;
    quotes: 'All' | 'Available' | 'Unavailable';
    category: string;
    days: number;
    sort: 'date' | 'date-desc' | 'trust' | 'probability-desc' | 'probability-asc' | 'name';
}
export const defaultEarningsFilters: EarningsFilters = { search: '', kind: 'All', trust: 'All', quotes: 'All', category: '', days: 0, sort: 'date' };
export interface EarningsRow {
    event: ExposureEvent;
    market: Market;
    ladder: EarningsResponse['ladders'][number] | null;
    scaledProbability: number | null;
}

export function earningsCompanies(data: ExposureResponse, search = '') {
    const term = search.trim().toLowerCase();
    return data.holdings.flatMap(holding => {
        const events = data.events.filter(event => event.links.some(link => link.symbol === holding.symbol && link.type === 'Direct'));
        if (!events.length || term && ![holding.symbol, ...events.map(event => event.title)].some(text => text.toLowerCase().includes(term))) return [];
        return [{ ...holding, marketCount: events.reduce((sum, event) => sum + event.markets.length, 0) }];
    }).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function earningsRows(data: EarningsResponse): EarningsRow[] {
    return data.events.flatMap(event => {
        const ladder = data.ladders.find(ladder => ladder.eventTicker === event.ticker) ?? null;
        return event.markets.map(market => ({ event, market, ladder,
            scaledProbability: ladder?.outcomes.find(outcome => outcome.ticker === market.ticker)?.probability ?? null }));
    });
}

export function filterEarningsRows(rows: EarningsRow[], filters: EarningsFilters, now = Date.now()) {
    const term = filters.search.trim().toLowerCase();
    // Each filter must match the same outcome. Server-supplied ladder shares stay unchanged.
    return rows.filter(({ event, market }) => {
        if (filters.kind !== 'All' && market.kind !== filters.kind) return false;
        if (filters.trust !== 'All' && (filters.trust === 'Unavailable' ? market.trust.total !== null : market.trust.total === null || market.trust.band !== filters.trust)) return false;
        if (filters.quotes !== 'All' && (filters.quotes === 'Available') !== (market.probability !== null)) return false;
        if (filters.category && event.category !== filters.category) return false;
        if (filters.days && !(Date.parse(event.eventTime) >= now && Date.parse(event.eventTime) <= now + filters.days * 86400000)) return false;
        return !term || [event.title, event.ticker, event.category, market.title, market.subtitle, market.ticker].some(text => text.toLowerCase().includes(term));
    }).sort((a, b) => {
        const date = Date.parse(a.event.eventTime) - Date.parse(b.event.eventTime);
        let order = 0;
        // Missing values always come last, including when sorting ascending.
        const compareNullable = (x: number | null, y: number | null, descending = true) => x === null ? y === null ? 0 : 1 : y === null ? -1 : descending ? y - x : x - y;
        switch (filters.sort) {
            case 'date': order = date; break;
            case 'date-desc': order = -date; break;
            case 'trust': order = compareNullable(a.market.trust.total, b.market.trust.total); break;
            case 'probability-desc': order = compareNullable(a.market.probability, b.market.probability); break;
            case 'probability-asc': order = compareNullable(a.market.probability, b.market.probability, false); break;
            case 'name': order = (a.market.subtitle || a.market.title).localeCompare(b.market.subtitle || b.market.title); break;
        }
        return order || date || a.event.ticker.localeCompare(b.event.ticker) || a.market.ticker.localeCompare(b.market.ticker);
    });
}
