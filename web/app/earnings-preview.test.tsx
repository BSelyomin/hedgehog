import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EarningsCall, EarningsMetric, EarningsResponse, EarningsThreshold } from '../../shared/types';
import { countdown, describeCall, describeEvenOdds, describeTypicalMove, firmQuote, level, leadTickers, sessionText, summarizeEvenOdds } from './screens/earnings-text';
import { CallTopics, ExpectationCard, MetricsTable, MovesChart, UpcomingReports } from './screens/earnings-preview';
import { EarningsHistory, EarningsMarkets } from './screens/earnings';

const threshold = (label: string, strike: number, probability: number | null, spread = .1): EarningsThreshold =>
    ({ ticker: `T${strike}`, label, strike, probability, bid: probability === null ? null : Math.round((probability - spread / 2) * 1e4) / 1e4, ask: probability === null ? null : Math.round((probability + spread / 2) * 1e4) / 1e4 });
const ladder = [threshold('Above 164000', 164000, .92), threshold('Above 166000', 166000, .86), threshold('Above 168000', 168000, .67), threshold('Above 170000', 170000, .44)];
const metric = (evenOdds: EarningsMetric['evenOdds'], thresholds = ladder): EarningsMetric =>
    ({ eventTicker: 'KXAAPLA-28JANHEAD', title: 'Apple headcount in 2026', eventTime: '2028-01-01T15:00:00Z', eventTimeSource: 'occurrence', thresholds, evenOdds, trust: { total: 42.5, band: 'Low', markets: 4 } });
const headcount = metric({ above: ladder[2], below: ladder[3] });
const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe('earnings wording', () => {
    it('counts down in calendar days', () => {
        const now = new Date(2026, 9, 10, 9, 0).getTime();
        expect(countdown(new Date(2026, 9, 10, 17, 0).toISOString(), now)).toBe('today');
        expect(countdown(new Date(2026, 9, 11, 8, 30).toISOString(), now)).toBe('tomorrow');
        expect(countdown(new Date(2026, 9, 13, 8, 30).toISOString(), now)).toBe('in 3 days');
        expect(countdown(new Date(2026, 9, 29, 17, 0).toISOString(), now)).toBe('in 19 days');
        expect([sessionText('before-open'), sessionText('market-hours'), sessionText('after-close')]).toEqual(['before the market opens', 'during market hours', 'after the close']);
    });
    it('reads a level out of Kalshi’s label', () => {
        expect([level('Above 164000'), level('Above $205'), level('Above 81.5%'), level('Above 56 million'), level('At least 12'), level('6,300 or below')])
            .toEqual(['164,000', '$205', '81.5%', '56 million', '12', '6,300 or below']);
    });
    it('says where even odds fall using only the two neighbouring markets', () => {
        expect(describeEvenOdds(headcount)).toBe('Even odds fall between 168,000 and 170,000. Traders give a 67.0% chance of above 168,000 and a 44.0% chance of above 170,000.');
        expect(summarizeEvenOdds(headcount)).toBe('Even odds between 168,000 and 170,000');
        expect(describeEvenOdds(metric({ above: ladder[3], below: null }))).toBe('Traders give better than even odds of above 170,000, the highest level Kalshi lists (44.0%).');
        expect(summarizeEvenOdds(metric({ above: null, below: ladder[0] }))).toBe('Unlikely above 164,000 (92.0%)');
        expect([...leadTickers(headcount)]).toEqual(['T168000', 'T170000']);
    });
    it('gives no reading when the odds do not support one', () => {
        expect(describeEvenOdds(metric(null))).toBeNull();
        expect(summarizeEvenOdds(metric(null))).toBe('No level is clearly on either side of even odds');
        // A quote wider than 50 points straddles even odds; an absent one says nothing.
        expect([firmQuote(threshold('Above 1', 1, .515, .51)), firmQuote(threshold('Above 1', 1, .5, 1)), firmQuote(threshold('Above 1', 1, null)), firmQuote(threshold('Above 1', 1, .67))]).toEqual([false, false, false, true]);
        expect(summarizeEvenOdds(metric(null, []))).toBe('A range ladder; see its outcomes below');
    });
});

describe('earnings preview cards', () => {
    it('lists upcoming reports with a countdown and marks the selected one', () => {
        const now = new Date(2026, 9, 10, 9, 0).getTime();
        const companies = [{ symbol: 'JPM', name: 'JPMORGAN CHASE & CO', valueUsd: 10000, callTime: new Date(2026, 9, 13, 8, 30).toISOString(), session: 'before-open' as const, markets: 17 },
            { symbol: 'AAPL', name: 'Apple Inc.', valueUsd: 10000, callTime: new Date(2026, 9, 29, 17, 0).toISOString(), session: 'after-close' as const, markets: 1 }];
        const html = renderToStaticMarkup(<UpcomingReports companies={companies} selected="AAPL" onSelect={() => {}} now={now}/>);
        expect(html.indexOf('JPM')).toBeLessThan(html.indexOf('AAPL'));
        expect(html).toContain('in 3 days');
        expect(html).toContain('17 Kalshi markets');
        expect(html).toContain('1 Kalshi market<');
        expect(html).toContain('class="report-card active" aria-pressed="true"');
    });
    it('draws one bar per level and highlights the two either side of even odds', () => {
        const html = renderToStaticMarkup(<ExpectationCard metric={headcount}/>);
        expect(html).toContain('Apple headcount in 2026: what traders expect');
        expect(html).toContain('Even odds fall between 168,000 and 170,000.');
        expect(html.match(/class="threshold lead"/g)).toHaveLength(2);
        expect(html.match(/class="threshold"/g)).toHaveLength(2);
        expect(html).toContain('width:67%');
        expect(html).toContain('Trust 43 · Low');
        expect(html).toContain('not scaled to add up');
        expect(html).toContain('bid 62.0%, ask 72.0%');
    });
    it('shows no number for a level without a firm quote', () => {
        const wide = [threshold('Above 400,000', 400000, .775, .09), threshold('Above 425,000', 425000, .515, .51), threshold('Above 450,000', 450000, .35, .08)];
        const html = renderToStaticMarkup(<ExpectationCard metric={metric({ above: wide[0], below: wide[2] }, wide)}/>);
        expect(html).toContain('No firm quote');
        expect(html).not.toContain('51.5%');
        expect(html.match(/class="bar"/g)).toHaveLength(2);
        expect(html).toContain('Even odds fall between 400,000 and 450,000.');
    });
    it('gives each other metric one row with its reading and trust', () => {
        const html = renderToStaticMarkup(<MetricsTable metrics={[headcount, { ...metric(null), eventTicker: 'OTHER', title: 'Apple stores in fiscal 2026', trust: null }]}/>);
        expect(html).toContain('href="#event/KXAAPLA-28JANHEAD"');
        expect(html).toContain('Even odds between 168,000 and 170,000');
        expect(html).toContain('No level is clearly on either side of even odds');
        expect(html).toContain('Trust unavailable');
    });
    it('shows call topics with the chance each word is said', () => {
        const call: EarningsCall = { eventTicker: 'CALL', time: '2026-10-29T21:00:00Z', session: 'after-close', trust: { total: 52, band: 'Low', markets: 3 },
            topics: [{ ticker: 'W-AI', word: 'AI', probability: .96 }, { ticker: 'W-TAR', word: 'Tariffs', probability: .78 }, { ticker: 'W-REC', word: 'Recession', probability: null }] };
        const html = renderToStaticMarkup(<CallTopics call={call}/>);
        expect(html).toContain('href="#event/W-AI"');
        expect(html).toContain('96.0%');
        expect(html.indexOf('AI ')).toBeLessThan(html.indexOf('Tariffs'));
        expect(html).toContain('Unavailable');
        expect(html).toContain('Trust 52 · Low');
        expect(html).toContain('trade thinly');
        expect(html).toContain('Kalshi event time');
        // With only a day from Kalshi, no time of day is shown or implied.
        const dayOnly = { ...call, time: '2026-10-20T16:00:00Z', session: null };
        const undated = renderToStaticMarkup(<CallTopics call={dayOnly}/>);
        expect(undated).toContain('it gives no time');
        expect(undated).not.toMatch(/\d:\d\d [AP]M/);
        const now = new Date(2026, 9, 10, 9, 0).getTime();
        expect(describeCall({ ...call, time: new Date(2026, 9, 29, 17, 0).toISOString() }, now)).toBe('Earnings call in 19 days, after the close');
        expect(describeCall({ ...dayOnly, time: new Date(2026, 9, 20, 12, 0).toISOString() }, now)).toBe('Earnings call in 10 days');
    });
});

describe('past report moves', () => {
    const moves = [.021, -.048, .033, -.009, .062, -.026, .04, -.049];
    // Newest first, as the API returns them.
    const history = [...moves].reverse().map((move, index) => ({ filingDate: `2026-0${8 - index}-01`, sourceUrl: `https://www.sec.gov/report-${index}`, beforeDate: '2026-01-01', closeBefore: 200, afterDate: '2026-01-03', closeAfter: 200 * (1 + move), move }));
    const data = { symbol: 'AAPL', events: [], ladders: [], asOf: null, history, historyNote: 'Report dates are SEC filing dates.', name: 'Apple Inc.', position: { valueUsd: 6200, share: .25 }, call: null,
        featured: null, metrics: [], typicalMove: { percent: .036, usd: 223.2, reports: 8 } } as EarningsResponse;
    it('charts the moves oldest first, up and down from one baseline, with signed labels', () => {
        const html = renderToStaticMarkup(<MovesChart symbol="AAPL" history={history}/>);
        expect(html).toContain('oldest first: +2.1%, −4.8%, +3.3%, −0.9%, +6.2%, −2.6%, +4.0%, −4.9%');
        expect(html.match(/<path /g)).toHaveLength(8);
        expect(html.match(/fill="#7DB6FF"/g)).toHaveLength(4);
        expect(html.match(/fill="#FF9F45"/g)).toHaveLength(4);
        expect(html).toContain('>+6.2</text>');
        // The largest move reaches the full height above the baseline; a fall hangs below it.
        expect(html).toContain('V26 ');
        expect(html).toMatch(/M\d+,110 V1[1-9]\d/);
    });
    it('states the typical move in percent and in dollars on the position', () => {
        expect(describeTypicalMove(data, money)).toBe('±3.6% ≈ ±$223.20 on your $6,200.00');
        const html = renderToStaticMarkup(<EarningsHistory data={data}/>);
        expect(html).toContain('How AAPL moved after past reports');
        expect(html).toContain('±3.6% ≈ ±$223.20 on your $6,200.00');
        expect(html).toContain('average size of the last 8 moves');
        expect(html).toContain('<table');
        expect(renderToStaticMarkup(<EarningsHistory data={{ ...data, typicalMove: null }}/>)).toContain('Too few past reports to state a typical move.');
        expect(describeTypicalMove({ ...data, position: null }, money)).toBeNull();
    });
    it('opens the detail with the call timing, the position and the lead metric', () => {
        const html = renderToStaticMarkup(<EarningsMarkets data={{ ...data, featured: headcount, metrics: [headcount],
            call: { eventTicker: 'CALL', time: '2099-10-29T21:00:00Z', session: 'after-close', trust: null, topics: [{ ticker: 'W-AI', word: 'AI', probability: .96 }] } }}/>);
        expect(html).toContain('after the close');
        expect(html).toContain('$6,200.00');
        expect(html).toContain('25.0%');
        expect(html).toContain('Apple headcount in 2026: what traders expect');
        expect(html).toContain('Topics expected on the call');
        // The lead metric is not repeated in the table of other metrics.
        expect(html).not.toContain('class="card earnings-metrics"');
        expect(html).toContain('Every results market for AAPL');
    });
});
