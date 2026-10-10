import { describe, expect, it } from 'vitest';
import type { EarningsReportMove, ExposureEvent, Market } from '../../../shared/types.ts';
import { callSession, evenOdds, featuredMetric, isEarningsCall, isReportedMetric, isResultsEvent, medianTrust, metricFor, thresholdLadder, typicalMove, upcomingCall } from './earnings-preview.ts';

const market = (ticker: string, subtitle: string, probability: number | null, floorStrike: number | null, total: number | null = 50, kind: Market['kind'] = 'kpi'): Market =>
    ({ ticker, title: 'Test', subtitle, probability, spread: null, asOf: null, kind, floorStrike,
        trust: { total, band: total === null ? null : total >= 80 ? 'High' : total >= 60 ? 'Medium' : 'Low', spread: null, activity: null, depth: null, trackRecord: null, categoryCount: 0, spreadCents: null } });
const event = (title: string, category: string, markets: Market[], overrides: Partial<ExposureEvent> = {}): ExposureEvent =>
    ({ ticker: title, title, category, closeTime: '2026-11-12T15:00:00Z', eventTime: '2026-11-12T15:00:00Z', eventTimeSource: 'close', linkedValue: 0, share: 0, links: [], mutuallyExclusive: false, markets, ...overrides });
const levels = (...strikes: number[]) => strikes.map(s => market(`T${s}`, `Above ${s}`, .5, s));

describe('which company markets are about results', () => {
    // Titles and shapes as Kalshi lists them.
    it('keeps the earnings call and numeric metrics for a reporting period', () => {
        expect(isEarningsCall(event('What will Apple say during their next earnings call?', 'Mentions', [market('W', 'Apple Pay', .7, null, 50, 'mention')]))).toBe(true);
        for (const title of ['Apple headcount in 2026', 'Amazon headcount in Q3', 'Airbnb Inc. nights & experiences booked in fiscal 2026', 'Ford total vehicle US sales in Q1 2027', "Lowe's comparable sales growth in Q3", 'Tesla total production in 2026'])
            expect(isReportedMetric(event(title, 'Financials', levels(1, 2, 3))), title).toBe(true);
    });
    it('leaves out keynotes, monthly third-party data, products, lawsuits, prices and rankings', () => {
        expect(isResultsEvent(event('What will Satya Nadella say during Microsoft Ignite keynote?', 'Mentions', [market('W', 'Copilot', .9, null, 50, 'mention')]))).toBe(false);
        for (const title of ['Amazon Credit Card Spend in October', 'Costco Foot Traffic in October', 'Gemini App Downloads in October 2026', 'NVIDIA H100 · Average hourly price in June 2027', 'Price of NVIDIA B200 compute by Dec 31, 2026?'])
            expect(isResultsEvent(event(title, 'Financials', levels(1, 2, 3))), title).toBe(false);
        // A period in the title is not enough: the outcomes must be numeric levels.
        for (const title of ['Top artist on Spotify in 2026?', 'Where will Waymo operate in 2026?', 'Will any of Google, Meta, Amazon, Tesla, or X accept crypto for any of their core services in 2026?'])
            expect(isResultsEvent(event(title, 'Entertainment', [market('A', 'Option A', .5, null), market('B', 'Option B', .5, null)])), title).toBe(false);
        expect(isResultsEvent(event('Will Apple release a Macbook with cellular connectivity before 2027?', 'Science and Technology', [market('Y', 'Before 2027', .12, null)]))).toBe(false);
    });
});

describe('reading a ladder of "above X" markets', () => {
    // Apple headcount in 2026, midpoints from Kalshi on 2026-10-10.
    const headcount = event('Apple headcount in 2026', 'Financials', [market('C', 'Above 168000', .67, 168000, 40), market('A', 'Above 164000', .92, 164000, 55), market('D', 'Above 170000', .44, 170000, 35), market('B', 'Above 166000', .86, 166000, 45)]);
    it('orders the levels and finds the two either side of even odds', () => {
        const ladder = thresholdLadder(headcount)!;
        expect(ladder.map(t => t.strike)).toEqual([164000, 166000, 168000, 170000]);
        expect(evenOdds(ladder)).toEqual({ above: ladder[2], below: ladder[3] });
        const metric = metricFor(headcount);
        expect(metric.evenOdds?.above?.label).toBe('Above 168000');
        expect(metric.trust).toEqual({ total: 42.5, band: 'Low', markets: 4 });
    });
    it('reports an open end when every level is on one side of even odds', () => {
        const likely = thresholdLadder(event('Fare in fiscal 2026', 'Financials', [market('A', 'Above $205', .985, 205), market('B', 'Above $210', .985, 210), market('C', 'Above $215', .9, 215)]))!;
        expect(evenOdds(likely)).toEqual({ above: likely[2], below: null });
        const unlikely = thresholdLadder(event('Seats in Q3', 'Financials', [market('A', 'Above 56 million', .3, 56), market('B', 'Above 57 million', .1, 57)]))!;
        expect(evenOdds(unlikely)).toEqual({ above: null, below: unlikely[0] });
    });
    it('gives no reading when a quote is missing or the odds rise with the level', () => {
        expect(evenOdds(thresholdLadder(event('X in Q3', 'Financials', [market('A', 'Above 1', .8, 1), market('B', 'Above 2', null, 2)]))!)).toBeNull();
        expect(evenOdds(thresholdLadder(event('X in Q3', 'Financials', [market('A', 'Above 1', .4, 1), market('B', 'Above 2', .6, 2)]))!)).toBeNull();
        // A single market or a range ladder is not a ladder of thresholds.
        expect(thresholdLadder(event('X in Q3', 'Financials', [market('A', 'Above 1', .4, 1)]))).toBeNull();
        expect(thresholdLadder(event('X in Q3', 'Financials', [market('A', '1 to 2', .4, 1, 50, 'bracket'), market('B', '2 to 3', .6, 2, 50, 'bracket')]))).toBeNull();
        expect(metricFor(event('X in Q3', 'Financials', [market('A', '1 to 2', .4, 1, 50, 'bracket'), market('B', '2 to 3', .6, 2, 50, 'bracket')]))).toMatchObject({ thresholds: [], evenOdds: null });
    });
    it('leads with the best-supported metric that gives a clear reading', () => {
        const clear = metricFor(headcount);
        const stronger = metricFor(event('Apple stores in fiscal 2026', 'Financials', [market('S1', 'Above 530', .8, 530, 70), market('S2', 'Above 540', .3, 540, 70)]));
        const unreadable = metricFor(event('Apple margin in Q4', 'Financials', [market('M1', 'Above 46%', .4, 46, 95), market('M2', 'Above 47%', .6, 47, 95)]));
        expect(featuredMetric([clear, unreadable, stronger])?.title).toBe('Apple stores in fiscal 2026');
        expect(featuredMetric([unreadable])).toBeNull();
    });
    it('summarises a group of markets by its median trust score and ignores unscored ones', () => {
        expect(medianTrust([market('A', 'a', .5, null, 90), market('B', 'b', .5, null, 30), market('C', 'c', .5, null, 62), market('D', 'd', .5, null, null)])).toEqual({ total: 62, band: 'Medium', markets: 3 });
        expect(medianTrust([market('D', 'd', .5, null, null)])).toBeNull();
    });
});

describe('the next earnings call', () => {
    const call = (time: string, source: ExposureEvent['eventTimeSource'] = 'occurrence') => event('What will Apple say during their next earnings call?', 'Mentions',
        [market('A', 'Tariffs', .78, null, 40, 'mention'), market('B', 'AI', .96, null, 60, 'mention'), market('C', 'Recession', null, null, null, 'mention')], { ticker: `CALL-${time}`, eventTime: time, eventTimeSource: source });
    const now = Date.parse('2026-10-10T12:00:00Z');
    it('places a call before the open, during trading or after the close in New York', () => {
        expect(callSession('2026-10-29T21:00:00Z')).toBe('after-close');     // 5:00 pm EDT
        expect(callSession('2026-10-13T12:30:00Z')).toBe('before-open');     // 8:30 am EDT
        expect(callSession('2026-10-13T15:00:00Z')).toBe('market-hours');    // 11:00 am EDT
        expect(callSession('2026-10-13T13:30:00Z')).toBe('market-hours');    // the open itself
        expect(callSession('2026-12-01T21:00:00Z')).toBe('after-close');     // 4:00 pm EST
    });
    it('uses the soonest call Kalshi has dated and lists its topics from most to least likely', () => {
        const next = upcomingCall([call('2027-01-28T22:00:00Z'), call('2026-10-29T21:00:00Z')], now)!;
        expect(next).toMatchObject({ eventTicker: 'CALL-2026-10-29T21:00:00Z', time: '2026-10-29T21:00:00Z', session: 'after-close', trust: { total: 50, band: 'Low', markets: 2 } });
        expect(next.topics.map(t => t.word)).toEqual(['AI', 'Tariffs', 'Recession']);
    });
    it('does not treat a past call or a market close as an upcoming call', () => {
        expect(upcomingCall([call('2026-10-01T21:00:00Z')], now)).toBeNull();
        expect(upcomingCall([call('2026-11-12T15:00:00Z', 'close')], now)).toBeNull();
        expect(upcomingCall([event('Apple headcount in 2026', 'Financials', levels(1, 2), { eventTime: '2026-10-29T21:00:00Z', eventTimeSource: 'occurrence' })], now)).toBeNull();
    });
});

describe('typical move across past reports', () => {
    const report = (move: number | null): EarningsReportMove => ({ filingDate: '2026-01-01', sourceUrl: `https://www.sec.gov/${move}`, beforeDate: null, closeBefore: null, afterDate: null, closeAfter: null, move });
    it('is the average size of the moves, and that share of the holding in dollars', () => {
        // The eight moves in the design: they average 3.6%, which is $223.20 on $6,200.
        const typical = typicalMove([.021, -.048, .033, -.009, .062, -.026, .04, -.049].map(report), 6200)!;
        expect(typical.percent).toBeCloseTo(.036, 10);
        expect(typical.usd).toBe(223.2);
        expect(typical.reports).toBe(8);
    });
    it('needs at least four reports with a move', () => {
        expect(typicalMove([.02, -.03, null, null, .01].map(report), 1000)).toBeNull();
        expect(typicalMove([.02, -.03, null, .04, .01].map(report), 1000)).toMatchObject({ reports: 4, usd: 25 });
        expect(typicalMove([], 1000)).toBeNull();
    });
});
