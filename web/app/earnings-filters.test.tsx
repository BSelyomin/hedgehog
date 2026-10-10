import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EarningsResponse, ExposureEvent, ExposureResponse, Market } from '../../shared/types';
import { defaultEarningsFilters, earningsCompanies, earningsRows, filterEarningsRows, type EarningsFilters } from './screens/earnings-filters';
import { EarningsHistory, EarningsMarkets, EarningsOutcome } from './screens/earnings';

function market(ticker: string, kind: Market['kind'], probability: number | null, band: Market['trust']['band'], total: number | null): Market {
    return { ticker, title: `Test ${ticker}`, subtitle: ticker, kind, probability, spread: null, asOf: null,
        trust: { total, band, spread: null, activity: null, depth: null, trackRecord: null, categoryCount: 0, spreadCents: null } };
}
const range: ExposureEvent = { ticker: 'RANGE', title: 'Apple revenue ranges', category: 'Companies', closeTime: '2026-11-03T00:00:00Z', eventTime: '2026-11-03T00:00:00Z', eventTimeSource: 'close', share: .5, linkedValue: 100,
    links: [{ symbol: 'AAPL', valueUsd: 100, type: 'Direct', evidence: 'Company tag', sensitivity: null }], mutuallyExclusive: true,
    markets: [market('LOWER', 'bracket', .2, 'Low', 0), market('UPPER', 'bracket', .4, 'High', 85)] };
const calls: ExposureEvent = { ...range, ticker: 'CALL', title: 'Apple call topics', category: 'Mentions', closeTime: '2026-12-15T00:00:00Z', eventTime: '2026-12-01T00:00:00Z', eventTimeSource: 'occurrence', mutuallyExclusive: false,
    markets: [market('AI', 'mention', null, 'High', 90), market('GROWTH', 'kpi', 0, null, null)] };
const data: EarningsResponse = { symbol: 'AAPL', events: [range, calls], asOf: null,
    ladders: [{ eventTicker: range.ticker, rawSum: .6, outcomes: [{ ticker: 'LOWER', title: 'LOWER', probability: 1 / 3 }, { ticker: 'UPPER', title: 'UPPER', probability: 2 / 3 }] }],
    history: null, historyNote: 'Historical report dates unavailable.', name: null, position: null, call: null, featured: null, metrics: [], typicalMove: null };
const now = Date.parse('2026-11-01T00:00:00Z');
const filter = (overrides: Partial<EarningsFilters> = {}) => filterEarningsRows(earningsRows(data), { ...defaultEarningsFilters, ...overrides }, now);
const tickers = (overrides: Partial<EarningsFilters>) => filter(overrides).map(row => row.market.ticker);

describe('earnings filters', () => {
    it('only lists held companies with direct links, with search by ticker and company event', () => {
        const exposure = { events: data.events, holdings: [{ symbol: 'AAPL', valueUsd: 100 }, { symbol: 'MSFT', valueUsd: 100 }] } as ExposureResponse;
        expect(earningsCompanies(exposure, ' apple ')).toEqual([{ symbol: 'AAPL', valueUsd: 100, marketCount: 4 }]);
        expect(earningsCompanies(exposure, 'msft')).toEqual([]);
        expect(earningsCompanies(exposure, 'aapl')).toHaveLength(1);
    });
    it('combines type, trust, quote and search on the same outcome', () => {
        expect(tickers({ kind: 'bracket', trust: 'High', quotes: 'Available', search: 'upper' })).toEqual(['UPPER']);
        expect(tickers({ kind: 'bracket', trust: 'High', search: 'lower' })).toEqual([]);
        expect(tickers({ kind: 'mention', quotes: 'Available' })).toEqual([]);
    });
    it('distinguishes zero midpoint and zero trust from missing data', () => {
        expect(tickers({ quotes: 'Unavailable' })).toEqual(['AI']);
        expect(tickers({ quotes: 'Available', trust: 'Unavailable' })).toEqual(['GROWTH']);
        expect(tickers({ trust: 'Low' })).toEqual(['LOWER']);
    });
    it('filters event date windows and category together, using the event date rather than the later market close', () => {
        expect(tickers({ days: 7 })).toEqual(['LOWER', 'UPPER']);
        expect(tickers({ days: 7, category: 'Mentions' })).toEqual([]);
        expect(tickers({ days: 30, category: 'Mentions' })).toEqual(['AI', 'GROWTH']);
    });
    it('searches event titles, category and ticker as well as outcomes', () => {
        expect(tickers({ search: ' APPLE ' })).toHaveLength(4);
        expect(tickers({ search: 'mentions' })).toEqual(['AI', 'GROWTH']);
        expect(tickers({ search: 'range' })).toEqual(['LOWER', 'UPPER']);
        expect(tickers({ search: 'missing' })).toEqual([]);
    });
    it('sorts raw probabilities and trust with unavailable values last', () => {
        expect(tickers({ sort: 'probability-asc' })).toEqual(['GROWTH', 'LOWER', 'UPPER', 'AI']);
        expect(tickers({ sort: 'probability-desc' })).toEqual(['UPPER', 'LOWER', 'GROWTH', 'AI']);
        expect(tickers({ sort: 'trust' })).toEqual(['AI', 'UPPER', 'LOWER', 'GROWTH']);
        expect(tickers({ sort: 'date-desc' })).toEqual(['AI', 'GROWTH', 'LOWER', 'UPPER']);
    });
    it('preserves the full server ladder after filtering and pagination', () => {
        const original = structuredClone(data);
        const row = filter({ trust: 'High', quotes: 'Available' }).slice(0, 1)[0];
        expect(row.scaledProbability).toBeCloseTo(2 / 3);
        expect(row.ladder?.rawSum).toBe(.6);
        expect(row.ladder?.outcomes).toHaveLength(2);
        expect(row.market.probability).toBe(.4);
        expect(data).toEqual(original);
        const html = renderToStaticMarkup(<EarningsOutcome row={row}/>);
        expect(html).toContain('66.7%');
        expect(html).toContain('40.0%');
        expect(html).toContain('60.0%');
        expect(html).toContain('Scaled bracket share');
    });
    it('renders missing quotes honestly and initially limits long lists to ten outcomes', () => {
        const missing = filter({ quotes: 'Unavailable' })[0];
        const html = renderToStaticMarkup(<EarningsOutcome row={missing}/>);
        expect(html).toContain('Unavailable');
        expect(html).not.toContain('0.0%');
        const many = { ...data, ladders: [], events: [{ ...range, markets: Array.from({ length: 25 }, (_, i) => market(`M${i}`, 'kpi', .4, 'Low', 40)) }] };
        const paged = renderToStaticMarkup(<EarningsMarkets data={many}/>);
        expect(paged.match(/class="earnings-outcome"/g)).toHaveLength(10);
        expect(paged).toContain('Outcomes 1–10 of 25');
        expect(paged).toContain('25 total across 1 event<');
        expect(paged).toContain('Earnings page (top)');
        expect(paged).toContain(data.historyNote);
    });
    it('shows past report moves with their SEC source, and only the note when none are loaded', () => {
        const history = [
            { filingDate: '2026-07-30', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/0000320193-26-000018-index.htm', beforeDate: '2026-07-29', closeBefore: 200, afterDate: '2026-07-31', closeAfter: 210, move: .05 },
            { filingDate: '2026-04-30', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000011/0000320193-26-000011-index.htm', beforeDate: '2026-04-29', closeBefore: 200, afterDate: '2026-05-01', closeAfter: 190, move: -.05 },
            { filingDate: '2026-10-09', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/pending/pending-index.htm', beforeDate: '2026-10-08', closeBefore: 220, afterDate: null, closeAfter: null, move: null },
        ];
        const html = renderToStaticMarkup(<EarningsHistory data={{ ...data, history, historyNote: 'Report dates are SEC filing dates.' }}/>);
        expect(html).toContain('href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/0000320193-26-000018-index.htm"');
        expect(html).toContain('+5.0%');
        expect(html).toContain('-5.0%');
        expect(html).toContain('$210.00');
        // A report with no later close yet shows no move rather than a guess.
        expect(html.match(/Unavailable/g)!.length).toBeGreaterThanOrEqual(3);
        expect(html).toContain('Report dates are SEC filing dates.');
        const empty = renderToStaticMarkup(<EarningsHistory data={data}/>);
        expect(empty).not.toContain('<table');
        expect(empty).toContain(data.historyNote);
    });
});
