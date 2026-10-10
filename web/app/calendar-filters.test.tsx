import { describe, expect, it } from 'vitest';
import type { ExposureEvent, HoldingLink, Market } from '../../shared/types';
import { defaultCalendarFilters, filterCalendarEvents, type CalendarFilters } from './screens/calendar-filters';

function link(symbol: string, type: HoldingLink['type']): HoldingLink {
    return { symbol, type, valueUsd: 100, evidence: 'Test evidence', sensitivity: null };
}
function market(band: Market['trust']['band'], total: number | null): Market {
    return {
        ticker: `TEST-${band}`, title: 'Test outcome', subtitle: 'Above the threshold', probability: null, spread: null, asOf: null, kind: 'kpi',
        trust: { band, total, spread: null, activity: null, depth: null, trackRecord: null, categoryCount: 0, spreadCents: null },
    };
}
const events: ExposureEvent[] = [
    { ticker: 'COMPANY', title: 'Apple report', category: 'Companies', closeTime: '2026-11-03T00:00:00Z', eventTime: '2026-11-03T00:00:00Z', eventTimeSource: 'close', share: 0.25, linkedValue: 200,
        links: [link('AAPL', 'Direct'), link('MSFT', 'Related')], markets: [market('Low', 0), market('High', 85)], mutuallyExclusive: false },
    { ticker: 'ECONOMY', title: 'Inflation release', category: 'Economics', closeTime: '2026-11-01T00:00:00Z', eventTime: '2026-11-01T00:00:00Z', eventTimeSource: 'close', share: 0.75, linkedValue: 300,
        links: [link('AAPL', 'Measured'), link('SPY', 'Measured'), link('MSFT', 'Related')], markets: [market('Medium', 65)], mutuallyExclusive: false },
    { ticker: 'POLICY', title: 'Tax bill vote', category: 'Politics', closeTime: '2026-11-02T00:00:00Z', eventTime: '2026-11-02T00:00:00Z', eventTimeSource: 'close', share: 0.1, linkedValue: 100,
        links: [link('MSFT', 'Related')], markets: [market(null, null)], mutuallyExclusive: false },
];
const filter = (overrides: Partial<CalendarFilters> = {}) => filterCalendarEvents(events, { ...defaultCalendarFilters, ...overrides });
const tickers = (overrides: Partial<CalendarFilters>) => filter(overrides).map(event => event.ticker);

describe('calendar filters', () => {
    it('matches holding and connection on the same link, not separate holdings', () => {
        expect(tickers({ holding: 'AAPL', link: 'Direct' })).toEqual(['COMPANY']);
        expect(tickers({ holding: 'MSFT', link: 'Direct' })).toEqual([]);
        expect(tickers({ holding: 'MSFT', link: 'Affected' })).toEqual([]);
        expect(tickers({ holding: 'AAPL', link: 'Measured' })).toEqual(['ECONOMY']);
    });
    it('keeps unmeasured links in All, but excludes them from Affected only', () => {
        expect(tickers({})).toEqual(['ECONOMY', 'POLICY', 'COMPANY']);
        expect(tickers({ link: 'Affected' })).toEqual(['ECONOMY', 'COMPANY']);
    });
    it('combines exact category and inclusive minimum portfolio share', () => {
        expect(tickers({ category: 'Companies', minShare: 0.25 })).toEqual(['COMPANY']);
        expect(tickers({ category: 'Companies', minShare: 0.5 })).toEqual([]);
        expect(tickers({ minShare: 0.75 })).toEqual(['ECONOMY']);
    });
    it('matches any outcome trust and never treats unavailable trust as zero', () => {
        expect(tickers({ trust: 'High' })).toEqual(['COMPANY']);
        expect(tickers({ trust: 'Low' })).toEqual(['COMPANY']);
        expect(tickers({ trust: 'Medium' })).toEqual(['ECONOMY']);
        expect(tickers({ trust: 'Unavailable' })).toEqual(['POLICY']);
    });
    it('searches titles, holdings, category, event ticker and outcomes without case sensitivity', () => {
        expect(tickers({ search: ' apple ' })).toEqual(['COMPANY']);
        expect(tickers({ search: 'aapl' })).toEqual(['ECONOMY', 'COMPANY']);
        expect(tickers({ search: 'politics' })).toEqual(['POLICY']);
        expect(tickers({ search: 'economy' })).toEqual(['ECONOMY']);
        expect(tickers({ search: 'threshold' })).toHaveLength(3);
        expect(tickers({ search: 'test-high' })).toEqual(['COMPANY']);
    });
    it('separates company links from other events without calling politics macro', () => {
        expect(tickers({ type: 'Company' })).toEqual(['COMPANY']);
        expect(tickers({ type: 'Other' })).toEqual(['ECONOMY', 'POLICY']);
        expect(tickers({ type: 'Other', category: 'Politics' })).toEqual(['POLICY']);
    });
    it('sorts the selected events while preserving source values and ordering', () => {
        const original = structuredClone(events);
        expect(tickers({ sort: 'date-desc' })).toEqual(['COMPANY', 'POLICY', 'ECONOMY']);
        expect(tickers({ sort: 'reach' })).toEqual(['ECONOMY', 'COMPANY', 'POLICY']);
        expect(tickers({ sort: 'holdings' })).toEqual(['ECONOMY', 'COMPANY', 'POLICY']);
        expect(tickers({ sort: 'name' })).toEqual(['COMPANY', 'ECONOMY', 'POLICY']);
        expect(filter({ holding: 'AAPL' }).find(event => event.ticker === 'COMPANY')).toBe(events[0]);
        expect(events).toEqual(original);
    });
});
