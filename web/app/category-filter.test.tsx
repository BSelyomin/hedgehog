import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Categories, ExposureEvent, ExposureResponse, HoldingLink, HoldingMove } from '../../shared/types';
import { activeSelection, linkSelected, noSelection, selectEvents, selectedSymbols, selectionMove, selectionSummary, setCategorySelection } from './screens/category-filter';
import { CategoryCards, CategoryFilter } from './screens/category-controls';
import { ExposureTable } from './screens/exposure-table';

const group = (key: string, label: string, symbols: string[], valueUsd: number, extra = {}) => ({ key, label, symbols, valueUsd, share: valueUsd / 105000, events: 0, next: null, lead: [], ...extra });
const categories: Categories = {
    totalValue: 105000,
    holdings: [
        { symbol: 'XOM', valueUsd: 30000, assetClass: 'stocks', detail: 'Energy', themes: ['oil', 'direct'] },
        { symbol: 'USO', valueUsd: 20000, assetClass: 'commodities', detail: 'Commodities Focused fund', themes: ['oil', 'fed-rates'] },
        { symbol: 'TLT', valueUsd: 10000, assetClass: 'bonds', detail: 'Long Government fund', themes: ['fed-rates'] },
        { symbol: 'SAVINGS', valueUsd: 25000, assetClass: 'cash', detail: 'Cash or savings', themes: ['fed-rates'] },
        { symbol: 'HOME', valueUsd: 15000, assetClass: 'property', detail: 'Florida', themes: [] },
        { symbol: 'ZZZ', valueUsd: 5000, assetClass: 'unclassified', detail: null, themes: [] },
    ],
    assetClasses: [group('stocks', 'Stocks', ['XOM'], 30000, { events: 2, next: { ticker: 'XOM-CALL', title: 'Exxon earnings call', eventTime: '2026-10-30T16:00:00Z', eventTimeSource: 'stated' } }), group('cash', 'Cash', ['SAVINGS'], 25000),
        group('commodities', 'Commodities', ['USO'], 20000), group('property', 'Property', ['HOME'], 15000), group('bonds', 'Bonds', ['TLT'], 10000), group('unclassified', 'Unclassified', ['ZZZ'], 5000)],
    themes: [group('fed-rates', 'Fed rates', ['SAVINGS', 'USO', 'TLT'], 55000, { events: 1, lead: ['TLT'] }), group('oil', 'Oil', ['XOM', 'USO'], 50000, { events: 3, lead: ['XOM', 'USO'], next: { ticker: 'OIL-SOON', title: 'Oil above $90 on Friday', eventTime: '2026-10-16T21:00:00Z', eventTimeSource: 'close' } }),
        group('direct', 'Direct markets', ['XOM'], 30000, { events: 1 })],
};
const link = (symbol: string, type: HoldingLink['type'], themes: string[]): HoldingLink => ({ symbol, valueUsd: categories.holdings.find(h => h.symbol === symbol)!.valueUsd, type, themes, evidence: 'Test evidence', sensitivity: null });
const event = (ticker: string, links: HoldingLink[]): ExposureEvent => ({ ticker, title: ticker, category: 'Economics', closeTime: '2026-10-20T12:00:00Z', eventTime: '2026-10-20T12:00:00Z', eventTimeSource: 'close', linkedValue: 1000, share: .1, links,
    themes: [...new Set(links.flatMap(l => l.themes ?? []))], mutuallyExclusive: false,
    markets: [{ ticker: `${ticker}-M`, title: ticker, subtitle: 'Yes', probability: .5, spread: .02, kind: 'kpi', asOf: null, trust: { total: 50, band: 'Low', spread: 20, activity: 10, depth: 7.5, trackRecord: null, categoryCount: 0, spreadCents: 2 } }] });
const events = [
    event('OIL', [link('XOM', 'Measured', ['oil']), link('USO', 'Measured', ['oil']), link('TLT', 'Related', [])]),
    event('FED', [link('SAVINGS', 'Calculated', ['fed-rates']), link('TLT', 'Measured', ['fed-rates']), link('USO', 'Measured', ['fed-rates'])]),
    event('XOM-CALL', [link('XOM', 'Direct', ['direct'])]),
    event('HOUSING', [link('HOME', 'Related', [])]),
];
afterEach(() => setCategorySelection(noSelection));

describe('category selection', () => {
    it('names the holdings in an asset class, linked through a theme, or both', () => {
        expect(selectedSymbols(categories, noSelection)).toBeNull();
        expect([...selectedSymbols(categories, { assetClass: 'stocks', theme: '' })!]).toEqual(['XOM']);
        expect([...selectedSymbols(categories, { assetClass: '', theme: 'oil' })!]).toEqual(['XOM', 'USO']);
        expect([...selectedSymbols(categories, { assetClass: 'commodities', theme: 'oil' })!]).toEqual(['USO']);
        expect([...selectedSymbols(categories, { assetClass: 'cash', theme: 'oil' })!]).toEqual([]);
    });
    it('ignores a choice this portfolio does not have', () => {
        expect(activeSelection(categories, { assetClass: 'crypto', theme: 'tariffs' })).toEqual(noSelection);
        expect(activeSelection(categories, { assetClass: 'bonds', theme: 'tariffs' })).toEqual({ assetClass: 'bonds', theme: '' });
        expect(selectedSymbols(categories, { assetClass: 'crypto', theme: '' })).toBeNull();
    });
    it('reports the chosen value and its share of the whole portfolio, counting each holding once', () => {
        expect(selectionSummary(categories, noSelection)).toEqual({ holdings: 6, valueUsd: 105000, share: 1 });
        expect(selectionSummary(categories, { assetClass: '', theme: 'oil' })).toEqual({ holdings: 2, valueUsd: 50000, share: 50000 / 105000 });
        // USO is in both the oil and the Fed themes; choosing either counts it once.
        expect(selectionSummary(categories, { assetClass: '', theme: 'fed-rates' })).toEqual({ holdings: 3, valueUsd: 55000, share: 55000 / 105000 });
        expect(selectionSummary(categories, { assetClass: 'cash', theme: 'oil' })).toEqual({ holdings: 0, valueUsd: 0, share: 0 });
    });
    it('keeps the events linked to a chosen holding, through the chosen theme', () => {
        const tickers = (selection: typeof noSelection, topicLinks?: boolean) => selectEvents(events, categories, selection, topicLinks).map(e => e.ticker);
        expect(tickers(noSelection)).toEqual(['OIL', 'FED', 'XOM-CALL', 'HOUSING']);
        expect(tickers({ assetClass: '', theme: 'oil' })).toEqual(['OIL']);
        // USO is an oil holding, but its link to the Fed event holds through rates, not oil.
        expect(tickers({ assetClass: 'commodities', theme: 'oil' })).toEqual(['OIL']);
        expect(tickers({ assetClass: 'commodities', theme: '' })).toEqual(['OIL', 'FED']);
        // A bare topic link counts on the Calendar and not on the Overview, which does not show them.
        expect(tickers({ assetClass: 'bonds', theme: '' })).toEqual(['OIL', 'FED']);
        expect(tickers({ assetClass: 'bonds', theme: '' }, false)).toEqual(['FED']);
        expect(tickers({ assetClass: 'property', theme: '' }, false)).toEqual([]);
        expect(linkSelected(events[0].links[2], new Set(['TLT']), 'oil')).toBe(false);
    });
    it('adds up the chosen holdings’ move in whole cents and withholds a figure a holding lacks', () => {
        // Each holding is worth 1,000 at the last close; what it was worth at the first follows from its move.
        const row = (symbol: string, actual: number | null, fromMarket: number | null, extra: Partial<HoldingMove> = {}): HoldingMove => ({ symbol, valueUsd: 1000, startValue: actual === null ? null : Math.round((1000 - actual) * 100) / 100, endValue: actual === null ? null : 1000, actual, beta: 1, fromMarket, beyondMarket: actual === null || fromMarket === null ? null : Math.round((actual - fromMarket) * 100) / 100, sourceDate: null, previousDate: null, unavailableReasons: [], drivers: [], ...extra });
        expect(selectionMove([row('XOM', 10.1, 4.05), row('USO', -3.33, 1.11), row('HOME', null, null, { assetType: 'property' })])).toEqual({ securities: 2, startValue: 1993.23, endValue: 2000, actual: 6.77, fromMarket: 5.16, beyondMarket: 1.61 });
        expect(selectionMove([row('XOM', 10.1, 4.05), row('NEW', 2, null)])).toEqual({ securities: 2, startValue: 1987.9, endValue: 2000, actual: 12.1, fromMarket: null, beyondMarket: null });
        expect(selectionMove([row('XOM', 10.1, 4.05), row('GAP', null, null)])).toMatchObject({ startValue: null, endValue: null, actual: null });
        expect(selectionMove([row('HOME', null, null, { assetType: 'property' })])).toEqual({ securities: 0, startValue: null, endValue: null, actual: null, fromMarket: null, beyondMarket: null });
    });
});

describe('category controls', () => {
    it('offers both filters with their group sizes and says what is shown', () => {
        const html = renderToStaticMarkup(<CategoryFilter categories={categories}/>);
        expect(html).toContain('<option value="stocks">Stocks (1)</option>');
        expect(html).toContain('<option value="fed-rates">Fed rates (3)</option>');
        expect(html).toContain('All 6 holdings');
        expect(html).not.toContain('Clear category');
        setCategorySelection({ assetClass: '', theme: 'oil' });
        const chosen = renderToStaticMarkup(<CategoryFilter categories={categories}/>);
        expect(chosen).toContain('2 of 6 holdings · <span class="mono">$50,000.00</span> · <span class="mono">47.6%</span> of your portfolio');
        expect(chosen).toContain('Clear category');
        expect(renderToStaticMarkup(<CategoryFilter categories={{ totalValue: 0, holdings: [], assetClasses: [], themes: [] }}/>)).toBe('');
    });
    it('shows a card for each asset class with its value, share, basis and next event', () => {
        const html = renderToStaticMarkup(<CategoryCards categories={categories}/>);
        expect(html.match(/<article/g)).toHaveLength(6);
        expect(html).toContain('<h3>Stocks</h3><p class="category-figure"><span class="note">Value you hold</span><strong class="number">$30,000.00</strong></p>');
        expect(html).toContain('6 groups, by asset class');
        expect(html).toContain('<button aria-pressed="true" class="active">By asset class</button><button aria-pressed="false" class="">By event theme</button>');
        expect(html).toContain('<span class="mono">28.6%</span> of your portfolio · 1 holding</p>');
        expect(html).toContain('<span class="chip plain" title="Energy">XOM</span>');
        expect(html).toContain('<p class="note">Commodities Focused fund</p>');
        expect(html).toContain('2 open events linked · next <a href="#event/XOM-CALL">Exxon earnings call</a>');
        expect(html).toContain('No open events linked');
        expect(html).toContain('Yahoo has no profile for these tickers');
        expect(html).toContain('<button aria-pressed="false">Show only these</button>');
        setCategorySelection({ assetClass: 'stocks', theme: '' });
        const chosen = renderToStaticMarkup(<CategoryCards categories={categories}/>);
        expect(chosen).toContain('<article class="category-card active"><h3>Stocks</h3>');
        expect(chosen.match(/aria-pressed="true">Showing only these · clear/g)).toHaveLength(1);
    });
    it('leads each theme card with the holdings the theme matters most to', () => {
        const html = renderToStaticMarkup(<CategoryCards categories={categories} initial="themes"/>);
        // The tab says what a theme card's figure is, and is not.
        expect(html).toContain('Each card is one kind of event and lists the holdings linked to it.');
        expect(html).toContain('not an amount at risk or an expected move');
        expect(html).toContain('<h3>Oil</h3><p class="note">Events about oil and fuel prices.</p><p class="category-figure"><span class="note">Value of the holdings linked to it</span><strong class="number">$50,000.00</strong></p>');
        // A theme card does not repeat what each holding is; the asset-class cards do that.
        expect(html).not.toContain('<p class="note">Commodities Focused fund');
        // Fed rates is TLT's biggest measured driver, so TLT comes before the larger SAVINGS and USO.
        expect(html).toContain('<span class="chip lead" title="Long Government fund">TLT</span><span class="chip plain" title="Cash or savings">SAVINGS</span><span class="chip plain" title="Commodities Focused fund">USO</span>');
        expect(html).toContain('Matters most to <strong>XOM, USO</strong>: calculated from its own terms, or its biggest measured driver.');
        expect(html).toContain('Kalshi markets about the holding itself');
    });
});

describe('overview table with a category chosen', () => {
    const data: ExposureResponse = { events, categories, totalValue: 105000, byHolding: [], asOf: null, holdings: categories.holdings.map(({ symbol, valueUsd }) => ({ symbol, valueUsd })) };
    const tiles = (html: string) => [...html.matchAll(/aria-label="([A-Z-]+): ([A-Z-]+), /g)].map(match => `${match[2]}:${match[1]}`);
    it('shows every linked holding when nothing is chosen', () => {
        expect(tiles(renderToStaticMarkup(<ExposureTable data={data}/>))).toEqual(['FED:SAVINGS', 'FED:USO', 'FED:TLT', 'OIL:XOM', 'OIL:USO', 'XOM-CALL:XOM']);
    });
    it('narrows to the chosen theme’s events and holdings', () => {
        setCategorySelection({ assetClass: '', theme: 'oil' });
        const html = renderToStaticMarkup(<ExposureTable data={data}/>);
        expect(tiles(html)).toEqual(['OIL:XOM', 'OIL:USO']);
        expect(html).toContain('1 of 4 events · 2 of 6 holdings · category filter on');
    });
    it('narrows to the chosen asset class and leaves out events it touches only by topic', () => {
        setCategorySelection({ assetClass: 'bonds', theme: '' });
        expect(tiles(renderToStaticMarkup(<ExposureTable data={data}/>))).toEqual(['FED:TLT']);
        setCategorySelection({ assetClass: 'property', theme: '' });
        expect(renderToStaticMarkup(<ExposureTable data={data}/>)).toContain('No events match these filters. Try another search, clear the category or reset filters.');
    });
});
