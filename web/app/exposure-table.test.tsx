import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExposureTable, filterExposure, filterExposureHoldings, eventHoldings, defaultExposureFilters } from './screens/exposure-table';
import type { ExposureEvent, ExposureResponse, LinkType } from '../../shared/types';
const event = (title: string, share: number, symbol: string, type: LinkType): ExposureEvent => ({
    ticker: title, title, share, linkedValue: share * 1000, closeTime: '2026-10-20T12:00:00Z', category: 'Economics', mutuallyExclusive: true,
    links: [{ symbol, valueUsd: share * 1000, type, sensitivity: null, evidence: 'Test evidence' }],
    markets: ['Above', 'Below'].map(subtitle => ({ ticker: `${title}-${subtitle}`, title, subtitle, probability: .5, spread: .02, kind: 'bracket', asOf: null,
        trust: { total: 50, band: 'Low', spread: 20, activity: 10, depth: 7.5, trackRecord: null, categoryCount: 0, spreadCents: 2 } }))
});
const events = [event('Oil', .6, 'DAL', 'Measured'), event('Apple', .3, 'AAPL', 'Direct'), event('Jobs', .1, 'JPM', 'Related')];
const holdings = [{ symbol: 'DAL', valueUsd: 600 }, { symbol: 'AAPL', valueUsd: 300 }, { symbol: 'JPM', valueUsd: 100 }];
it('searches by holding, event and outcome and combines link and holding filters', () => {
    expect(filterExposure(events, { ...defaultExposureFilters, search: 'aapl' }).map(e => e.title)).toEqual(['Apple']);
    expect(filterExposure(events, { ...defaultExposureFilters, search: 'oil', link: 'Measured' }).map(e => e.title)).toEqual(['Oil']);
    expect(filterExposure(events, { ...defaultExposureFilters, search: 'below' })).toHaveLength(2);
    expect(filterExposure(events, { ...defaultExposureFilters, holding: 'AAPL', link: 'Measured' })).toEqual([]);
    expect(filterExposure(events, { ...defaultExposureFilters, search: 'Jobs' })).toEqual([]);
});
it('keeps only Direct or Measured events and holdings when filtering affected holdings', () => {
    const mixed = { ...events[0], links: [...events[0].links, events[2].links[0]] };
    const source = [mixed, ...events.slice(1)];
    const filters = { ...defaultExposureFilters, link: 'Affected' as const };
    const filtered = filterExposure(source, filters);
    expect(filtered.map(e => e.title)).toEqual(['Oil', 'Apple']);
    expect(filterExposureHoldings(holdings, filtered, filters).map(h => h.symbol)).toEqual(['DAL', 'AAPL']);
    expect(filterExposure(source, { ...filters, holding: 'JPM' })).toEqual([]);
    expect(filterExposure(source, { ...filters, search: 'JPM' })).toEqual([]);
    const apple = filterExposure(source, { ...filters, search: 'Apple' });
    expect(filterExposureHoldings(holdings, apple, filters).map(h => h.symbol)).toEqual(['AAPL']);
    expect(filtered[0].share).toBe(mixed.share);
    expect(mixed.links).toHaveLength(2);
    expect(filterExposureHoldings(holdings, filtered, defaultExposureFilters).map(h => h.symbol)).toEqual(['DAL', 'AAPL']);
});
it('orders holdings separately per event and applies affected-only to each row', () => {
    const mixed = { ...events[0], links: events.flatMap(event => event.links) };
    const portfolio = [...holdings, { symbol: 'MSFT', valueUsd: 10000 }];
    const symbols = (rows: ReturnType<typeof eventHoldings>) => rows.map(row => row.holding.symbol);
    expect(symbols(eventHoldings(mixed, portfolio, 'All'))).toEqual(['AAPL', 'DAL']);
    expect(symbols(eventHoldings(events[0], portfolio, 'All'))).toEqual(['DAL']);
    expect(symbols(eventHoldings(mixed, portfolio, 'Affected'))).toEqual(['AAPL', 'DAL']);
    expect(symbols(eventHoldings(events[0], portfolio, 'Affected'))).toEqual(['DAL']);
    expect(symbols(eventHoldings(mixed, portfolio, 'Measured'))).toEqual(['DAL']);
    expect(eventHoldings(mixed, portfolio, 'All').some(row => row.link?.type === 'Related')).toBe(false);
    expect(portfolio.map(h => h.symbol)).toEqual(['DAL', 'AAPL', 'JPM', 'MSFT']);
});
it('sorts by full-portfolio reach without mutating or recalculating source data', () => {
    const sorted = filterExposure(events, { ...defaultExposureFilters, sort: 'reach-asc' });
    expect(sorted.map(e => e.share)).toEqual([.3, .6]);
    expect(events.map(e => e.share)).toEqual([.6, .3, .1]);
    expect(filterExposure(events, { ...defaultExposureFilters, days: 14 }, Date.parse('2026-10-01'))).toEqual([]);
});
it('renders compact event rows with outcome controls and accessible holding values', () => {
    const data = { events, holdings, byHolding: [], totalValue: 1000, asOf: null } as ExposureResponse;
    const html = renderToStaticMarkup(<ExposureTable data={data}/>);
    expect(html).toContain('scope="row"');
    expect(html).toContain('Outcome for Oil');
    expect(html).toContain('cell Measured');
    expect(html).toContain('cell Direct');
    expect(html).not.toContain('cell Related');
    expect(html).not.toContain('Not measured');
    expect(html).toContain('<option value="Measured">Related</option>');
    expect(html).toContain('60.0%');
    expect(html.match(/scope="col"/g)).toHaveLength(4);
    expect(html.split('<thead>')[1].split('</thead>')[0]).not.toContain('AAPL');
    expect(html).toContain('aria-label="DAL: Oil, Related, $600.00"');
    expect(html).toContain('aria-label="AAPL: Apple, Direct, $300.00"');
    expect(html).not.toContain('aria-label="JPM: Jobs, Related, $100.00"');
    expect(html).not.toContain('no supported link');
    expect(html).not.toContain('cell blank');
    expect(html).not.toContain('holding-expander');
    expect(html).toContain('scroll horizontally for more');
    expect(html).toContain('<strong>DAL</strong><span class="holding-value">$600.00</span>');
    expect(html).toContain('<strong>AAPL</strong><span class="holding-value">$300.00</span>');
    expect(html).toContain('aria-label="Show details for Oil"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="exposure-detail-row" hidden=""');
    expect(html).not.toContain('class="exposure-detail-grid"');
});

it('keeps missing outcome odds unavailable in compact rows', () => {
    const source = { ...events[0], markets: events[0].markets.map(market => ({ ...market, probability: null })) };
    const html = renderToStaticMarkup(<ExposureTable data={{ events: [source], holdings, totalValue: 1000, byHolding: [], asOf: null }}/>);
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('0.0% yes');
    expect(html).not.toContain('Unavailable yes');
});
