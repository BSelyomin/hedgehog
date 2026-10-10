import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CSV_COLUMNS, parseHoldingsCsv } from './screens/holdings-csv';
import { validateHoldings } from '../../server/src/services/holdings';

const example = (name: string) => readFileSync(new URL(`../../examples/${name}`, import.meta.url), 'utf8');

describe('holdings CSV import', () => {
    it('still reads the original two-column files, with or without a header', () => {
        expect(parseHoldingsCsv('symbol,valueUsd\naapl,100\n TLT , 2500.50 \n')).toEqual([{ symbol: 'AAPL', valueUsd: 100 }, { symbol: 'TLT', valueUsd: 2500.5 }]);
        expect(parseHoldingsCsv('XOM,10\r\nDAL,20')).toEqual([{ symbol: 'XOM', valueUsd: 10 }, { symbol: 'DAL', valueUsd: 20 }]);
        expect(parseHoldingsCsv(example('fake-portfolio.csv'))).toHaveLength(5);
        expect(parseHoldingsCsv(example('fake-portfolio-large.csv'))).toHaveLength(25);
    });
    it('reads the terms of holdings without a ticker from the optional columns', () => {
        expect(CSV_COLUMNS).toBe('symbol,valueUsd,type,maturity,couponRate,state,adjustableMortgage,rental');
        expect(parseHoldingsCsv(`${CSV_COLUMNS}\nsavings,20000,cash\nTNOTE-2036,10000,treasury,2036-10-10,4\nCORP-2031,5000,Bond,2031-06-15,5.5\nHOME,300000,property,,,Florida,150000,yes\nCABIN,90000,property,,,Montana\nTLT,100,security`)).toEqual([
            { symbol: 'SAVINGS', valueUsd: 20000, assetType: 'cash', details: {} },
            { symbol: 'TNOTE-2036', valueUsd: 10000, assetType: 'treasury', details: { maturity: '2036-10-10', couponRate: 4 } },
            { symbol: 'CORP-2031', valueUsd: 5000, assetType: 'bond', details: { maturity: '2031-06-15', couponRate: 5.5 } },
            { symbol: 'HOME', valueUsd: 300000, assetType: 'property', details: { state: 'Florida', adjustableMortgage: 150000, rental: true } },
            { symbol: 'CABIN', valueUsd: 90000, assetType: 'property', details: { state: 'Montana' } },
            { symbol: 'TLT', valueUsd: 100 },
        ]);
    });
    it('refuses rows it cannot use and says which', () => {
        const basic = 'CSV must contain unique symbol,valueUsd rows with positive values.';
        for (const text of ['', 'symbol,valueUsd', 'AAPL', 'AAPL,-5', 'AAPL,abc', ',100', 'AAPL,100\naapl,200'])
            expect(() => parseHoldingsCsv(text), JSON.stringify(text)).toThrow(basic);
        expect(() => parseHoldingsCsv('COIN,100,crypto')).toThrow('COIN: type must be one of security, cash, treasury, bond, property.');
        expect(() => parseHoldingsCsv('TNOTE,100,treasury,2036,4')).toThrow('TNOTE: a treasury needs a maturity date (YYYY-MM-DD) and a yearly coupon rate.');
        expect(() => parseHoldingsCsv('CORP,100,bond,2031-06-15')).toThrow('CORP: a bond needs a maturity date');
        expect(() => parseHoldingsCsv('HOME,100,property')).toThrow('HOME: a property needs its state');
        expect(() => parseHoldingsCsv('HOME,100,property,,,Texas,lots')).toThrow('HOME: a property needs its state');
    });
    it('ships a feature-tour file that imports and passes the server’s checks', () => {
        const tour = parseHoldingsCsv(example('feature-tour.csv'));
        expect(tour).toHaveLength(17);
        expect(tour.filter(holding => !holding.assetType).map(holding => holding.symbol)).toEqual(['XOM', 'USO', 'DAL', 'UAL', 'TLT', 'JPM', 'ITB', 'VNQ', 'GLD', 'AAPL', 'NFLX', 'TSLA', 'SPY']);
        expect(tour.filter(holding => holding.assetType).map(holding => holding.assetType)).toEqual(['cash', 'treasury', 'bond', 'property']);
        expect(tour.reduce((sum, holding) => sum + holding.valueUsd, 0)).toBe(425000);
        expect(validateHoldings(tour)).toEqual(tour);
    });
});
