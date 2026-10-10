import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExposureEvent, Sensitivity } from '../../shared/types';
import { describeCalculation, describeDrivers, describeImportance, describeLeadMove, describeSensitivity } from './screens/sensitivity';
import { filterCalendarEvents, defaultCalendarFilters } from './screens/calendar-filters';
import { eventHoldings } from './screens/exposure-table';
import { LeadDrivers } from './screens/moves';
import { EventList, LinkChip, linkLabel } from './common';

const measured = (driver: string, b: number, low: number, high: number, typicalEffect: number | null = null): Sensitivity => ({ driver, b, low, high, days: 2480, computedAt: '2026-10-09T00:00:00Z', typicalEffect });

describe('plain-language sensitivity', () => {
    it('restates an oil coefficient per 1% move with its range and sample size', () => {
        expect(describeSensitivity('XOM', measured('CL=F', .31, .26, .36))).toBe(
            'On days crude oil futures rose 1%, XOM rose 0.31% on average, after accounting for the overall market. The 95% range is +0.26% to +0.36%, measured over 2,480 trading days.');
    });
    it('uses a tenth of a percentage point for yields and says fell for a negative coefficient', () => {
        // b is per one percentage point of yield: −0.012 per point is −0.12% per 0.10 points.
        expect(describeSensitivity('TLT', measured('DGS2', -.012, -.014, -.01))).toBe(
            'On days the 2-year Treasury yield rose 0.10 percentage points, TLT fell 0.12% on average, after accounting for the overall market. The 95% range is −0.14% to −0.10%, measured over 2,480 trading days.');
    });
    it('describes beta without a market control and keeps small effects visible', () => {
        expect(describeSensitivity('AAPL', measured('SPY', 1.2, 1.15, 1.25))).toContain('On days the S&P 500 (SPY) rose 1%, AAPL rose 1.20% on average. The 95% range');
        expect(describeSensitivity('DAL', measured('CL=F', -.04, -.07, -.01))).toContain('DAL fell 0.040% on average');
    });
    it('writes no sentence for an unknown driver or an invalid measurement', () => {
        expect(describeSensitivity('AAPL', measured('GOLD', .1, .05, .15))).toBeNull();
        expect(describeSensitivity('AAPL', measured('SPY', Number.NaN, 1, 1.2))).toBeNull();
    });
});

describe('highlighting what matters most', () => {
    const link = (symbol: string, sensitivity: Sensitivity, lead: { driver: string; typicalEffect: number } | null) => ({ symbol, valueUsd: 100, type: 'Measured' as const, evidence: '', sensitivity, lead });
    it('describes the new yield and weekly mortgage drivers in their own periods', () => {
        expect(describeSensitivity('TLT', measured('DGS10', -.16, -.17, -.15))).toContain('On days the 10-year Treasury yield rose 0.10 percentage points, TLT fell 1.60% on average');
        const mortgage = describeSensitivity('VNQ', measured('MORTGAGE30US', -.02, -.03, -.01))!;
        expect(mortgage).toContain('In weeks the 30-year mortgage rate rose 0.10 percentage points, VNQ fell 0.20% on average');
        expect(mortgage).toContain('measured over 2,480 weeks.');
    });
    it('marks the main driver and, on a minor link, names what matters more with both sizes', () => {
        const rates = { driver: 'DGS10', typicalEffect: .0085 };
        expect(describeImportance(link('TLT', measured('DGS10', -.16, -.17, -.15, .0085), rates))).toEqual({ lead: true, text: 'Most important measured driver for TLT: a typical day’s move in it moves TLT about 0.85%.' });
        expect(describeImportance(link('TLT', measured('CL=F', -.008, -.014, -.003, .0002), rates))).toEqual({ lead: false,
            text: '10-year Treasury yield matters more for TLT: a typical day’s move in it moves TLT about 0.85%, against 0.02% for crude oil.' });
        // Oil ahead of the stock market for an oil fund.
        expect(describeImportance(link('USO', measured('SPY', .4, .3, .5, .004), { driver: 'CL=F', typicalEffect: .021 }))?.text).toBe(
            'Crude oil matters more for USO: a typical day’s move in it moves USO about 2.10%, against 0.40% for stock market (s&p 500).');
        expect(describeImportance(link('AAPL', measured('SPY', 1.2, 1.1, 1.3, .012), null))).toBeNull();
        // A weekly driver is not put on the daily scale.
        expect(describeImportance(link('VNQ', measured('MORTGAGE30US', -.02, -.03, -.01, .004), rates))?.text).toBe('10-year Treasury yield matters more for VNQ: a typical day’s move in it moves VNQ about 0.85%.');
    });
    it('lists a holding’s drivers and the day’s biggest driver, largest first', () => {
        expect(describeDrivers([{ driver: 'DGS10', typicalEffect: .0085 }, { driver: 'SPY', typicalEffect: .0009 }])).toBe('Moves most with 10-year treasury yield (about 0.85% on a typical day); then stock market (s&p 500) 0.09%.');
        expect(describeDrivers([])).toBeNull();
        const money = (value: number) => `$${value.toFixed(2)}`;
        expect(describeLeadMove([{ driver: 'CL=F', contribution: -310 }, { driver: 'SPY', contribution: 120 }], money)).toBe('Crude oil mattered most: about $-310.00 of your move, ahead of stock market (s&p 500) at about $120.00.');
        expect(describeLeadMove([], money)).toBeNull();
    });
    it('shows the ranked drivers on the Moves screen and says which could not be compared', () => {
        const drivers = [{ driver: 'CL=F', contribution: -310 }, { driver: 'SPY', contribution: 120 }];
        const changes = [{ driver: 'SPY', kind: 'return' as const, change: .0116 }, { driver: 'CL=F', kind: 'return' as const, change: -.0437 }];
        const html = renderToStaticMarkup(<LeadDrivers drivers={drivers} changes={changes} missing={['DGS2', 'DGS10']}/>);
        expect(html).toContain('Crude oil mattered most');
        expect(html.indexOf('Crude oil</span>')).toBeLessThan(html.indexOf('Stock market (S&amp;P 500)</span>'));
        expect(html).toContain('class="driver-bar lead"');
        // Each driver is shown with how far it moved itself over the window.
        expect(html).toContain('<span>Crude oil</span><span class="note driver-change">fell 4.4%</span><strong class="mono orange">-$310.00</strong>');
        expect(html).toContain('<span class="note driver-change">rose 1.2%</span><strong class="mono blue">$120.00</strong>');
        expect(html).toContain('not published yet: 2-year Treasury yield, 10-year Treasury yield.');
        expect(renderToStaticMarkup(<LeadDrivers drivers={[]} changes={[]} missing={[]}/>)).toContain('No measured driver could be compared');
        // For one holding it says whose move it is.
        const one = renderToStaticMarkup(<LeadDrivers drivers={drivers} changes={changes} missing={[]} subject="XOM"/>);
        expect(one).toContain('<h2>What mattered most for XOM</h2>');
        expect(one).toContain('Crude oil mattered most: about -$310.00 of XOM’s move');
    });
});

describe('figures calculated from a holding’s own terms', () => {
    const money = (value: number) => `$${value.toFixed(2)}`;
    const link = (symbol: string, calculation: { kind: 'income' | 'price' | 'payment'; perPointUsd: number; rate: string; duration?: number }) => ({ symbol, valueUsd: 50000, type: 'Calculated' as const, evidence: '', sensitivity: null, calculation });
    it('restates each kind for a quarter-point move without estimating anything', () => {
        expect(describeCalculation(link('SAVINGS', { kind: 'income', perPointUsd: 500, rate: 'the rate it earns' }), money)).toBe('Each 0.25 percentage point change in the rate it earns changes the yearly interest on SAVINGS by $125.00.');
        expect(describeCalculation(link('TNOTE', { kind: 'price', perPointUsd: -817.57, rate: 'its own yield', duration: 8.1757 }), money)).toBe('A 0.25 percentage point rise in its yield lowers the market value of TNOTE by about $204.39 (modified duration 8.18 years). Held to maturity it still repays its face value.');
        expect(describeCalculation(link('HOME', { kind: 'payment', perPointUsd: 2000, rate: 'the mortgage rate' }), money)).toBe('Each 0.25 percentage point change in the mortgage rate changes the yearly interest on HOME’s adjustable mortgage by $500.00.');
        expect(describeCalculation({ symbol: 'AAPL', valueUsd: 1, type: 'Direct', evidence: '', sensitivity: null }, money)).toBeNull();
    });
    it('labels Calculated links and counts them as affected, ahead of measured ones', () => {
        expect(linkLabel('Calculated')).toBe('Calculated');
        // The chip is unchanged; it now sits beside an explanation that opens when pointed at.
        expect(renderToStaticMarkup(<LinkChip type="Calculated"/>)).toContain('><span class="chip Calculated">Calculated</span><span role="tooltip"');
        expect(renderToStaticMarkup(<LinkChip type="Calculated"/>).match(/class="chip /g)).toHaveLength(1);
        const event = { ticker: 'FED', title: 'Fed decision', category: 'Economics', closeTime: '2026-11-03T00:00:00Z', eventTime: '2026-11-03T00:00:00Z', eventTimeSource: 'close', linkedValue: 150, share: .5, mutuallyExclusive: false, markets: [],
            links: [{ symbol: 'TLT', valueUsd: 100, type: 'Measured', evidence: '', sensitivity: null }, { symbol: 'SAVINGS', valueUsd: 50, type: 'Calculated', evidence: '', sensitivity: null }] } as ExposureEvent;
        expect(filterCalendarEvents([event], { ...defaultCalendarFilters, link: 'Affected', holding: 'SAVINGS' })).toHaveLength(1);
        expect(filterCalendarEvents([event], { ...defaultCalendarFilters, link: 'Calculated', holding: 'TLT' })).toHaveLength(0);
        const holdings = [{ symbol: 'TLT', valueUsd: 100 }, { symbol: 'SAVINGS', valueUsd: 50 }];
        expect(eventHoldings(event, holdings, 'All').map(row => row.holding.symbol)).toEqual(['SAVINGS', 'TLT']);
        expect(eventHoldings(event, holdings, 'Calculated').map(row => row.holding.symbol)).toEqual(['SAVINGS']);
    });
});

describe('link labels', () => {
    it('uses the Overview vocabulary on every screen', () => {
        expect([linkLabel('Direct'), linkLabel('Measured'), linkLabel('Related')]).toEqual(['Direct', 'Related', 'Topic']);
        expect(renderToStaticMarkup(<LinkChip type="Measured"/>)).toContain('><span class="chip Measured">Related</span><span role="tooltip"');
        // The explanation names the link by the same word as the chip, never by the API's.
        expect(renderToStaticMarkup(<LinkChip type="Measured"/>)).toContain('<strong>Related link</strong>');
        expect(renderToStaticMarkup(<LinkChip type="Measured"/>)).not.toContain('Measured link');
        expect(renderToStaticMarkup(<LinkChip type="Direct">AAPL</LinkChip>)).toBe('<span class="chip Direct" title="Direct">AAPL</span>');
    });
    it('colours each linked holding by its connection in event lists', () => {
        const event = { ticker: 'E', title: 'Oil above $90', category: 'Commodities', closeTime: '2026-11-12T15:00:00Z', eventTime: '2026-10-29T21:00:00Z', eventTimeSource: 'occurrence', linkedValue: 200, share: .5, mutuallyExclusive: false, markets: [],
            links: [{ symbol: 'XOM', valueUsd: 100, type: 'Measured', evidence: '', sensitivity: null }, { symbol: 'DAL', valueUsd: 100, type: 'Related', evidence: '', sensitivity: null }] } as ExposureEvent;
        const html = renderToStaticMarkup(<EventList events={[event]}/>);
        expect(html).toContain('<span class="chip Measured" title="Related">XOM</span>');
        expect(html).toContain('<span class="chip Related" title="Topic">DAL</span>');
        // The event date and the later market close are both shown, each labelled.
        expect(html).toContain('<time dateTime="2026-10-29T21:00:00Z">');
        expect(html).toContain('Kalshi event time');
        expect(html).toContain('market closes <time dateTime="2026-11-12T15:00:00Z">');
    });
});
