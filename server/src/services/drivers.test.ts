import { describe, expect, it } from 'vitest';
import { alignedChanges, standardDeviation, typicalEffect } from '../math/series.ts';
import type { PricePoint } from '../math/series.ts';
import { driverContribution, rankMoves, sumByDriver } from '../math/move.ts';
import { oddsChanges } from './moves.ts';
import type { ExposureEvent } from '../../../shared/types.ts';
import { measureLink } from '../jobs/measure.ts';
import { drivers, matchHolding, rankDrivers } from './matching.ts';
import type { MeasuredRow } from './matching.ts';
import { DRIVERS } from '../config/drivers.ts';

let state = 23;
const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296 - .5; };
const day = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
// A price path whose period returns are the given numbers.
const prices = (returns: number[], start = 100): PricePoint[] => returns.reduce<PricePoint[]>((rows, r, i) => [...rows, { date: day(i + 1), close: rows[i].close * (1 + r) }], [{ date: day(0), close: start }]);
const levels = (changes: number[], start = 4): PricePoint[] => changes.reduce<PricePoint[]>((rows, c, i) => [...rows, { date: day(i + 1), close: rows[i].close + c }], [{ date: day(0), close: start }]);
const row = (symbol: string, driver: string, b: number, effect: number | null, overrides: Partial<MeasuredRow> = {}): MeasuredRow =>
    ({ symbol, driver, b, se: Math.abs(b) / 10, low: b * .8, high: b * 1.2, days: 500, reliable: true, computed_at: new Date('2026-10-10T00:00:00Z'), effect, ...overrides });

describe('driver registry', () => {
    it('maps every measurable tag to exactly one series and keeps the original drivers', () => {
        expect(drivers).toMatchObject({ 'oil': 'CL=F', 'fed-rates': 'DGS2', 'inflation': 'DGS2', 'sp500': 'SPY', 'treasury-yields': 'DGS10', 'mortgage-rates': 'MORTGAGE30US' });
        expect(new Set(DRIVERS.flatMap(d => d.tags)).size).toBe(DRIVERS.flatMap(d => d.tags).length);
    });
});

describe('changes and typical effect', () => {
    it('takes no return into or out of a non-positive price', () => {
        // Crude futures around 2020-04-20: the close below zero must not become a -306% return.
        const oil = [{ date: '2020-04-16', close: 19.87 }, { date: '2020-04-17', close: 18.27 }, { date: '2020-04-20', close: -37.63 }, { date: '2020-04-21', close: 10.01 }, { date: '2020-04-22', close: 13.78 }];
        const result = alignedChanges([oil]);
        expect(result.dates).toEqual(['2020-04-17', '2020-04-22']);
        expect(Math.min(...result.columns[0])).toBeGreaterThan(-1);
        // Yield differences are unaffected: a yield can fall through zero.
        expect(alignedChanges([[{ date: '1', close: .1 }, { date: '2', close: -.1 }]], [0]).columns[0][0]).toBeCloseTo(-.2);
    });
    it('measures a typical change and scales a coefficient by it', () => {
        expect(standardDeviation([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5));
        expect(typicalEffect(-.5, [1, 2, 3, 4, 5])).toBeCloseTo(.5 * Math.sqrt(2.5));
        expect(() => standardDeviation([1])).toThrow();
    });
});

describe('measuring one holding against one driver', () => {
    state = 23;
    const market = Array.from({ length: 400 }, () => random() * .02), oil = Array.from({ length: 400 }, () => random() * .05);
    const spy = prices(market), crude = prices(oil);
    it('recovers an oil sensitivity with the market held fixed and reports its typical effect', () => {
        const stock = prices(market.map((m, i) => m + .3 * oil[i] + random() * .004));
        const link = measureLink('XOM', 'CL=F', false, stock, crude, spy);
        expect(link.b).toBeCloseTo(.3, 1);
        expect(link.reliable).toBe(true);
        expect(link.effect).toBeCloseTo(Math.abs(link.b) * standardDeviation(oil), 6);
    });
    it('measures yields on differences in percentage points', () => {
        const changes = Array.from({ length: 400 }, () => random() * .2);
        const fund = prices(changes.map((c, i) => -.08 * c + .1 * market[i] + random() * .002));
        const link = measureLink('TLT', 'DGS10', true, fund, levels(changes), spy);
        expect(link.b).toBeCloseTo(-.08, 2);
        expect(link.reliable).toBe(true);
    });
    it('does not measure the market against another driver while holding the market fixed', () => {
        expect(() => measureLink('SPY', 'CL=F', false, spy, crude, spy)).toThrow();
        expect(measureLink('SPY', 'SPY', false, spy, spy, spy).b).toBeCloseTo(1);
    });
    it('rejects a link whose typical effect is numerical noise, even with a tight range', () => {
        // An index fund against the market: an almost exact fit makes any tiny oil coefficient look certain.
        const fund = prices(market.map((m, i) => m + 1e-5 * oil[i] + random() * 1e-9));
        const link = measureLink('VOO', 'CL=F', false, fund, crude, spy);
        expect(link.effect).toBeLessThan(.0001);
        expect(link.reliable).toBe(false);
    });
});

describe('which driver matters most', () => {
    const rows = [row('TLT', 'SPY', .085, .0009), row('TLT', 'DGS10', -.16, .0085), row('TLT', 'DGS2', -.095, .0052), row('TLT', 'CL=F', -.008, .0002),
        row('TLT', 'MORTGAGE30US', -.05, .02), row('XOM', 'CL=F', .3, .007), row('XOM', 'SPY', .9, .009), row('XOM', 'DGS2', .01, .004, { reliable: false })];
    it('ranks a holding by typical daily effect, leaving out weekly, unreliable and unscored rows', () => {
        expect(rankDrivers('TLT', rows).map(r => r.driver)).toEqual(['DGS10', 'DGS2', 'SPY', 'CL=F']);
        expect(rankDrivers('XOM', rows)).toEqual([{ driver: 'SPY', typicalEffect: .009 }, { driver: 'CL=F', typicalEffect: .007 }]);
        expect(rankDrivers('TLT', [row('TLT', 'SPY', .085, null)])).toEqual([]);
    });
    it('tells an oil link on a bond fund that rates matter more, and an oil link on an oil stock its own size', () => {
        const bond = matchHolding({ symbol: 'TLT', valueUsd: 100 }, ['oil'], ['oil'], rows);
        expect(bond?.sensitivity).toMatchObject({ driver: 'CL=F', typicalEffect: .0002 });
        expect(bond?.lead).toEqual({ driver: 'DGS10', typicalEffect: .0085 });
        expect(matchHolding({ symbol: 'XOM', valueUsd: 100 }, ['oil'], ['oil'], rows)?.lead?.driver).toBe('SPY');
    });
    it('uses the strongest driver when an event carries tags for several', () => {
        const link = matchHolding({ symbol: 'TLT', valueUsd: 100 }, ['fed-rates', 'treasury-yields'], ['fed-rates', 'treasury-yields'], rows);
        expect(link?.sensitivity?.driver).toBe('DGS10');
    });
});

describe('odds that moved over the day', () => {
    const event = { ticker: 'E', links: [{ symbol: 'XOM' }], markets: [{ ticker: 'UP', title: 'Up' }, { ticker: 'SMALL', title: 'Small' }, { ticker: 'DOWN', title: 'Down' }, { ticker: 'ONE-SIDED', title: 'One-sided' }] } as unknown as ExposureEvent;
    it('keeps moves of three points or more and needs a quote at both ends of the window', () => {
        const quotes = [{ ticker: 'UP', side: 'end' as const, mid: .62 }, { ticker: 'UP', side: 'start' as const, mid: .5 }, { ticker: 'SMALL', side: 'end' as const, mid: .52 }, { ticker: 'SMALL', side: 'start' as const, mid: .5 },
            { ticker: 'DOWN', side: 'end' as const, mid: .3 }, { ticker: 'DOWN', side: 'start' as const, mid: .345 }, { ticker: 'ONE-SIDED', side: 'end' as const, mid: .9 }];
        const moves = oddsChanges([event], quotes);
        expect(moves.map(m => m.ticker)).toEqual(['UP', 'DOWN']);
        expect(moves[0].changePoints).toBeCloseTo(12);
        expect(moves[1].changePoints).toBeCloseTo(-4.5);
        expect(moves[0].links).toBe(event.links);
    });
});

describe('what mattered most on a day', () => {
    it('compares each driver in dollars and puts the largest first whatever its direction', () => {
        expect(driverContribution(.3, -.04, 10000)).toBe(-120);
        const ranked = rankMoves([{ driver: 'SPY', contribution: 30 }, { driver: 'CL=F', contribution: -120 }, { driver: 'DGS10', contribution: 45.5 }]);
        expect(ranked.map(m => m.driver)).toEqual(['CL=F', 'DGS10', 'SPY']);
    });
    it('sums each driver across holdings in whole cents', () => {
        expect(sumByDriver([{ driver: 'SPY', contribution: 10.1 }, { driver: 'CL=F', contribution: -120.2 }, { driver: 'SPY', contribution: 20.2 }, { driver: 'CL=F', contribution: 5.05 }]))
            .toEqual([{ driver: 'CL=F', contribution: -115.15 }, { driver: 'SPY', contribution: 30.3 }]);
    });
});
