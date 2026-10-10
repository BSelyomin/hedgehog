import { describe, expect, it } from 'vitest';
import { MARKETS_SHOWN, MAX_MOVE_SPREAD, MOVE_RANGES, eventLinks, groupMoved, groupSettled, isMoveRange, type MovedRow, type SettledRow } from './move-data.ts';
import type { MeasuredRow } from './matching.ts';
import { valueAt } from '../math/move.ts';
import { closeInstant } from './price-date.ts';
import { TRUST } from '../config/trust.ts';

describe('the window a move is taken over', () => {
    it('offers a day, a week, a month and a quarter, and nothing else', () => {
        expect(Object.keys(MOVE_RANGES)).toEqual(['day', 'week', 'month', 'quarter']);
        expect(['day', 'week', 'month', 'quarter'].every(isMoveRange)).toBe(true);
        expect([undefined, '', 'year', 'all', 7, ['day'], 'toString'].some(isMoveRange)).toBe(false);
    });
    it('reads Kalshi at the regular close, 4:00 pm New York, in summer and winter time', () => {
        expect(closeInstant('2026-10-09').toISOString()).toBe('2026-10-09T20:00:00.000Z');
        expect(closeInstant('2026-01-09').toISOString()).toBe('2026-01-09T21:00:00.000Z');
        // The days the clocks change: 4:00 pm falls after the change on both.
        expect(closeInstant('2026-03-08').toISOString()).toBe('2026-03-08T20:00:00.000Z');
        expect(closeInstant('2026-11-01').toISOString()).toBe('2026-11-01T21:00:00.000Z');
    });
    it('values a holding at an earlier close from the value entered, in whole cents', () => {
        expect(valueAt(1000, 100, 110)).toBe(909.09);
        expect(valueAt(1000, 110, 110)).toBe(1000);
        expect(valueAt(333.33, 50, 50)).toBe(333.33);
        expect(valueAt(10000, 123.45, 98.76)).toBe(12500);
    });
    it('compares only quotes the trust score gives some credit for', () => {
        expect(MAX_MOVE_SPREAD).toBe(.1);
        expect(MAX_MOVE_SPREAD * 100).toBe(TRUST.spreadWorst);
    });
});

const at = (time: string) => new Date(`2026-10-0${time}:00Z`);
describe('odds that moved over a window', () => {
    const row = (ticker: string, event: string, from: number, to: number, extra: Partial<MovedRow> = {}): MovedRow => ({ ticker, title: `${ticker} market`, series_ticker: `${event}-S`, event_ticker: event, event_title: `${event} event`, tags: [event.toLowerCase()], previous_mid: from, current_mid: to, previous_ts: at('2T20:00'), current_ts: at('9T19:00'), ...extra });
    const linked = () => [{ symbol: 'XOM', type: 'Measured' as const, driver: 'CL=F', themes: ['oil'] }];
    it('lists each event once, the biggest mover first, with the readings at both ends', () => {
        const events = groupMoved([row('OIL-1', 'OIL', .4, .45), row('FED-1', 'FED', .7, .5), row('OIL-2', 'OIL', .2, .32), row('OIL-3', 'OIL', .9, .91)], linked);
        expect(events.map(event => [event.ticker, event.moved, event.markets.map(market => market.ticker)])).toEqual([['FED', 1, ['FED-1']], ['OIL', 2, ['OIL-2', 'OIL-1']]]);
        expect(events[0]).toEqual({ ticker: 'FED', title: 'FED event', links: linked(), moved: 1,
            markets: [{ ticker: 'FED-1', title: 'FED-1 market', from: .7, to: .5, fromTime: '2026-10-02T20:00:00.000Z', toTime: '2026-10-09T19:00:00.000Z', changePoints: -20 }] });
    });
    it('counts three points as three points, whatever floating point makes of the subtraction', () => {
        // 0.58 − 0.55 is 0.029999999999999916.
        const events = groupMoved([row('EXACT', 'A', .55, .58), row('UNDER', 'B', .55, .5795), row('DOWN', 'C', .335, .305)], linked);
        expect(events.map(event => [event.ticker, event.markets[0].changePoints])).toEqual([['A', 3], ['C', -3]]);
    });
    it('sends an event’s three biggest movers and counts the rest', () => {
        const events = groupMoved(Array.from({ length: 7 }, (_, i) => row(`OIL-${i}`, 'OIL', .2, .25 + i / 100)), linked);
        expect(MARKETS_SHOWN).toBe(3);
        expect(events[0].moved).toBe(7);
        expect(events[0].markets.map(market => market.changePoints)).toEqual([11, 10, 9]);
    });
    it('leaves out an event no holding is linked to, and writes titles without Markdown', () => {
        const events = groupMoved([row('GAS-1', 'GAS', .3, .5, { title: 'Will average **gas prices** be above $4.00?', event_title: '**US** gas prices' }), row('ODD-1', 'ODD', .1, .9)], event => event.tags.includes('gas') ? linked() : []);
        expect(events.map(event => [event.title, event.markets[0].title])).toEqual([['US gas prices', 'Will average gas prices be above $4.00?']]);
    });
    it('groups by series when Kalshi gives a market no event', () => {
        expect(groupMoved([row('A-1', 'A', .3, .5, { event_ticker: null }), row('A-2', 'A', .3, .6, { event_ticker: null })], linked).map(event => [event.ticker, event.moved])).toEqual([['A-S', 2]]);
    });
});

describe('events that settled in a window', () => {
    const row = (ticker: string, event: string | null, outcome: number, before: number, close = '8T14:00', extra: Partial<SettledRow> = {}): SettledRow => ({ ticker, title: `${ticker} question`, series_ticker: 'S', event_ticker: event, event_title: null, tags: ['oil'], outcome, prob_24h_before: before, close_time: at(close), ...extra });
    const linked = () => [{ symbol: 'XOM', type: 'Direct' as const, driver: null, themes: ['direct'] }];
    it('leads with what Kalshi least expected, within an event and across events', () => {
        const events = groupSettled([row('BRENT-100', 'BRENT', 1, .95), row('BRENT-102', 'BRENT', 1, .34), row('BRENT-104', 'BRENT', 0, .12), row('BRENT-106', 'BRENT', 0, .02),
            row('CPI-1', 'CPI', 0, .9, '6T12:30'), row('CALL-1', 'CALL', 1, .97)], linked);
        expect(events.map(event => event.ticker)).toEqual(['CPI', 'BRENT', 'CALL']);
        expect(events[1]).toMatchObject({ ticker: 'BRENT', title: null, settled: 4, yes: 2, closeTime: '2026-10-08T14:00:00.000Z' });
        expect(events[1].markets).toEqual([
            { ticker: 'BRENT-102', title: 'BRENT-102 question', outcome: 1, probabilityBefore: .34, closeTime: '2026-10-08T14:00:00.000Z' },
            { ticker: 'BRENT-104', title: 'BRENT-104 question', outcome: 0, probabilityBefore: .12, closeTime: '2026-10-08T14:00:00.000Z' },
            { ticker: 'BRENT-100', title: 'BRENT-100 question', outcome: 1, probabilityBefore: .95, closeTime: '2026-10-08T14:00:00.000Z' },
        ]);
    });
    it('uses Kalshi’s event title when we hold it and dates the event by its last close', () => {
        const [event] = groupSettled([row('A', 'E', 1, .5, '5T14:00', { event_title: 'Brent **close** this week' }), row('B', 'E', 0, .5, '7T21:00', { event_title: 'Brent **close** this week' })], linked);
        expect([event.title, event.closeTime]).toEqual(['Brent close this week', '2026-10-07T21:00:00.000Z']);
    });
    it('puts the later of two equal surprises first, and skips a market with no yes or no result', () => {
        const events = groupSettled([row('OLD', 'OLD-E', 1, .2, '5T14:00'), row('NEW', 'NEW-E', 0, .8, '8T14:00'), row('VOID', 'VOID-E', 2, .5), row('LONE', null, 1, .6)], linked);
        expect(events.map(event => event.ticker)).toEqual(['NEW-E', 'OLD-E', 'LONE']);
        expect(groupSettled([row('A', 'E', 1, .5)], () => [])).toEqual([]);
    });
});

describe('linking an event to holdings for the Moves screen', () => {
    const measured = (symbol: string, driver: string, b: number, effect: number): MeasuredRow => ({ symbol, driver, b, se: Math.abs(b) / 10, low: b * .8, high: b * 1.2, days: 2500, reliable: true, computed_at: new Date('2026-10-09T00:00:00Z'), effect });
    const holdings = [{ symbol: 'AAPL', valueUsd: 2000 }, { symbol: 'USO', valueUsd: 5000 }, { symbol: 'XOM', valueUsd: 10000 }, { symbol: 'TLT', valueUsd: 8000 }, { symbol: 'SAVINGS', valueUsd: 50000, assetType: 'cash' as const }];
    const tags = [...['AAPL', 'USO', 'XOM'].map(symbol => ({ symbol, tag: 'oil' })), ...['fed-rates', 'treasury-yields'].map(tag => ({ symbol: 'TLT', tag }))];
    const rows = [measured('XOM', 'SPY', .8, .008), measured('XOM', 'CL=F', .3, .005), measured('USO', 'CL=F', .9, .02), measured('USO', 'SPY', .4, .004),
        measured('TLT', 'DGS10', -.16, .0085), measured('TLT', 'DGS2', -.09, .005), measured('TLT', 'SPY', .1, .0009)];
    const context = { now: Date.parse('2026-10-09T23:59:59Z'), shortYield: 4.5, longYield: 4.8 };
    it('keeps the link type, the measured driver and the themes, strongest link first', () => {
        expect(eventLinks(holdings, ['oil'], 'Brent close', tags, rows, context)).toEqual([
            { symbol: 'XOM', type: 'Measured', driver: 'CL=F', themes: ['oil'] },
            { symbol: 'USO', type: 'Measured', driver: 'CL=F', themes: ['oil'] },
            // Shares the topic with nothing measured behind it.
            { symbol: 'AAPL', type: 'Related', driver: null, themes: [] },
        ]);
        expect(eventLinks(holdings, ['AAPL'], 'Apple earnings call', tags, rows, context)).toEqual([{ symbol: 'AAPL', type: 'Direct', driver: null, themes: ['direct'] }]);
        expect(eventLinks(holdings, ['weather'], 'Hurricanes', tags, rows, context)).toEqual([]);
    });
    it('links a holding without a ticker through its asset type', () => {
        expect(eventLinks(holdings, ['fed-rates'], 'Fed decision', tags, rows, context)).toEqual([
            { symbol: 'SAVINGS', type: 'Calculated', driver: null, themes: ['fed-rates'] },
            { symbol: 'TLT', type: 'Measured', driver: 'DGS2', themes: ['fed-rates'] },
        ]);
    });
    it('points a link at the driver the holding’s estimate is listed under', () => {
        // A holding is compared on one yield; a Fed market's link to a bond fund reads from that one.
        const listed = (symbol: string, driver: string) => symbol === 'TLT' && driver === 'DGS2' ? 'DGS10' : driver;
        expect(eventLinks(holdings, ['fed-rates'], 'Fed decision', tags, rows, context, listed)[1]).toEqual({ symbol: 'TLT', type: 'Measured', driver: 'DGS10', themes: ['fed-rates'] });
        expect(eventLinks(holdings, ['oil'], 'Brent close', tags, rows, context, listed)[0].driver).toBe('CL=F');
    });
});
