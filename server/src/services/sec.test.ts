import { describe, expect, it } from 'vitest';
import { cikFor, filingUrl, resultsFilings } from './sec.ts';
import { reportMove } from './earnings.ts';

// Shapes copied from live EDGAR responses for Apple (CIK 320193), October 2026.
const companies = [{ cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' }, { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' }];
const page = {
    accessionNumber: ['0000320193-26-000018', '0000320193-26-000011', '0001140361-26-015711', '0000320193-26-000019', 'not-an-accession'],
    filingDate: ['2026-07-30', '2026-04-30', '2026-04-20', '2026-08-01', '2026-01-29'],
    reportDate: ['2026-07-30', '2026-04-30', '2026-04-17', '', '2026-01-29'],
    form: ['8-K', '8-K', '8-K', '8-K/A', '8-K'],
    items: ['2.02,9.01', '2.02,9.01', '5.02', '2.02,9.01', '2.02'],
};

describe('SEC EDGAR results filings', () => {
    it('finds a registrant by ticker, including share classes written with a dot', () => {
        expect(cikFor(companies, 'AAPL')).toBe('0000320193');
        expect(cikFor(companies, 'brk.b')).toBe('0001067983');
        expect(cikFor(companies, 'SPYX')).toBeNull();
    });
    it('keeps only original 8-K filings carrying Item 2.02 with valid identifiers', () => {
        expect(resultsFilings(page)).toEqual([
            { accession: '0000320193-26-000018', filingDate: '2026-07-30', reportDate: '2026-07-30' },
            { accession: '0000320193-26-000011', filingDate: '2026-04-30', reportDate: '2026-04-30' },
        ]);
        expect(() => resultsFilings({ ...page, items: undefined as unknown as string[] })).toThrow();
    });
    it('links each filing to its EDGAR index page', () => {
        expect(filingUrl('0000320193', '0000320193-26-000018')).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/0000320193-26-000018-index.htm');
    });
});

describe('move across a results filing', () => {
    const closes = [{ date: '2026-07-28', close: 198 }, { date: '2026-07-29', close: 200 }, { date: '2026-07-30', close: 203 }, { date: '2026-07-31', close: 210 }, { date: '2026-08-03', close: 212 }];
    it('runs from the last close before the filing date to the first close after it', () => {
        expect(reportMove('2026-07-30', closes)).toEqual({ beforeDate: '2026-07-29', closeBefore: 200, afterDate: '2026-07-31', closeAfter: 210, move: 210 / 200 - 1 });
        // A Saturday filing date still brackets the weekend.
        expect(reportMove('2026-08-01', closes)).toMatchObject({ beforeDate: '2026-07-31', afterDate: '2026-08-03' });
    });
    it('shows no move without a close on both sides or across a gap in price history', () => {
        expect(reportMove('2026-08-03', closes)).toMatchObject({ beforeDate: '2026-07-31', afterDate: null, move: null });
        expect(reportMove('2026-07-28', closes)).toMatchObject({ beforeDate: null, move: null });
        expect(reportMove('2026-09-15', [...closes, { date: '2026-09-16', close: 220 }])).toMatchObject({ beforeDate: null, afterDate: '2026-09-16', move: null });
        expect(reportMove('2026-07-30', [{ date: '2026-07-29', close: 0 }, { date: '2026-07-31', close: 210 }]).move).toBeNull();
    });
});
