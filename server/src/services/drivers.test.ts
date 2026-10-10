import { describe, expect, it } from 'vitest';
import { alignedChanges, standardDeviation, typicalEffect } from '../math/series.ts';
import type { PricePoint } from '../math/series.ts';
import { driverContribution, rankMoves, sumByDriver } from '../math/move.ts';
import { oddsChanges } from './moves.ts';
import type { ExposureEvent } from '../../../shared/types.ts';
import { measureLink } from '../jobs/measure.ts';
import { drivers, matchHolding, materialRows, rankDrivers, strongestPerFamily } from './matching.ts';
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
    it('tells a link on a lesser driver what matters more', () => {
        // Rates are the bond fund's biggest driver; the 2-year yield is a lesser one, but well above the floor.
        const lesser = matchHolding({ symbol: 'TLT', valueUsd: 100 }, ['fed-rates'], ['fed-rates'], rows);
        expect(lesser?.type).toBe('Measured');
        expect(lesser?.sensitivity).toMatchObject({ driver: 'DGS2', typicalEffect: .0052 });
        expect(lesser?.lead).toEqual({ driver: 'DGS10', typicalEffect: .0085 });
        expect(matchHolding({ symbol: 'XOM', valueUsd: 100 }, ['oil'], ['oil'], rows)?.lead?.driver).toBe('SPY');
    });
    it('draws no link from a measurement that is faint next to the holding’s biggest driver', () => {
        // Oil moves the bond fund about 2% as much as the 10-year yield does: reliable, and far under a tenth.
        const faint = matchHolding({ symbol: 'TLT', valueUsd: 100 }, ['oil'], ['oil'], rows);
        expect(faint).toMatchObject({ type: 'Related', sensitivity: null, lead: { driver: 'DGS10', typicalEffect: .0085 } });
        expect(faint?.evidence).toBe('Measured against CL=F, but small: a typical move in it moves TLT about 2.4% as much as a typical move in DGS10. Under the 10% floor for a link, so no move estimate is shown.');
        // The stock market at about 11% clears the floor, as the 2-year yield at 61% does.
        expect(materialRows('TLT', rows).map(r => r.driver).sort()).toEqual(['DGS10', 'DGS2', 'MORTGAGE30US', 'SPY']);
        expect(matchHolding({ symbol: 'TLT', valueUsd: 100 }, ['sp500'], ['sp500'], rows)).toMatchObject({ type: 'Measured', lead: { driver: 'DGS10' } });
        // With several topics on one event, a faint one does not stop a sizeable one from linking.
        expect(matchHolding({ symbol: 'TLT', valueUsd: 100 }, ['oil', 'fed-rates'], ['oil', 'fed-rates'], rows)).toMatchObject({ type: 'Measured', sensitivity: { driver: 'DGS2' } });
    });
    it('sets the floor at a tenth of the biggest driver, and keeps what it cannot size', () => {
        const sized = (effect: number | null) => [row('JPM', 'SPY', .9, .01), row('JPM', 'CL=F', .02, effect)];
        expect(materialRows('JPM', sized(.0009)).map(r => r.driver)).toEqual(['SPY']);
        expect(materialRows('JPM', sized(.0011)).map(r => r.driver)).toEqual(['SPY', 'CL=F']);
        // An airline's oil link, at 11% and 13% of what the stock market does to it, is kept.
        expect(matchHolding({ symbol: 'DAL', valueUsd: 100 }, ['oil'], ['oil'], [row('DAL', 'SPY', 1.44, .0144), row('DAL', 'CL=F', -.06, .00176)])).toMatchObject({ type: 'Measured', sensitivity: { driver: 'CL=F' }, lead: { driver: 'SPY' } });
        // A row stored before sizes were kept cannot be judged, so it still links.
        expect(materialRows('JPM', sized(null)).map(r => r.driver)).toEqual(['SPY', 'CL=F']);
        expect(materialRows('JPM', [row('JPM', 'CL=F', .02, .0001)]).map(r => r.driver)).toEqual(['CL=F']);
        expect(materialRows('JPM', [row('JPM', 'SPY', .9, .01, { reliable: false }), row('JPM', 'CL=F', .02, .0001)]).map(r => r.driver)).toEqual(['CL=F']);
    });
    it('links a weekly driver only for a holding tied to that kind of driver day to day', () => {
        // Mortgage rates are measured weekly and cannot be put on the daily scale.
        const airline = [row('UAL', 'SPY', 1.6, .016), row('UAL', 'DGS2', .02, .0014), row('UAL', 'MORTGAGE30US', .03, .0085)];
        const builder = [row('ITB', 'SPY', 1.1, .011), row('ITB', 'DGS10', -.05, .004), row('ITB', 'MORTGAGE30US', -.02, .0031)];
        expect(materialRows('UAL', airline).map(r => r.driver)).toEqual(['SPY']);
        expect(materialRows('ITB', builder).map(r => r.driver)).toEqual(['SPY', 'DGS10', 'MORTGAGE30US']);
        const faint = matchHolding({ symbol: 'UAL', valueUsd: 100 }, ['mortgage-rates'], ['mortgage-rates'], airline);
        expect(faint?.type).toBe('Related');
        expect(faint?.evidence).toBe('Measured against MORTGAGE30US, but small: UAL has no sizeable link to that kind of driver day to day; SPY matters most to it. Under the 10% floor for a link, so no move estimate is shown.');
        expect(matchHolding({ symbol: 'ITB', valueUsd: 100 }, ['mortgage-rates'], ['mortgage-rates'], builder)?.type).toBe('Measured');
        // Nothing daily to compare against: the weekly link stands.
        expect(matchHolding({ symbol: 'NEW', valueUsd: 100 }, ['mortgage-rates'], ['mortgage-rates'], [row('NEW', 'MORTGAGE30US', .03, .008)])?.type).toBe('Measured');
    });
    it('compares one yield per holding on a given day, the one that typically matters most', () => {
        const tlt = rows.filter(r => r.symbol === 'TLT' && r.driver !== 'SPY' && r.driver !== 'MORTGAGE30US');
        expect(strongestPerFamily(tlt).map(r => r.driver).sort()).toEqual(['CL=F', 'DGS10']);
        // With only the 2-year yield published for the date, it stands in for rates.
        expect(strongestPerFamily(tlt.filter(r => r.driver !== 'DGS10')).map(r => r.driver).sort()).toEqual(['CL=F', 'DGS2']);
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
