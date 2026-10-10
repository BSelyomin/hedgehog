import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExposureEvent, Sensitivity } from '../../shared/types';
import { describeSensitivity } from './screens/sensitivity';
import { EventList, LinkChip, linkLabel } from './common';

const measured = (driver: string, b: number, low: number, high: number): Sensitivity => ({ driver, b, low, high, days: 2480, computedAt: '2026-10-09T00:00:00Z' });

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

describe('link labels', () => {
    it('uses the Overview vocabulary on every screen', () => {
        expect([linkLabel('Direct'), linkLabel('Measured'), linkLabel('Related')]).toEqual(['Direct', 'Related', 'Topic']);
        expect(renderToStaticMarkup(<LinkChip type="Measured"/>)).toBe('<span class="chip Measured">Related</span>');
        expect(renderToStaticMarkup(<LinkChip type="Direct">AAPL</LinkChip>)).toBe('<span class="chip Direct" title="Direct">AAPL</span>');
    });
    it('colours each linked holding by its connection in event lists', () => {
        const event = { ticker: 'E', title: 'Oil above $90', category: 'Commodities', closeTime: '2026-11-03T00:00:00Z', linkedValue: 200, share: .5, mutuallyExclusive: false, markets: [],
            links: [{ symbol: 'XOM', valueUsd: 100, type: 'Measured', evidence: '', sensitivity: null }, { symbol: 'DAL', valueUsd: 100, type: 'Related', evidence: '', sensitivity: null }] } as ExposureEvent;
        const html = renderToStaticMarkup(<EventList events={[event]}/>);
        expect(html).toContain('<span class="chip Measured" title="Related">XOM</span>');
        expect(html).toContain('<span class="chip Related" title="Topic">DAL</span>');
    });
});
