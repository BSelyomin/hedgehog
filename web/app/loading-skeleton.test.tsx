import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadingSkeleton, type SkeletonLayout } from './loading-skeleton';
import { Status } from './common';
import { Overview } from './screens/overview';
import { Calendar } from './screens/calendar';
import { Moves } from './screens/moves';
import { EventPage } from './screens/event';
import { Earnings, EarningsDetail } from './screens/earnings';
import { OddsChart } from './screens/odds-chart';
import { AddHoldings } from './screens/holdings';

describe('shared loading states', () => {
    it.each<SkeletonLayout>(['rows', 'summary', 'detail', 'chart', 'compact'])('makes %s placeholders accessible without inventing data', layout => {
        const html = renderToStaticMarkup(<LoadingSkeleton layout={layout} label="Loading requested content"/>);
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain('Loading requested content');
        expect(html).not.toContain('100%');
    });
    it('replaces loading with an error and renders nothing after completion', () => {
        const error = renderToStaticMarkup(<Status error="Request timed out" loading layout="chart"/>);
        expect(error).toContain('role="alert"');
        expect(error).not.toContain('loading-skeleton');
        expect(renderToStaticMarkup(<Status error="" loading={false}/>)).toBe('');
    });
    it.each([
        ['Overview', <Overview/>], ['Calendar', <Calendar/>], ['Moves', <Moves/>],
        ['Event', <EventPage ticker="test"/>], ['Earnings', <Earnings/>],
        ['Company earnings', <EarningsDetail symbol="AAPL"/>], ['Odds', <OddsChart ticker="test" name="Test market"/>],
        ['Holdings', <AddHoldings/>],
    ])('shows a skeleton on %s before data arrives, without premature empty messages', (_name, component) => {
        const html = renderToStaticMarkup(component);
        expect(html).toContain('loading-skeleton');
        expect(html).not.toContain('No source data available yet');
        expect(html).not.toContain('0 events');
        expect(html).not.toContain('Add what you own to see which events reach your portfolio.');
    });
});
