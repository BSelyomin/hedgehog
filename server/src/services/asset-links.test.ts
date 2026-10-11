import { describe, expect, it } from 'vitest';
import type { Holding } from '../../../shared/types.ts';
import { modifiedDuration, yearsUntil } from '../math/fixed-income.ts';
import { ASSET_TAGS, assetLink } from './asset-links.ts';
import { validateHoldings } from './holdings.ts';
import { buildBriefing } from './briefing-content.ts';
import { noCategories } from './categories.ts';
import type { ExposureResponse, MovesResponse } from '../../../shared/types.ts';

const now = Date.parse('2026-10-10T00:00:00Z');
const context = { now, shortYield: 4.8, longYield: 4 };

describe('bond arithmetic', () => {
    it('matches known modified durations', () => {
        // A 10-year 4% bond at par: Macaulay 8.3392 years, modified 8.1757.
        expect(modifiedDuration(4, 10)).toBeCloseTo(8.1757, 3);
        // A zero-coupon bond's Macaulay duration is its life; at a 4% yield modified is 5 / 1.02.
        expect(modifiedDuration(0, 5, 4)).toBeCloseTo(5 / 1.02, 6);
        // A three-month bill is one payment a quarter of a year away.
        expect(modifiedDuration(0, .25, 5)).toBeCloseTo(.25 / 1.025, 6);
        // A higher yield shortens duration; a longer bond lengthens it.
        expect(modifiedDuration(4, 10, 6)).toBeLessThan(modifiedDuration(4, 10, 4));
        expect(modifiedDuration(4, 30)).toBeGreaterThan(modifiedDuration(4, 10));
    });
    it('refuses terms that describe no bond', () => {
        expect(() => modifiedDuration(4, 0)).toThrow();
        expect(() => modifiedDuration(-1, 5)).toThrow();
        expect(() => modifiedDuration(Number.NaN, 5)).toThrow();
        expect(yearsUntil('2036-10-10', now)).toBeCloseTo(10, 1);
    });
});

describe('links for holdings without a ticker', () => {
    const cash: Holding = { symbol: 'SAVINGS', valueUsd: 50000, assetType: 'cash', details: {} };
    const note: Holding = { symbol: 'TNOTE-2036', valueUsd: 10000, assetType: 'treasury', details: { maturity: '2036-10-10', couponRate: 4 } };
    const home = (details: Holding['details']): Holding => ({ symbol: 'HOME', valueUsd: 400000, assetType: 'property', details });

    it('calculates interest on cash exactly from the amount entered', () => {
        const link = assetLink(cash, ['fed-rates'], 'Fed decision in December?', context);
        expect(link).toMatchObject({ type: 'Calculated', sensitivity: null, calculation: { kind: 'income', perPointUsd: 500 } });
        expect(link?.evidence).toContain('$500.00');
        expect(assetLink(cash, ['oil'], 'WTI price', context)).toBeNull();
        // Markets on mortgage rates or longer Treasury yields are not about what a savings account earns.
        expect(assetLink(cash, ['fed-rates', 'mortgage-rates'], '30-year mortgage rate at the end of 2027', context)).toBeNull();
        expect(assetLink(cash, ['fed-rates', 'treasury-yields'], '10Y US Treasury yield at year-end?', context)).toBeNull();
        expect(assetLink(note, ['fed-rates', 'mortgage-rates'], '30-year mortgage rate at the end of 2027', context)).toBeNull();
    });
    it('calculates a Treasury’s price sensitivity from its terms and the matching Treasury yield', () => {
        const link = assetLink(note, ['treasury-yields'], '10Y US Treasury yield at year-end?', context);
        const duration = modifiedDuration(4, yearsUntil('2036-10-10', now), 4);
        expect(link?.type).toBe('Calculated');
        expect(link?.calculation).toMatchObject({ kind: 'price', duration });
        expect(link?.calculation?.perPointUsd).toBeCloseTo(-duration * 100, 6);
        expect(link?.calculation?.perPointUsd).toBeLessThan(-800);
        expect(link?.calculation?.perPointUsd).toBeGreaterThan(-830);
        // A short note is discounted at the 2-year yield instead.
        const short = assetLink({ ...note, details: { maturity: '2028-10-10', couponRate: 4 } }, ['treasury-yields'], '2Y yield', context);
        expect(short?.evidence).toContain('at a 4.80% yield');
        // Without a published yield it is priced at its own coupon.
        expect(assetLink(note, ['treasury-yields'], '10Y', { now, shortYield: null, longYield: null })?.evidence).toContain('at a 4.00% yield');
    });
    it('gives no figure where the terms do not determine one', () => {
        expect(assetLink(note, ['fed-rates'], 'Fed decision', context)).toMatchObject({ type: 'Related', sensitivity: null });
        expect(assetLink(note, ['fed-rates'], 'Fed decision', context)?.calculation).toBeUndefined();
        // A matured or incomplete bond has no price sensitivity to state.
        expect(assetLink({ ...note, details: { maturity: '2026-01-01', couponRate: 4 } }, ['treasury-yields'], '10Y', context)?.type).toBe('Related');
        expect(assetLink({ ...note, assetType: 'bond' }, ['credit-defaults'], 'Credit card delinquency rate', context)?.type).toBe('Related');
        expect(ASSET_TAGS.treasury).not.toContain('credit-defaults');
    });
    it('links property only to markets that name its state or the whole country', () => {
        const florida = home({ state: 'Florida' });
        expect(assetLink(florida, ['hurricanes'], 'Florida Cat 4+ hurricane landfall by Dec 31, 2026?', context)?.type).toBe('Related');
        expect(assetLink(florida, ['hurricanes'], 'How many Atlantic hurricanes will there be in 2026?', context)).toBeNull();
        expect(assetLink(florida, ['housing'], 'Calgary home price below C$550K in 2026?', context)).toBeNull();
        expect(assetLink(florida, ['housing', 'housing-starts'], 'California permitted housing units in 2026', context)).toBeNull();
        expect(assetLink(home({ state: 'California' }), ['housing', 'housing-starts'], 'California permitted housing units in 2026', context)?.type).toBe('Related');
        expect(assetLink(florida, ['home-sales'], 'US existing home sales for September', context)?.type).toBe('Related');
        // The word "us" is not the country.
        expect(assetLink(florida, ['housing'], 'Will rates leave us with fewer listings?', context)).toBeNull();
    });
    it('applies rent markets to rentals and calculates only an adjustable mortgage', () => {
        const title = 'New York City rent increase in 2026';
        expect(assetLink(home({ state: 'New York' }), ['rents'], title, context)).toBeNull();
        expect(assetLink(home({ state: 'New York', rental: true }), ['rents'], title, context)?.type).toBe('Related');
        const adjustable = assetLink(home({ state: 'Texas', adjustableMortgage: 200000 }), ['mortgage-rates'], '30-year mortgage rate this week', context);
        expect(adjustable).toMatchObject({ type: 'Calculated', calculation: { kind: 'payment', perPointUsd: 2000 } });
        expect(assetLink(home({ state: 'Texas' }), ['mortgage-rates'], '30-year mortgage rate this week', context)).toMatchObject({ type: 'Related', sensitivity: null });
    });
    it('never treats a listed security as an asset-type holding', () => {
        expect(assetLink({ symbol: 'TLT', valueUsd: 100 }, ['treasury-yields'], '10Y', context)).toBeNull();
    });
});

describe('holding validation by type', () => {
    it('keeps listed securities exactly as before', () => {
        expect(validateHoldings([{ symbol: 'aapl', valueUsd: 100 }])).toEqual([{ symbol: 'AAPL', valueUsd: 100 }]);
        expect(validateHoldings([{ symbol: 'TLT', valueUsd: 100, assetType: 'security', details: { state: 'Texas' } }])).toEqual([{ symbol: 'TLT', valueUsd: 100 }]);
    });
    it('keeps only the terms each type needs', () => {
        expect(validateHoldings([{ symbol: 'savings', valueUsd: 5000, assetType: 'cash', details: { maturity: '2030-01-01' } }])).toEqual([{ symbol: 'SAVINGS', valueUsd: 5000, assetType: 'cash', details: {} }]);
        expect(validateHoldings([{ symbol: 'TNOTE', valueUsd: 10000, assetType: 'treasury', details: { maturity: '2036-10-10', couponRate: 4, state: 'Texas' } }])[0].details).toEqual({ maturity: '2036-10-10', couponRate: 4 });
        expect(validateHoldings([{ symbol: 'HOME', valueUsd: 400000, assetType: 'property', details: { state: ' Florida ', adjustableMortgage: 0, rental: false } }])[0].details).toEqual({ state: 'Florida' });
        expect(validateHoldings([{ symbol: 'RENTAL', valueUsd: 300000, assetType: 'property', details: { state: 'New York', adjustableMortgage: 150000, rental: true } }])[0].details).toEqual({ state: 'New York', adjustableMortgage: 150000, rental: true });
    });
    it('rejects unknown types and terms that cannot be used', () => {
        const bond = (details: unknown) => () => validateHoldings([{ symbol: 'BOND', valueUsd: 1000, assetType: 'bond', details }]);
        expect(() => validateHoldings([{ symbol: 'COIN', valueUsd: 1, assetType: 'crypto' }])).toThrow('supported holding type');
        expect(bond({ maturity: '2020-01-01', couponRate: 4 })).toThrow('maturity date in the future');
        expect(bond({ maturity: '2030-02-31', couponRate: 4 })).toThrow('maturity date in the future');
        expect(bond({ maturity: '2036-10-10' })).toThrow('coupon rate');
        expect(bond({ maturity: '2036-10-10', couponRate: 40 })).toThrow('coupon rate');
        expect(() => validateHoldings([{ symbol: 'HOME', valueUsd: 1, assetType: 'property', details: {} }])).toThrow('state');
        expect(() => validateHoldings([{ symbol: 'HOME', valueUsd: 1, assetType: 'property', details: { state: 'Texas', adjustableMortgage: -5 } }])).toThrow('mortgage balance');
    });
});

describe('briefing wording with unpriced holdings', () => {
    const portfolio = { holdings: [], totalValue: 0, byHolding: [], events: [], categories: noCategories, asOf: null } as ExposureResponse;
    const move = (unpricedValue: number) => ({ date: '2026-10-09', requestedDate: null, notes: [], total: -12.5, fromMarket: -10, beyondMarket: -2.5, range: 'day', startDate: '2026-10-08', startValue: null, endValue: null, oddsWindow: null, settledEvents: [], driverChanges: [], movedEvents: [], spyReturn: 0, holdings: [], drivers: [], missingDrivers: [], unpricedValue, asOf: null }) as MovesResponse;
    it('says the daily move covers listed holdings when cash, bonds or property are left out', () => {
        expect(buildBriefing(portfolio, move(250000), new Date(now))).toContain('Your listed holdings ended the October 9, 2026 session down 12.50 dollars.');
        expect(buildBriefing(portfolio, move(0), new Date(now))).toContain('Your portfolio ended the October 9, 2026 session down 12.50 dollars.');
    });
});
