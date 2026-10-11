import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BriefingPart, EventAnswerResponse, ExposureEvent, LinkType } from '../../shared/types';
import { Transcript } from './screens/overview';
import { AskEvent, EventAnswer } from './screens/event';
import { countedLinks, filterExposure, defaultExposureFilters } from './screens/exposure-table';
import { EventList } from './common';

const parts: BriefingPart[] = [
    { text: 'Good morning.', start: 0, end: 1.3 },
    { text: 'Your portfolio ended the October 9, 2026 session up 10.00 dollars.', start: 1.4, end: 8, source: { label: 'Moves', href: '#moves' } },
    { text: 'Fed decision. The market closes on October 14, 2026.', start: 8.1, end: 12, source: { label: 'Event page', href: '#event/KXFED-26DEC' } },
];

describe('the briefing transcript', () => {
    it('marks the sentence being spoken: the last one that has started', () => {
        const at = (time: number) => renderToStaticMarkup(<Transcript parts={parts} time={time} onPlay={() => {}}/>).split('<li').slice(1).map(item => item.includes('class="speaking"'));
        expect(at(-1)).toEqual([false, false, false]);
        expect(at(0)).toEqual([true, false, false]);
        // Between two sentences the one just spoken stays marked.
        expect(at(1.35)).toEqual([true, false, false]);
        expect(at(1.4)).toEqual([false, true, false]);
        expect(at(11.9)).toEqual([false, false, true]);
        expect(renderToStaticMarkup(<Transcript parts={parts} time={2} onPlay={() => {}}/>)).toContain('<li class="speaking" aria-current="true">');
    });
    it('links a sentence that states a figure to the screen that shows it', () => {
        const html = renderToStaticMarkup(<Transcript parts={parts} onPlay={() => {}}/>);
        expect(html).toContain('session up 10.00 dollars.</button><a href="#moves">Moves →</a></li>');
        expect(html).toContain('<a href="#event/KXFED-26DEC">Event page →</a>');
        // The greeting states no figure and has no link.
        expect(html).toContain('<li><button title="Play from this sentence">Good morning.</button></li>');
    });
    it('offers to play from a sentence only when there is audio with a time for it', () => {
        expect(renderToStaticMarkup(<Transcript parts={parts}/>)).not.toContain('<button');
        const untimed = parts.map(part => ({ ...part, start: null, end: null }));
        const html = renderToStaticMarkup(<Transcript parts={untimed} time={5} onPlay={() => {}}/>);
        expect(html).not.toContain('<button');
        expect(html).not.toContain('speaking');
        expect(html).toContain('<span>Good morning.</span>');
        expect(html).toContain('<a href="#moves">Moves →</a>');
    });
});

describe('a question about an event', () => {
    const answer: EventAnswerResponse = { status: 'answered', question: 'What has been reported?', text: 'Reporting says the Fed held rates. Kalshi puts a cut at 62 percent.',
        sources: [{ title: 'Fed holds rates', url: 'https://example.com/fed' }], checks: { sourcesRetrieved: 5, sourcesCited: 1, numbersChecked: 1 }, reason: null, generatedAt: '2026-10-10T12:00:05.000Z', asOf: null };
    it('offers a box, suggestions and what an answer is made from', () => {
        const html = renderToStaticMarkup(<AskEvent ticker="KXFED-26DEC"/>);
        expect(html).toContain('<h2>Ask about this event</h2><span class="chip plain">Snowflake Cortex</span>');
        expect(html).toContain('maxLength="200"');
        for (const text of ['What is this event about?', 'What has been reported about it recently?', 'What could change these odds?']) expect(html).toContain(`>${text}</button>`);
        // Nothing can be asked until something is typed.
        expect(html).toMatch(/<button class="primary" type="submit" disabled="" aria-busy="false">Ask<\/button>/);
        expect(html).toContain('written only from reporting retrieved for this question');
    });
    it('shows the answer with its sources and what was checked', () => {
        const html = renderToStaticMarkup(<EventAnswer answer={answer}/>);
        expect(html).toContain('<p class="ask-answer">Reporting says the Fed held rates. Kalshi puts a cut at 62 percent.</p>');
        expect(html).toContain('<span class="chip plain">1 of 5 retrieved sources cited</span><span class="chip plain">1 number matched to the market data</span>');
        expect(html).toContain('<a href="https://example.com/fed" target="_blank" rel="noreferrer">Fed holds rates</a>');
        expect(renderToStaticMarkup(<EventAnswer answer={{ ...answer, checks: { sourcesRetrieved: 5, sourcesCited: 2, numbersChecked: 0 } }}/>)).toContain('No figures stated');
    });
    it('shows no text when there is no sourced answer, and says why', () => {
        const none = renderToStaticMarkup(<EventAnswer answer={{ ...answer, status: 'no-answer', text: null, sources: [], reason: 'The retrieved reporting does not answer this question, so no answer is shown.' }}/>);
        expect(none).toContain('<strong>No sourced answer.</strong> The retrieved reporting does not answer this question, so no answer is shown.');
        expect(none).not.toContain('ask-answer');
        // A rejected answer never reaches the screen, even if it were sent.
        const rejected = renderToStaticMarkup(<EventAnswer answer={{ ...answer, status: 'unavailable', reason: 'An answer was written but did not pass the source and number checks, so it is not shown.' }}/>);
        expect(rejected).toContain('<strong>Answer unavailable.</strong>');
        expect(rejected).not.toContain('Fed held rates');
    });
});

describe('reach on the screens', () => {
    const link = (symbol: string, type: LinkType) => ({ symbol, valueUsd: 1000, type, sensitivity: null, evidence: 'Test evidence' });
    const event = (ticker: string, links: ReturnType<typeof link>[], linkedValue: number, share: number): ExposureEvent => ({ ticker, title: ticker, share, linkedValue, topicValue: links.filter(l => l.type === 'Related').length * 1000,
        closeTime: '2026-10-20T12:00:00Z', eventTime: '2026-10-20T12:00:00Z', eventTimeSource: 'close', category: 'Economics', mutuallyExclusive: false, links,
        markets: [{ ticker: `${ticker}-M`, title: ticker, subtitle: 'Yes', probability: .5, spread: .02, kind: 'kpi', asOf: null, trust: { total: 50, band: 'Low', spread: 20, activity: 10, depth: 7.5, trackRecord: null, categoryCount: 0, spreadCents: 2 } }] });
    const wide = event('WIDE', [link('A', 'Measured'), link('B', 'Direct'), link('C', 'Related'), link('D', 'Related'), link('E', 'Related')], 2000, .2);
    const narrow = event('NARROW', [link('A', 'Measured'), link('B', 'Measured'), link('C', 'Calculated')], 3000, .3);
    const topic = event('TOPIC', [link('HOME', 'Related')], 0, 0);
    it('counts the links that are more than a shared topic', () => {
        expect(countedLinks(wide).map(l => l.symbol)).toEqual(['A', 'B']);
        expect(countedLinks(topic)).toEqual([]);
    });
    it('orders "most linked holdings" by the holdings that count, not by topic links', () => {
        expect(filterExposure([wide, narrow, topic], { ...defaultExposureFilters, sort: 'holdings' }).map(e => e.ticker)).toEqual(['NARROW', 'WIDE']);
    });
    it('gives a topic-only event no value or share on the calendar', () => {
        const html = renderToStaticMarkup(<EventList events={[narrow, topic]}/>);
        expect(html).toContain('<strong class="mono">$3,000.00</strong><p class="note">30.0% of portfolio</p>');
        expect(html).toContain('<p class="note">Topic link only · no share counted</p>');
        expect(html).not.toContain('$0.00');
    });
});
