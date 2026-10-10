import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DriverChange, HoldingMove, MoveLink, MovedEvent, MovesResponse, SettledEvent } from '../../shared/types';
import { money } from './common';
import { MoveView } from './screens/moves';
import { RANGES, describeChange, driverEvents, eventLines, scopeDrivers, scopeEvents, scopeRows } from './screens/move-scope';

const moved = (symbol: string, startValue: number, endValue: number, fromMarket: number, drivers: [string, number][], extra: Partial<HoldingMove> = {}): HoldingMove => {
    const actual = Math.round((endValue - startValue) * 100) / 100;
    return { symbol, valueUsd: endValue, startValue, endValue, actual, beta: 1, fromMarket, beyondMarket: Math.round((actual - fromMarket) * 100) / 100, sourceDate: '2026-10-09', previousDate: '2026-10-02',
        unavailableReasons: [], drivers: drivers.map(([driver, contribution]) => ({ driver, contribution })), ...extra };
};
const holdings: HoldingMove[] = [
    moved('XOM', 9708.18, 10000, 43.74, [['SPY', 43.74], ['CL=F', 20.97]]),
    moved('USO', 4972, 5000, 8.17, [['CL=F', 28.51], ['SPY', 8.17]]),
    moved('TLT', 9935.88, 10000, 9.8, [['SPY', 9.8]]),
    { symbol: 'SAVINGS', valueUsd: 50000, assetType: 'cash', startValue: null, endValue: null, actual: null, beta: null, fromMarket: null, beyondMarket: null, sourceDate: null, previousDate: null, unavailableReasons: ['This holding has no daily price; listed-security move totals leave it out.'], drivers: [] },
];
const changes: DriverChange[] = [{ driver: 'SPY', kind: 'return', change: .0116 }, { driver: 'CL=F', kind: 'return', change: .0081 }];
const link = (symbol: string, type: MoveLink['type'], driver: string | null = null, themes: string[] = []): MoveLink => ({ symbol, type, driver, themes });
const oilLinks = [link('XOM', 'Measured', 'CL=F', ['oil']), link('USO', 'Measured', 'CL=F', ['oil'])];
const times = { fromTime: '2026-10-02T20:00:00.000Z', toTime: '2026-10-09T20:00:00.000Z' };
const movedEvents: MovedEvent[] = [
    { ticker: 'FED', title: 'Fed funds rate after Dec 2026 meeting?', moved: 1, links: [link('SAVINGS', 'Calculated', null, ['fed-rates']), link('TLT', 'Measured', 'DGS10', ['fed-rates'])],
        markets: [{ ticker: 'FED-450', title: 'Will the upper bound be above 4.50%?', from: .365, to: .845, changePoints: 48, ...times }] },
    { ticker: 'WTI', title: 'WTI price at year end?', moved: 4, links: [...oilLinks, link('TLT', 'Related')],
        markets: [{ ticker: 'WTI-100', title: 'Will WTI be above 100 on December 31?', from: .42, to: .235, changePoints: -18.5, ...times }] },
];
const settledMarket = (ticker: string, title: string, outcome: 0 | 1, probabilityBefore: number) => ({ ticker, title, outcome, probabilityBefore, closeTime: '2026-10-05T16:19:00.000Z' });
const settledEvents: SettledEvent[] = [
    { ticker: 'XOM-CC', title: null, closeTime: '2026-10-05T16:19:00.000Z', links: [link('XOM', 'Direct', null, ['direct'])], settled: 9, yes: 8,
        markets: [settledMarket('XOM-CC-104', 'Will ExxonMobil card spend be above 104?', 1, .02), settledMarket('XOM-CC-106', 'Will ExxonMobil card spend be above 106?', 0, .01)] },
    { ticker: 'BRENT', title: 'Brent close on Oct 9', closeTime: '2026-10-09T19:00:00.000Z', links: oilLinks, settled: 1, yes: 1, markets: [settledMarket('BRENT-102', 'Will Brent close above 101.99?', 1, .5)] },
];
const data: MovesResponse = { date: '2026-10-09', requestedDate: null, range: 'week', startDate: '2026-10-02', notes: [], asOf: '2026-10-09T21:30:00.000Z', spyReturn: .0116, holdings,
    startValue: 24616.06, endValue: 25000, total: 383.94, fromMarket: 61.71, beyondMarket: 322.23, oddsWindow: { from: '2026-10-02T20:00:00.000Z', to: '2026-10-09T20:00:00.000Z' }, movedEvents, settledEvents,
    drivers: [{ driver: 'SPY', contribution: 61.71 }, { driver: 'CL=F', contribution: 49.48 }], driverChanges: changes, missingDrivers: ['DGS2', 'DGS10'], unpricedValue: 50000 };
const view = (focus = '', chosen: Set<string> | null = null, theme = '') => renderToStaticMarkup(<MoveView data={data} exposure={null} chosen={chosen} theme={theme} focus={focus} setFocus={() => {}}/>);

describe('what a Moves view covers', () => {
    it('offers a day, a week, a month and three months', () => {
        expect(RANGES.map(range => `${range.key}:${range.label}`)).toEqual(['day:1 day', 'week:1 week', 'month:1 month', 'quarter:3 months']);
    });
    it('looks at one holding when one is picked, otherwise the chosen category, otherwise everything', () => {
        const symbols = (chosen: Set<string> | null, focus: string) => scopeRows(holdings, chosen, focus).map(row => row.symbol);
        expect(symbols(null, '')).toEqual(['XOM', 'USO', 'TLT', 'SAVINGS']);
        expect(symbols(new Set(['USO', 'TLT']), '')).toEqual(['USO', 'TLT']);
        // A picked holding is shown even when the chosen category leaves it out.
        expect(symbols(new Set(['USO', 'TLT']), 'XOM')).toEqual(['XOM']);
        expect(symbols(null, 'GONE')).toEqual([]);
    });
    it('adds up each driver’s estimates over the rows in view, in whole cents, largest first', () => {
        expect(scopeDrivers(holdings)).toEqual(data.drivers);
        expect(scopeDrivers(scopeRows(holdings, null, 'USO'))).toEqual([{ driver: 'CL=F', contribution: 28.51 }, { driver: 'SPY', contribution: 8.17 }]);
        expect(scopeDrivers([moved('A', 100, 90, -.1, [['SPY', -.1], ['CL=F', .1]]), moved('B', 100, 90, -.2, [['SPY', -.2], ['CL=F', .2]])])).toEqual([{ driver: 'CL=F', contribution: .3 }, { driver: 'SPY', contribution: -.3 }]);
        expect(scopeDrivers([holdings[3]])).toEqual([]);
    });
    it('keeps the events linked to what is in view, through the chosen theme, and topic links only when asked', () => {
        const tickers = (symbols: Set<string> | null, theme: string, topics: boolean) => scopeEvents(movedEvents, symbols, theme, topics).map(event => `${event.ticker}:${event.shown.map(shown => shown.symbol).join('+')}`);
        expect(tickers(null, '', false)).toEqual(['FED:SAVINGS+TLT', 'WTI:XOM+USO']);
        expect(tickers(null, '', true)).toEqual(['FED:SAVINGS+TLT', 'WTI:XOM+USO+TLT']);
        expect(tickers(new Set(['TLT']), '', false)).toEqual(['FED:TLT']);
        expect(tickers(new Set(['TLT']), '', true)).toEqual(['FED:TLT', 'WTI:TLT']);
        expect(tickers(null, 'oil', true)).toEqual(['WTI:XOM+USO']);
        // USO is in view and the event is about rates, but USO is not linked to it.
        expect(tickers(new Set(['USO']), 'fed-rates', true)).toEqual([]);
        expect(scopeEvents(settledEvents, new Set(['USO']), '', false).map(event => event.ticker)).toEqual(['BRENT']);
    });
    it('narrows to the events linked through one driver, by a measured link only', () => {
        const tickers = (driver: string, topics = false) => scopeEvents(movedEvents, null, '', topics, driver).map(event => `${event.ticker}:${event.shown.map(shown => shown.symbol).join('+')}`);
        expect(tickers('CL=F')).toEqual(['WTI:XOM+USO']);
        // A topic link names no driver, so asking for topic links adds nothing here.
        expect(tickers('CL=F', true)).toEqual(['WTI:XOM+USO']);
        // The calculated link to SAVINGS does not run through a yield.
        expect(tickers('DGS10')).toEqual(['FED:TLT']);
        expect(tickers('SPY')).toEqual([]);
    });
    it('finds the events behind a holding’s driver, the biggest odds move first', () => {
        const found = (symbol: string, driver: string) => { const events = driverEvents(data, symbol, driver); return [events.moved.map(event => event.ticker), events.settled.map(event => event.ticker)]; };
        expect(found('USO', 'CL=F')).toEqual([['WTI'], ['BRENT']]);
        expect(found('TLT', 'DGS10')).toEqual([['FED'], []]);
        // XOM's biggest driver is the stock market, and no event here is linked to it through that.
        expect(found('XOM', 'SPY')).toEqual([[], []]);
        // TLT shares only a topic with the oil event.
        expect(found('TLT', 'CL=F')).toEqual([[], []]);
        expect(driverEvents({ movedEvents: [...movedEvents].reverse(), settledEvents: [] }, 'XOM', 'CL=F').moved[0].ticker).toBe('WTI');
    });
});

describe('a driver’s own change in words', () => {
    it('gives a price as a percentage and a yield in percentage points', () => {
        const change = (kind: DriverChange['kind'], value: number) => describeChange({ driver: 'X', kind, change: value });
        expect(change('return', .0116)).toBe('rose 1.2%');
        expect(change('return', .0039)).toBe('rose 0.39%');
        expect(change('return', -.0437)).toBe('fell 4.4%');
        expect(change('return', .2743)).toBe('rose 27.4%');
        expect(change('difference', .12)).toBe('rose 0.12 percentage points');
        expect(change('difference', -.05)).toBe('fell 0.05 percentage points');
        expect(change('difference', -.004)).toBe('was unchanged');
        expect(change('return', .00001)).toBe('was unchanged');
    });
});

describe('what an event has to do with the moves in view', () => {
    const lines = (links: MoveLink[], rows = holdings, driverChanges = changes) => eventLines(links, rows, driverChanges, money).map(line => line.text);
    it('sets a measured link beside the holding’s move through its driver', () => {
        expect(lines([oilLinks[0]])).toEqual(['Related through crude oil futures, which rose 0.81% over this window. XOM’s measured link to it puts about +$20.97 of its +$291.82 move there.']);
    });
    it('adds the estimates up when several holdings share the driver', () => {
        expect(eventLines(oilLinks, holdings, changes, money)).toEqual([{ type: 'Measured', symbols: ['XOM', 'USO'],
            text: 'Related through crude oil futures, which rose 0.81% over this window. Their measured links to it put about +$49.48 of the moves in XOM and USO there.' }]);
    });
    it('gives no estimate without the driver’s change or the holding’s own figure, and says which', () => {
        expect(lines([link('TLT', 'Measured', 'DGS10')])).toEqual(['Related through the 10-year Treasury yield: TLT. Its change over this window is not available, so there is no estimate to set beside this event.']);
        // Oil's change is known, but TLT has no oil estimate for this window.
        expect(lines([link('TLT', 'Measured', 'CL=F')])).toEqual(['Related through crude oil futures: TLT. It rose 0.81% over this window, but there is no estimate to set beside this event.']);
        expect(lines([...oilLinks, link('TLT', 'Measured', 'CL=F')])[0]).toBe('Related through crude oil futures, which rose 0.81% over this window. Their measured links to it put about +$49.48 of the moves in XOM and USO there. No estimate for TLT.');
    });
    it('says a market about the holding itself is not tied to its move by any measurement', () => {
        expect(lines([link('XOM', 'Direct')])).toEqual(['About XOM itself, which went from $9,708.18 to $10,000.00 over this window (+$291.82). Nothing measured ties this event to that move.']);
        expect(lines([link('XOM', 'Direct')], [{ ...holdings[0], startValue: null, endValue: null, actual: null }])).toEqual(['About XOM itself. Its move over this window is unavailable.']);
    });
    it('keeps calculated and topic links apart from any move', () => {
        expect(eventLines([link('TLT', 'Related'), link('SAVINGS', 'Calculated'), link('XOM', 'Direct'), ...oilLinks, link('TNOTE', 'Calculated')], holdings, changes, money).map(line => [line.type, line.symbols.join('+')])).toEqual([['Direct', 'XOM'], ['Measured', 'XOM+USO'], ['Calculated', 'SAVINGS+TNOTE'], ['Related', 'TLT']]);
        expect(lines([link('SAVINGS', 'Calculated')])).toEqual(['Calculated link to SAVINGS, which has no daily price and so no move to set beside this event.']);
        expect(lines([link('SAVINGS', 'Calculated'), link('TNOTE', 'Calculated'), link('HOME', 'Calculated')])).toEqual(['Calculated link to SAVINGS, TNOTE and HOME, which have no daily price and so no move to set beside this event.']);
        expect(lines([link('TLT', 'Related')])).toEqual(['Shares a topic with TLT. No measured connection.']);
    });
    it('shows a fall with its sign', () => {
        const fell = [moved('XOM', 10000, 9500, -100, [['SPY', -100], ['CL=F', -310.5]])];
        expect(lines([oilLinks[0]], fell, [{ driver: 'CL=F', kind: 'return', change: -.0437 }])).toEqual(['Related through crude oil futures, which fell 4.4% over this window. XOM’s measured link to it puts about -$310.50 of its -$500.00 move there.']);
    });
});

describe('the Moves screen', () => {
    it('compares the whole portfolio at the two closes and says how the comparison is made', () => {
        const html = view();
        expect(html).toContain('From the close on <time dateTime="2026-10-02">Fri, Oct 2</time> to the close on <time dateTime="2026-10-09">Fri, Oct 9</time>.');
        expect(html).toContain('as if you had held the same amount throughout');
        expect(html).toContain('<span class="muted">Your listed securities: worth at the two closes</span><p class="closes"><span class="note">Fri, Oct 2</span><strong class="mono">$24,616.06</strong></p><p class="closes"><span class="note">Fri, Oct 9</span><strong class="mono">$25,000.00</strong></p>');
        expect(html).toContain('<strong class="number blue">+$383.94</strong><span class="note mono">+1.56%</span>');
        expect(html).toContain('<strong class="number">+$61.71</strong><span class="note">S&amp;P 500 (SPY) rose 1.2%</span>');
        expect(html).toContain('<strong class="number">+$322.23</strong>');
        expect(html).toContain('<option value="" selected="">Whole portfolio</option><option value="XOM">XOM</option>');
        expect(html).toContain('<h2>What mattered most</h2>');
        expect(html).toContain('<h2 class="events-head">Kalshi events over this window</h2>');
        expect(html).toContain('Settled in this window <span class="note">· 2 events</span>');
        expect(html).toContain('Odds that moved <span class="note">· 2 events</span>');
        // The only topic link belongs to an event that is listed anyway.
        expect(html).not.toContain('linked only by a shared topic');
    });
    it('lists every holding with its value at each close and lets one be picked', () => {
        const html = view();
        expect(html).toContain('<tr class=""><td><button class="holding-pick" aria-pressed="false">XOM</button></td><td class="amount">1.000</td><td class="amount">$9,708.18</td><td class="amount">$10,000.00</td><td class="amount blue">+$291.82<span class="note"> +3.01%</span></td><td class="amount">$43.74</td><td class="amount">$248.08</td>');
        // The biggest driver comes with the Kalshi events behind it: the one whose odds moved most, and a way to list them all.
        expect(html).toContain('<td class="driver-cell lead">Crude oil <span class="mono">$28.51</span><span class="driver-event">Biggest odds move among its Kalshi events: <a href="#event/WTI-100">WTI price at year end?</a> <span class="mono">-18.5 pts</span></span><button class="reset-filters">See all 2 events</button></td>');
        expect(html).toContain('<td class="driver-cell">Stock market (S&amp;P 500) <span class="mono">$43.74</span><span class="driver-event">No Kalshi event linked through it moved or settled in this window.</span></td>');
        expect(html).toContain('<button class="holding-pick" aria-pressed="false">SAVINGS</button><span class="note"> · Cash or savings</span></td><td colSpan="8" class="note">No daily price, so no move over a window. Worth $50,000.00 as entered.</td>');
        expect(view('XOM')).toContain('<tr class="picked"><td><button class="holding-pick" aria-pressed="true">XOM</button>');
    });
    it('explains every column from an “i” beside its name', () => {
        const html = view();
        expect(html.match(/<th scope="col">/g)).toHaveLength(9);
        expect(html.match(/<button type="button" class="info"/g)).toHaveLength(9);
        // The "i" stays with the last word of the name, and its explanation is tied to it.
        const [, described] = /<th scope="col">Measured <span class="th-end">beta<span class="explained" aria-describedby="[^"]+"><button type="button" class="info" aria-label="What “Measured beta” means" aria-describedby="([^"]+)"><span aria-hidden="true">i<\/span><\/button>/.exec(html)!;
        expect(html).toContain(`<span role="tooltip" id="${described}" class="explain-pop" hidden=""><strong>Measured beta</strong><span>How far this holding has moved with the stock market`);
        expect(html).toContain('<th scope="col"><span class="th-end">Holding<span class="explained"');
        for (const [name, text] of [['At the first close', 'as if you had held the same amount throughout'], ['At the last close', 'this is the value you entered'], ['Change', 'as a percentage of the value at the first close'],
            ['From market', 'measured beta × the S&amp;P 500’s return over the window × the value at the first close'], ['Beyond market', 'The two always add up to the change.'],
            ['Biggest measured driver', 'A driver is a price or a yield, not an event'], ['Data availability', 'what is missing when a figure is unavailable']])
            expect(html, name).toMatch(new RegExp(`<strong>${name}</strong><span>[^<]*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    });
    it('counts the Kalshi events behind each driver that mattered', () => {
        const html = view();
        expect(html).toContain('<strong class="mono blue">$49.48</strong><button class="reset-filters">2 Kalshi events</button>');
        // Nothing here is linked through the stock market, so that bar offers no events.
        expect(html).toContain('<strong class="mono blue">$61.71</strong></div>');
        // For one holding, the count is its own.
        expect(view('TLT')).not.toContain('Kalshi events</button>');
        expect(view('USO')).toContain('<strong class="mono blue">$28.51</strong><button class="reset-filters">2 Kalshi events</button>');
    });
    it('looks at one holding alone: its values, its drivers and the events linked to it', () => {
        const html = view('XOM');
        expect(html).toContain('<option value="XOM" selected="">XOM</option>');
        expect(html).toContain('Back to the whole portfolio');
        expect(html).toContain('<span class="muted">XOM: worth at the two closes</span>');
        expect(html).toContain('<strong class="mono">$9,708.18</strong>');
        expect(html).toContain('<strong class="number blue">+$291.82</strong><span class="note mono">+3.01%</span>');
        expect(html).toContain('<h2>What mattered most for XOM</h2>');
        expect(html).toContain('Stock market (S&amp;P 500) mattered most: about $43.74 of XOM’s move');
        expect(html).toContain('<h2 class="events-head">Kalshi events over this window, linked to XOM</h2>');
        expect(html).toContain('Settled in this window <span class="note">· 2 events</span>');
        expect(html).toContain('Odds that moved <span class="note">· 1 event</span>');
        expect(html).not.toContain('Fed funds rate after Dec 2026 meeting?');
        // Only XOM's part of the oil link is set beside the event.
        expect(html).toContain('XOM’s measured link to it puts about +$20.97 of its +$291.82 move there.');
        expect(html).not.toContain('USO there');
    });
    it('shows the events linked to a holding with no daily price, and says it has no move', () => {
        const html = view('SAVINGS');
        expect(html).toContain('SAVINGS has no daily price, so it has no move over a window. It is worth $50,000.00 as entered. Events linked to it are still listed below.');
        expect(html).not.toContain('worth at the two closes');
        expect(html).toContain('Fed funds rate after Dec 2026 meeting?');
        expect(html).toContain('Calculated link to SAVINGS, which has no daily price and so no move to set beside this event.');
        expect(html).toContain('No linked event settled in this window for what is in view.');
    });
    it('sums the chosen category and narrows events to the chosen theme', () => {
        const html = view('', new Set(['USO', 'TLT']));
        expect(html).toContain('<span class="muted">The chosen holdings: worth at the two closes</span>');
        expect(html).toContain('<strong class="mono">$14,907.88</strong>');
        expect(html).toContain('<strong class="number blue">+$92.12</strong>');
        expect(html).toContain('<option value="" selected="">All chosen holdings</option>');
        expect(html).not.toContain('aria-pressed="false">XOM</button>');
        const oil = view('', null, 'oil');
        expect(oil).toContain('Odds that moved <span class="note">· 1 event</span>');
        expect(oil).not.toContain('Fed funds rate after Dec 2026 meeting?');
    });
    it('offers topic-only events separately, since nothing measured ties them to a move', () => {
        const html = view('TLT');
        expect(html).toContain('Also show 1 linked only by a shared topic, with no measured connection');
        expect(html).toContain('Odds that moved <span class="note">· 1 event</span>');
        // The oil event is named in USO's row of the table, but is not among TLT's events.
        expect(html.slice(html.indexOf('class="events-head"'))).not.toContain('WTI price at year end?');
    });
    it('shows a moved market with both readings and how many more of its event moved', () => {
        const html = view();
        expect(html).toContain('<a class="event-title" href="#event/WTI-100">WTI price at year end?</a><strong class="mono orange">-18.5 pts</strong>');
        expect(html).toContain('<a href="#event/WTI-100">Will WTI be above 100 on December 31?</a><span class="outcome"><strong class="mono">42.0% → 23.5%</strong>');
        expect(html).toContain('and 3 more of this event’s markets moved 3 points or more.');
        expect(html).toContain('<strong class="mono blue">+48.0 pts</strong>');
        expect(html).toContain('Only quotes no wider than 10 cents at both ends are compared');
    });
    it('shows a settled event with its result, the odds a day before and how many markets it had', () => {
        const html = view();
        // No event title from Kalshi: the leading market's question names it.
        expect(html).toContain('8 of 9 markets resolved Yes</p><div class="row"><span class="event-title">Will ExxonMobil card spend be above 104?</span><span class="outcome"><strong>Resolved Yes</strong> <span class="note">Kalshi had <span class="mono">2.0%</span> a day before</span></span></div>');
        expect(html).toContain('<li><span>Will ExxonMobil card spend be above 106?</span><span class="outcome"><strong>Resolved No</strong>');
        expect(html).toContain('and 7 more in this event; shown are the 2 whose result was furthest from Kalshi’s odds.');
        expect(html).toContain('· one market</p><div class="row"><span class="event-title">Brent close on Oct 9</span></div><ul class="event-markets"><li><span>Will Brent close above 101.99?</span>');
        expect(html).toContain('About XOM itself, which went from $9,708.18 to $10,000.00 over this window (+$291.82).');
    });
    it('names drivers that could not be compared and states an unavailable total plainly', () => {
        expect(view()).toContain('not published yet: 2-year Treasury yield, 10-year Treasury yield.');
        const html = renderToStaticMarkup(<MoveView data={{ ...data, startValue: null, endValue: null, total: null, fromMarket: null, beyondMarket: null, startDate: null, oddsWindow: null, movedEvents: [], settledEvents: [], driverChanges: [] }} exposure={null} chosen={null} theme="" focus="" setFocus={() => {}}/>);
        expect(html).toContain('no earlier close is stored to open the window');
        expect(html).toContain('<strong class="number blue">Unavailable</strong>');
        expect(html).toContain('SPY’s change over this window is unavailable');
        expect(html).toContain('No window could be set, so no events are listed.');
    });
});
