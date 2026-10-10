import { describe, expect, it } from 'vitest';
import type { EarningsReportMove, ExposureEvent, Market } from '../../../shared/types.ts';
import { callSession, evenOdds, featuredMetric, isEarningsCall, isReportedMetric, isResultsEvent, medianTrust, metricFor, thresholdLadder, typicalMove, upcomingCall } from './earnings-preview.ts';
import { eventTime, newYorkNoon, statedDate } from './kalshi.ts';

const market = (ticker: string, subtitle: string, probability: number | null, floorStrike: number | null, total: number | null = 50, kind: Market['kind'] = 'kpi', spread: number | null = .1): Market =>
    ({ ticker, title: 'Test', subtitle, probability, spread: probability === null ? null : spread, asOf: null, kind, floorStrike,
        trust: { total, band: total === null ? null : total >= 80 ? 'High' : total >= 60 ? 'Medium' : 'Low', spread: null, activity: null, depth: null, trackRecord: null, categoryCount: 0, spreadCents: null } });
const event = (title: string, category: string, markets: Market[], overrides: Partial<ExposureEvent> = {}): ExposureEvent =>
    ({ ticker: title, title, category, closeTime: '2026-11-12T15:00:00Z', eventTime: '2026-11-12T15:00:00Z', eventTimeSource: 'close', linkedValue: 0, share: 0, links: [], mutuallyExclusive: false, markets, ...overrides });
const levels = (...strikes: number[]) => strikes.map(s => market(`T${s}`, `Above ${s}`, .5, s));
const quote = (strike: number, probability: number | null, spread = .1, total = 50) => market(`T${strike}`, `Above ${strike}`, probability, strike, total, 'kpi', spread);

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
    // Apple headcount in 2026 on 2026-10-10. The two least likely levels are two points out of order.
    const headcount = event('Apple headcount in 2026', 'Financials', [quote(168000, .67, .1, 40), quote(164000, .92, .08, 55), quote(174000, .17, .1, 30), quote(170000, .44, .1, 35), quote(166000, .86, .1, 45), quote(172000, .15, .14, 30)]);
    it('orders the levels and carries the bid and ask behind each midpoint', () => {
        const ladder = thresholdLadder(headcount)!;
        expect(ladder.map(t => t.strike)).toEqual([164000, 166000, 168000, 170000, 172000, 174000]);
        expect(ladder[2]).toMatchObject({ label: 'Above 168000', probability: .67, bid: .62, ask: .72 });
        expect(thresholdLadder(event('X in Q3', 'Financials', [quote(1, .8), quote(2, null)]))![1]).toMatchObject({ probability: null, bid: null, ask: null });
    });
    it('puts even odds between the highest level bid at 50% or more and the lowest asked at 50% or less', () => {
        const ladder = thresholdLadder(headcount)!;
        expect(evenOdds(ladder)).toEqual({ above: ladder[2], below: ladder[3] });
        const metric = metricFor(headcount);
        expect(metric.evenOdds?.above?.label).toBe('Above 168000');
        expect(metric.evenOdds?.below?.label).toBe('Above 170000');
        expect(metric.trust).toEqual({ total: 37.5, band: 'Low', markets: 6 });
    });
    it('passes over a level whose quote straddles even odds or is missing', () => {
        // Tesla production in Q1 2027: 425,000 was bid 26, asked 77.
        const tesla = thresholdLadder(event('Tesla production in Q1 2027', 'Financials', [quote(400000, .775, .09), quote(425000, .515, .51), quote(450000, .35, .08)]))!;
        expect(evenOdds(tesla)).toEqual({ above: tesla[0], below: tesla[2] });
        const gap = thresholdLadder(event('X in Q3', 'Financials', [quote(1, .8), quote(2, null), quote(3, .3)]))!;
        expect(evenOdds(gap)).toEqual({ above: gap[0], below: gap[2] });
        // A midpoint just over 50% with the bid under it is not clearly likely.
        const near = thresholdLadder(event('X in Q3', 'Financials', [quote(1, .9), quote(2, .52, .1), quote(3, .2)]))!;
        expect(evenOdds(near)).toEqual({ above: near[0], below: near[2] });
    });
    it('reports an open end when every firm level is on one side of even odds', () => {
        const likely = thresholdLadder(event('Fare in fiscal 2026', 'Financials', [quote(205, .985, .01), quote(210, .985, .01), quote(215, .9)]))!;
        expect(evenOdds(likely)).toEqual({ above: likely[2], below: null });
        const unlikely = thresholdLadder(event('Seats in Q3', 'Financials', [quote(56, .3), quote(57, .1)]))!;
        expect(evenOdds(unlikely)).toEqual({ above: null, below: unlikely[0] });
    });
    it('gives no reading when no level is clearly on a side or the sides are out of order', () => {
        // Empty books: bid 0, ask 1.
        expect(evenOdds(thresholdLadder(event('X in Q3', 'Financials', [quote(1, .5, 1), quote(2, .5, 1)]))!)).toBeNull();
        // A lower level called unlikely while a higher one is called likely.
        expect(evenOdds(thresholdLadder(event('X in Q3', 'Financials', [quote(1, .4), quote(2, .6)]))!)).toBeNull();
        // A single market or a range ladder is not a ladder of thresholds.
        expect(thresholdLadder(event('X in Q3', 'Financials', [quote(1, .4)]))).toBeNull();
        const ranges = event('X in Q3', 'Financials', [market('A', '1 to 2', .4, 1, 50, 'bracket'), market('B', '2 to 3', .6, 2, 50, 'bracket')]);
        expect(thresholdLadder(ranges)).toBeNull();
        expect(metricFor(ranges)).toMatchObject({ thresholds: [], evenOdds: null });
    });
    it('leads with a metric that pins even odds between two levels, the best supported first', () => {
        const clear = metricFor(headcount);
        const stronger = metricFor(event('Apple stores in fiscal 2026', 'Financials', [quote(530, .8, .1, 70), quote(540, .3, .1, 70)]));
        const oneSided = metricFor(event('Apple fare in fiscal 2026', 'Financials', [quote(205, .98, .01, 95), quote(210, .9, .1, 95)]));
        const unreadable = metricFor(event('Apple margin in Q4', 'Financials', [quote(46, .4, .1, 99), quote(47, .6, .1, 99)]));
        expect(featuredMetric([clear, oneSided, unreadable, stronger])?.title).toBe('Apple stores in fiscal 2026');
        expect(featuredMetric([oneSided, unreadable])?.title).toBe('Apple fare in fiscal 2026');
        expect(featuredMetric([unreadable])).toBeNull();
    });
    it('summarises a group of markets by its median trust score and ignores unscored ones', () => {
        expect(medianTrust([market('A', 'a', .5, null, 90), market('B', 'b', .5, null, 30), market('C', 'c', .5, null, 62), market('D', 'd', .5, null, null)])).toEqual({ total: 62, band: 'Medium', markets: 3 });
        expect(medianTrust([market('D', 'd', .5, null, null)])).toBeNull();
    });
});

describe('the date Kalshi states for an event', () => {
    const at = (iso: string) => new Date(iso);
    const now = Date.parse('2026-10-10T12:00:00Z');
    it('reads "On <date>" from the subtitle and nothing else', () => {
        expect(statedDate('On Oct 29, 2026')).toBe('2026-10-29');
        expect(statedDate('On Dec 31, 2026 at 4pm EST')).toBe('2026-12-31');
        expect(statedDate('On Jan 5, 2027')).toBe('2027-01-05');
        for (const other of ['in 2026', 'October 2026', 'iPhone 18', '', null, 'On Feb 31, 2027', 'On Foo 3, 2027'])
            expect(statedDate(other)).toBeNull();
        expect(newYorkNoon('2026-10-29').toISOString()).toBe('2026-10-29T16:00:00.000Z');   // daylight time
        expect(newYorkNoon('2026-12-10').toISOString()).toBe('2026-12-10T17:00:00.000Z');   // standard time
    });
    it('keeps a precise time only when it falls on the stated day', () => {
        const close = at('2027-03-31T14:00:00Z');
        // Apple: the occurrence time is on the stated day, so the call's own time is used.
        expect(eventTime(now, at('2026-11-12T15:00:00Z'), at('2026-10-29T21:00:00Z'), null, at('2026-11-12T15:00:00Z'), '2026-10-29')).toEqual({ time: at('2026-10-29T21:00:00Z'), source: 'occurrence' });
        // Netflix: stated Oct 20 but the occurrence time says Nov 4. United: it equals the market close.
        expect(eventTime(now, at('2027-02-01T15:00:00Z'), at('2026-11-04T15:00:00Z'), null, at('2026-11-03T15:00:00Z'), '2026-10-20')).toEqual({ time: at('2026-10-20T16:00:00Z'), source: 'stated' });
        expect(eventTime(now, close, close, null, close, '2026-10-14')).toEqual({ time: at('2026-10-14T16:00:00Z'), source: 'stated' });
        // An index event with a strike time on its stated day keeps that time.
        expect(eventTime(now, at('2026-12-31T21:00:00Z'), null, at('2026-12-31T21:00:00Z'), null, '2026-12-31')).toEqual({ time: at('2026-12-31T21:00:00Z'), source: 'strike' });
    });
    it('falls back to the market end once the stated day has passed, never to a mismatched occurrence time', () => {
        const later = Date.parse('2026-10-21T12:00:00Z');
        expect(eventTime(later, at('2027-02-01T15:00:00Z'), at('2026-11-04T15:00:00Z'), null, at('2026-11-03T15:00:00Z'), '2026-10-20')).toEqual({ time: at('2026-11-03T15:00:00Z'), source: 'expected' });
        expect(eventTime(later, at('2027-02-01T15:00:00Z'), at('2026-11-04T15:00:00Z'), null, null, '2026-10-20').source).toBe('close');
        // On the stated day itself the event still counts as ahead until the day ends in New York.
        expect(eventTime(Date.parse('2026-10-20T23:00:00Z'), at('2027-02-01T15:00:00Z'), null, null, null, '2026-10-20').source).toBe('stated');
        // Without a stated date nothing changes.
        expect(eventTime(now, at('2026-11-12T15:00:00Z'), at('2026-10-29T21:00:00Z'), null, null).source).toBe('occurrence');
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
    it('uses the soonest dated call and lists its topics from most to least likely', () => {
        const next = upcomingCall([call('2027-01-28T22:00:00Z'), call('2026-10-29T21:00:00Z')], now)!;
        expect(next).toMatchObject({ eventTicker: 'CALL-2026-10-29T21:00:00Z', time: '2026-10-29T21:00:00Z', session: 'after-close', trust: { total: 50, band: 'Low', markets: 2 } });
        expect(next.topics.map(t => t.word)).toEqual(['AI', 'Tariffs', 'Recession']);
    });
    it('says nothing about the time of day when Kalshi gives only the day or its default time', () => {
        expect(upcomingCall([call('2026-10-20T16:00:00Z', 'stated')], now)).toMatchObject({ time: '2026-10-20T16:00:00Z', session: null });
        // 10:00 am New York is the default Kalshi puts on half of these markets.
        expect(upcomingCall([call('2026-10-28T14:00:00Z')], now)?.session).toBeNull();
        expect(upcomingCall([call('2026-11-04T15:00:00Z')], now)?.session).toBeNull();
    });
    it('does not treat a past call or a market close as an upcoming call', () => {
        expect(upcomingCall([call('2026-10-01T21:00:00Z')], now)).toBeNull();
        expect(upcomingCall([call('2026-10-09T16:00:00Z', 'stated')], now)).toBeNull();
        // A call stated for today still counts.
        expect(upcomingCall([call('2026-10-10T16:00:00Z', 'stated')], Date.parse('2026-10-10T22:00:00Z'))).not.toBeNull();
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
