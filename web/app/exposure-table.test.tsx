import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExposureTable, filterExposure, defaultExposureFilters } from './screens/exposure-table';
import type { ExposureEvent, ExposureResponse, LinkType } from '../../shared/types';
const event = (title: string, share: number, symbol: string, type: LinkType): ExposureEvent => ({
    ticker: title, title, share, linkedValue: share * 1000, closeTime: '2026-10-20T12:00:00Z', category: 'Economics', mutuallyExclusive: true,
    links: [{ symbol, valueUsd: share * 1000, type, sensitivity: null, evidence: 'Test evidence' }],
    markets: ['Above', 'Below'].map(subtitle => ({ ticker: `${title}-${subtitle}`, title, subtitle, probability: .5, spread: .02, kind: 'bracket', asOf: null,
        trust: { total: 50, band: 'Low', spread: 20, activity: 10, depth: 7.5, trackRecord: null, categoryCount: 0, spreadCents: 2 } }))
});
const events = [event('Oil', .6, 'DAL', 'Measured'), event('Apple', .3, 'AAPL', 'Direct'), event('Jobs', .1, 'JPM', 'Related')];
it('searches by holding, event and outcome and combines link and holding filters', () => {
    expect(filterExposure(events, { ...defaultExposureFilters, search: 'aapl' }).map(e => e.title)).toEqual(['Apple']);
    expect(filterExposure(events, { ...defaultExposureFilters, search: 'oil', link: 'Measured' }).map(e => e.title)).toEqual(['Oil']);
    expect(filterExposure(events, { ...defaultExposureFilters, search: 'below' })).toHaveLength(3);
    expect(filterExposure(events, { ...defaultExposureFilters, holding: 'AAPL', link: 'Measured' })).toEqual([]);
    expect(filterExposure(events, { ...defaultExposureFilters, link: 'Related' }).map(e => e.title)).toEqual(['Jobs']);
});
it('sorts by full-portfolio reach without mutating or recalculating source data', () => {
    const sorted = filterExposure(events, { ...defaultExposureFilters, sort: 'reach-asc' });
    expect(sorted.map(e => e.share)).toEqual([.1, .3, .6]);
    expect(events.map(e => e.share)).toEqual([.6, .3, .1]);
    expect(filterExposure(events, { ...defaultExposureFilters, days: 14 }, Date.parse('2026-10-01'))).toEqual([]);
});
it('renders events as rows, holdings as columns, and labelled outcome dropdowns', () => {
    const data = { events, holdings: [{ symbol: 'DAL', valueUsd: 600 }, { symbol: 'AAPL', valueUsd: 300 }, { symbol: 'JPM', valueUsd: 100 }], byHolding: [], totalValue: 1000, asOf: null } as ExposureResponse;
    const html = renderToStaticMarkup(<ExposureTable data={data}/>);
    expect(html).toContain('scope="row"');
    expect(html).toContain('Outcome for Oil');
    expect(html).toContain('cell Measured');
    expect(html).toContain('cell Direct');
    expect(html).toContain('cell Related');
    expect(html).toContain('60.0%');
    expect(html).toContain('No link');
});
