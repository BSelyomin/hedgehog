import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AssetClass, ExposureEvent, Holding, HoldingLink } from '../../../shared/types.ts';
import { ASSET_CLASS_LABELS, categorize, classify, fundClass, linkThemes, themeLabel } from './categories.ts';
import type { MeasuredRow } from './matching.ts';
import type { SecurityProfile } from '../jobs/profiles.ts';

const seeded: Record<string, AssetClass> = JSON.parse(readFileSync(new URL('../../seed/fund_classes.json', import.meta.url), 'utf8'));
const profile = (symbol: string, quote_type: string, extra: Partial<SecurityProfile> = {}): SecurityProfile => ({ symbol, quote_type, name: null, sector: null, industry: null, fund_category: null, ...extra });
const measured = (symbol: string, driver: string, effect: number, reliable = true): MeasuredRow => ({ symbol, driver, b: .3, se: .01, low: .28, high: .32, days: 250, reliable, computed_at: new Date('2026-10-09T00:00:00Z'), effect });

describe('fund categories', () => {
    it('maps the categories Yahoo returns to one asset class each', () => {
        expect(Object.values(seeded).every(value => Object.hasOwn(ASSET_CLASS_LABELS, value) && value !== 'unclassified')).toBe(true);
        for (const [category, expected] of [['Large Blend', 'stocks'], ['Real Estate', 'stocks'], ['Equity Energy', 'stocks'], ['Foreign Large Blend', 'stocks'],
            ['Long Government', 'bonds'], ['High Yield Bond', 'bonds'], ['Intermediate Core Bond', 'bonds'], ['Ultrashort Bond', 'bonds'],
            ['Commodities Focused', 'commodities'], ['Commodities Broad Basket', 'commodities'], ['Digital Assets', 'crypto'],
            ['Global Moderate Allocation', 'mixed'], ['Target-Date 2055', 'mixed'], ['Target-Date 2030', 'mixed'], ['Allocation--50% to 70% Equity', 'mixed']])
            expect(fundClass(category, seeded), category).toBe(expected);
    });
    it('leaves a category it does not know unclassified instead of guessing from its name', () => {
        for (const category of ['Trading--Inverse Equity', 'Trading--Leveraged Equity', 'Single Currency', 'Preferred Stock', 'Bond', 'Stocks', 'large blend', 'constructor', 'Target-Date', ''])
            expect(fundClass(category, seeded), category).toBeNull();
        expect(fundClass(null, seeded)).toBeNull();
    });
});

describe('asset class of a holding', () => {
    it('classes a holding the user described by that description', () => {
        expect(classify({ symbol: 'SAVINGS', valueUsd: 1, assetType: 'cash', details: {} }, undefined, seeded)).toEqual({ assetClass: 'cash', detail: 'Cash or savings' });
        expect(classify({ symbol: 'TNOTE', valueUsd: 1, assetType: 'treasury', details: { maturity: '2036-10-10', couponRate: 4 } }, undefined, seeded)).toEqual({ assetClass: 'bonds', detail: 'Treasury or CD' });
        expect(classify({ symbol: 'CORP', valueUsd: 1, assetType: 'bond', details: { maturity: '2031-06-15', couponRate: 5 } }, undefined, seeded)).toEqual({ assetClass: 'bonds', detail: 'Bond' });
        expect(classify({ symbol: 'HOME', valueUsd: 1, assetType: 'property', details: { state: 'Florida' } }, undefined, seeded)).toEqual({ assetClass: 'property', detail: 'Florida' });
        // A property that happens to be named like a ticker is not classed from that ticker's profile.
        expect(classify({ symbol: 'SPY', valueUsd: 1, assetType: 'property', details: { state: 'Ohio' } }, profile('SPY', 'ETF', { fund_category: 'Large Blend' }), seeded).assetClass).toBe('property');
    });
    it('classes a ticker from its Yahoo profile', () => {
        const security = (symbol: string): Holding => ({ symbol, valueUsd: 1 });
        expect(classify(security('XOM'), profile('XOM', 'EQUITY', { sector: 'Energy' }), seeded)).toEqual({ assetClass: 'stocks', detail: 'Energy' });
        expect(classify(security('SPY'), profile('SPY', 'ETF', { fund_category: 'Large Blend' }), seeded)).toEqual({ assetClass: 'stocks', detail: 'Large Blend fund' });
        expect(classify(security('TLT'), profile('TLT', 'ETF', { fund_category: 'Long Government' }), seeded)).toEqual({ assetClass: 'bonds', detail: 'Long Government fund' });
        expect(classify(security('USO'), profile('USO', 'ETF', { fund_category: 'Commodities Focused' }), seeded)).toEqual({ assetClass: 'commodities', detail: 'Commodities Focused fund' });
        expect(classify(security('VFFVX'), profile('VFFVX', 'MUTUALFUND', { fund_category: 'Target-Date 2055' }), seeded)).toEqual({ assetClass: 'mixed', detail: 'Target-Date 2055 fund' });
        expect(classify(security('VMFXX'), profile('VMFXX', 'MONEYMARKET'), seeded)).toEqual({ assetClass: 'cash', detail: 'Money market fund' });
        expect(classify(security('BTC-USD'), profile('BTC-USD', 'CRYPTOCURRENCY'), seeded)).toEqual({ assetClass: 'crypto', detail: 'Cryptocurrency' });
    });
    it('says Unclassified when the profile does not settle it', () => {
        const security = (symbol: string): Holding => ({ symbol, valueUsd: 1 });
        expect(classify(security('ZZZ'), undefined, seeded)).toEqual({ assetClass: 'unclassified', detail: null });
        expect(classify(security('SQQQ'), profile('SQQQ', 'ETF', { fund_category: 'Trading--Inverse Equity' }), seeded)).toEqual({ assetClass: 'unclassified', detail: 'Trading--Inverse Equity fund' });
        expect(classify(security('FCNTX'), profile('FCNTX', 'MUTUALFUND'), seeded)).toEqual({ assetClass: 'unclassified', detail: 'Fund' });
        expect(classify(security('^GSPC'), profile('^GSPC', 'INDEX'), seeded)).toEqual({ assetClass: 'unclassified', detail: null });
        expect(classify(security('NEW'), profile('NEW', 'EQUITY'), seeded)).toEqual({ assetClass: 'stocks', detail: null });
    });
});

describe('themes of a link', () => {
    const link = (symbol: string, type: HoldingLink['type'], extra: Partial<HoldingLink> = {}): HoldingLink => ({ symbol, valueUsd: 100, type, evidence: '', sensitivity: null, ...extra });
    it('gives a measured link each shared topic whose driver is reliably measured for the holding', () => {
        const rows = [measured('DAL', 'CL=F', .01), measured('DAL', 'DGS2', .002, false), measured('XOM', 'DGS2', .003)];
        expect(linkThemes(link('DAL', 'Measured'), ['oil', 'inflation'], ['oil', 'inflation'], rows)).toEqual(['oil']);
        expect(linkThemes(link('DAL', 'Measured'), ['oil', 'inflation'], ['oil', 'inflation'], [...rows, measured('DAL', 'DGS2', .004)])).toEqual(['oil', 'inflation']);
        // A reliable measurement under a fifth of the holding's biggest gives no theme.
        expect(linkThemes(link('DAL', 'Measured'), ['oil', 'inflation'], ['oil', 'inflation'], [...rows, measured('DAL', 'DGS2', .001)])).toEqual(['oil']);
        // A topic the holding does not carry, or one with no driver, adds nothing.
        expect(linkThemes(link('DAL', 'Measured'), ['oil', 'tariffs'], ['tariffs'], rows)).toEqual([]);
        expect(linkThemes(link('DAL', 'Measured'), ['oil', 'tariffs'], ['oil', 'tariffs'], rows)).toEqual(['oil']);
    });
    it('names company markets, the topics behind a calculation, and nothing for a bare topic link', () => {
        expect(linkThemes(link('AAPL', 'Direct'), ['AAPL', 'sp500'], ['AAPL', 'sp500'], [measured('AAPL', 'SPY', .01)])).toEqual(['direct']);
        expect(linkThemes(link('SAVINGS', 'Calculated', { assetType: 'cash', details: {} }), ['fed-rates', 'inflation'], [], [])).toEqual(['fed-rates']);
        expect(linkThemes(link('TNOTE', 'Calculated', { assetType: 'treasury' }), ['inflation', 'treasury-yields', 'oil'], [], [])).toEqual(['inflation', 'treasury-yields']);
        expect(linkThemes(link('HOME', 'Calculated', { assetType: 'property' }), ['mortgage-rates'], [], [])).toEqual(['mortgage-rates']);
        expect(linkThemes(link('JPM', 'Related'), ['banking'], ['banking'], [])).toEqual([]);
        expect(themeLabel('fed-rates')).toBe('Fed rates');
        expect(themeLabel('direct')).toBe('Direct markets');
        expect(themeLabel('consumer-spending')).toBe('Consumer spending');
    });
});

describe('grouping a portfolio', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const holdings: Holding[] = [{ symbol: 'XOM', valueUsd: 30000 }, { symbol: 'USO', valueUsd: 20000 }, { symbol: 'TLT', valueUsd: 10000 },
        { symbol: 'SAVINGS', valueUsd: 25000, assetType: 'cash', details: {} }, { symbol: 'HOME', valueUsd: 15000.5, assetType: 'property', details: { state: 'Florida' } }, { symbol: 'ZZZ', valueUsd: 5000 }];
    const profiles = [profile('XOM', 'EQUITY', { sector: 'Energy' }), profile('USO', 'ETF', { fund_category: 'Commodities Focused' }), profile('TLT', 'ETF', { fund_category: 'Long Government' })];
    const rows = [measured('XOM', 'CL=F', .012), measured('XOM', 'SPY', .008), measured('USO', 'CL=F', .02), measured('USO', 'DGS2', .003), measured('TLT', 'DGS2', .006), measured('TLT', 'SPY', .001)];
    const link = (symbol: string, type: HoldingLink['type'], themes: string[]): HoldingLink => ({ ...holdings.find(h => h.symbol === symbol)!, type, themes, evidence: '', sensitivity: null });
    const event = (ticker: string, eventTime: string, links: HoldingLink[]): ExposureEvent => ({ ticker, title: `${ticker} title`, category: 'Economics', closeTime: eventTime, eventTime, eventTimeSource: 'close', linkedValue: 0, share: 0, links, markets: [], mutuallyExclusive: false });
    const events = [
        event('OIL-LATE', '2026-11-20T15:00:00Z', [link('XOM', 'Measured', ['oil']), link('USO', 'Measured', ['oil']), link('TLT', 'Related', [])]),
        event('OIL-SOON', '2026-10-16T21:00:00Z', [link('USO', 'Measured', ['oil'])]),
        event('FED', '2026-10-28T18:00:00Z', [link('SAVINGS', 'Calculated', ['fed-rates']), link('TLT', 'Measured', ['fed-rates', 'inflation']), link('USO', 'Measured', ['fed-rates'])]),
        event('XOM-CALL', '2026-10-30T13:00:00Z', [link('XOM', 'Direct', ['direct'])]),
        event('OIL-PAST', '2026-10-09T21:00:00Z', [link('XOM', 'Measured', ['oil'])]),
    ];
    const result = categorize(holdings, events, profiles, rows, seeded, now);

    it('puts every holding in exactly one asset class, largest class first', () => {
        expect(result.totalValue).toBe(105000.5);
        expect(result.assetClasses.map(group => [group.key, group.label, group.symbols, group.valueUsd])).toEqual([
            ['stocks', 'Stocks', ['XOM'], 30000], ['cash', 'Cash', ['SAVINGS'], 25000], ['commodities', 'Commodities', ['USO'], 20000],
            ['property', 'Property', ['HOME'], 15000.5], ['bonds', 'Bonds', ['TLT'], 10000], ['unclassified', 'Unclassified', ['ZZZ'], 5000]]);
        expect(result.assetClasses.flatMap(group => group.symbols).sort()).toEqual(holdings.map(h => h.symbol).sort());
        expect(result.assetClasses.reduce((sum, group) => sum + group.share, 0)).toBeCloseTo(1, 12);
        expect(result.assetClasses[0].share).toBeCloseTo(30000 / 105000.5, 12);
    });
    it('counts the events linked to a class by more than a shared topic, and names the soonest', () => {
        const by = Object.fromEntries(result.assetClasses.map(group => [group.key, group]));
        expect(by.stocks.events).toBe(3);
        expect(by.stocks.next).toEqual({ ticker: 'XOM-CALL', title: 'XOM-CALL title', eventTime: '2026-10-30T13:00:00Z', eventTimeSource: 'close' });
        // TLT's link to the oil event is a bare topic link, so only the Fed event counts for bonds.
        expect(by.bonds.events).toBe(1);
        expect(by.commodities.next?.ticker).toBe('OIL-SOON');
        expect(by.property).toMatchObject({ events: 0, next: null });
        expect(by.unclassified).toMatchObject({ events: 0, next: null, lead: [] });
    });
    it('groups by theme, counting a holding once in each theme it is linked through', () => {
        expect(result.themes.map(group => [group.key, group.label, group.symbols, group.valueUsd, group.events])).toEqual([
            ['fed-rates', 'Fed rates', ['SAVINGS', 'USO', 'TLT'], 55000, 1], ['oil', 'Oil', ['XOM', 'USO'], 50000, 3],
            ['direct', 'Direct markets', ['XOM'], 30000, 1], ['inflation', 'Inflation', ['TLT'], 10000, 1]]);
        // Themes overlap: USO is in two, so the shares add up to more than the portfolio.
        expect(result.themes.reduce((sum, group) => sum + group.share, 0)).toBeGreaterThan(1);
        expect(result.themes.find(group => group.key === 'oil')!.next?.ticker).toBe('OIL-SOON');
    });
    it('names the holdings a theme matters most to', () => {
        const lead = Object.fromEntries(result.themes.map(group => [group.key, group.lead]));
        // Oil is the biggest measured driver of both; for USO the Fed's rate is a minor one.
        expect(lead.oil).toEqual(['XOM', 'USO']);
        // Interest on the savings balance is calculated exactly, and rates are TLT's biggest driver.
        expect(lead['fed-rates']).toEqual(['SAVINGS', 'TLT']);
        expect(lead.inflation).toEqual(['TLT']);
        expect(lead.direct).toEqual([]);
    });
    it('lists each holding with its class, what the class rests on, and its themes', () => {
        expect(result.holdings).toEqual([
            { symbol: 'XOM', valueUsd: 30000, assetClass: 'stocks', detail: 'Energy', themes: ['oil', 'direct'] },
            { symbol: 'USO', valueUsd: 20000, assetClass: 'commodities', detail: 'Commodities Focused fund', themes: ['oil', 'fed-rates'] },
            { symbol: 'TLT', valueUsd: 10000, assetClass: 'bonds', detail: 'Long Government fund', themes: ['fed-rates', 'inflation'] },
            { symbol: 'SAVINGS', valueUsd: 25000, assetClass: 'cash', detail: 'Cash or savings', themes: ['fed-rates'] },
            { symbol: 'HOME', valueUsd: 15000.5, assetClass: 'property', detail: 'Florida', themes: [] },
            { symbol: 'ZZZ', valueUsd: 5000, assetClass: 'unclassified', detail: null, themes: [] }]);
    });
    it('puts forward the next event that matters, not a sooner one a holding is only faintly tied to', () => {
        const sensitivity = (driver: string) => ({ b: .1, low: .05, high: .15, days: 250, driver, computedAt: '2026-10-09T00:00:00Z', typicalEffect: .01 });
        const tlt = (driver: string, themes: string[]): HoldingLink => ({ ...link('TLT', 'Measured', themes), sensitivity: sensitivity(driver), lead: { driver: 'DGS2', typicalEffect: .006 } });
        const dated = [event('DIESEL', '2026-10-11T07:30:00Z', [tlt('CL=F', ['oil'])]), event('FED', '2026-10-28T18:00:00Z', [tlt('DGS2', ['fed-rates'])]), event('TOPIC', '2026-10-10T18:00:00Z', [link('TLT', 'Related', [])])];
        const grouped = categorize(holdings, dated, profiles, rows, seeded, now);
        const bonds = grouped.assetClasses.find(group => group.key === 'bonds')!;
        // Both measured events count; the Fed decision is next because rates are TLT's biggest driver.
        expect(bonds.events).toBe(2);
        expect(bonds.next?.ticker).toBe('FED');
        // Within the oil theme the diesel market is the only event, so it is next.
        expect(grouped.themes.find(group => group.key === 'oil')!.next?.ticker).toBe('DIESEL');
        // With nothing stronger open, the soonest linked event is shown.
        expect(categorize(holdings, dated.slice(0, 1), profiles, rows, seeded, now).assetClasses.find(group => group.key === 'bonds')!.next?.ticker).toBe('DIESEL');
    });
    it('returns empty groups for an empty portfolio', () => {
        expect(categorize([], [], [], [], seeded, now)).toEqual({ totalValue: 0, holdings: [], assetClasses: [], themes: [] });
    });
});
