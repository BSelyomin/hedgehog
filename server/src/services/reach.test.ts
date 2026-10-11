import { describe, expect, it } from 'vitest';
import { reach } from './matching.ts';
import { briefingSentences, buildBriefing, sentenceTimes } from './briefing-content.ts';
import type { ExposureEvent, ExposureResponse, MovesResponse } from '../../../shared/types.ts';

describe('how much of a portfolio an event reaches', () => {
    it('counts a holding linked by more than a shared topic, and never one linked by topic alone', () => {
        // The tour portfolio's shelter-inflation event: eight measured holdings and a house linked by topic.
        const links = [{ type: 'Measured' as const, valueUsd: 30000 }, { type: 'Measured' as const, valueUsd: 25000 }, { type: 'Related' as const, valueUsd: 300000 }, { type: 'Related' as const, valueUsd: 25000 }];
        expect(reach(links, 425000)).toEqual({ linkedValue: 55000, topicValue: 325000, share: 55000 / 425000 });
        expect(reach([{ type: 'Direct', valueUsd: 100 }, { type: 'Calculated', valueUsd: 200 }, { type: 'Measured', valueUsd: 300 }], 1000)).toEqual({ linkedValue: 600, topicValue: 0, share: .6 });
    });
    it('gives an event linked only by topic no reach at all', () => {
        expect(reach([{ type: 'Related', valueUsd: 300000 }], 425000)).toEqual({ linkedValue: 0, topicValue: 300000, share: 0 });
        expect(reach([], 425000)).toEqual({ linkedValue: 0, topicValue: 0, share: 0 });
        expect(reach([{ type: 'Direct', valueUsd: 100 }], 0).share).toBe(0);
    });
});

const now = new Date('2026-10-12T12:00:00Z'), soon = '2026-10-14T12:00:00Z';
const link = (symbol: string, type: 'Measured' | 'Related' | 'Direct') => ({ symbol, valueUsd: 1000, type, evidence: '', sensitivity: null });
const event = (ticker: string, share: number, links: ReturnType<typeof link>[]): ExposureEvent => ({ ticker, title: `${ticker} decision`, closeTime: soon, share, links, markets: [{ title: 'Yes', probability: .7, asOf: now.toISOString() }] } as unknown as ExposureEvent);
const portfolio = (events: ExposureEvent[]) => ({ events, asOf: now.toISOString() }) as ExposureResponse;
const move = { date: '2026-10-09', total: -12.5, fromMarket: -10, beyondMarket: -2.5, unpricedValue: 0, asOf: now.toISOString(),
    movedEvents: [{ ticker: 'OIL', title: 'Oil', links: [], moved: 1, markets: [{ ticker: 'OIL-90', title: 'Oil above 90?', from: .4, to: .52, fromTime: now.toISOString(), toTime: now.toISOString(), changePoints: 12 }] }] } as unknown as MovesResponse;

describe('the briefing sentence by sentence', () => {
    it('says the same text as the spoken briefing', () => {
        const data = portfolio([event('KXFED-26DEC', .4, [link('TLT', 'Measured')])]);
        const sentences = briefingSentences(data, move, now);
        expect(sentences.map(sentence => sentence.text).join(' ')).toBe(buildBriefing(data, move, now));
        expect(sentences[0]).toEqual({ text: 'Good morning.' });
    });
    it('links each sentence that states a figure to the screen that shows it', () => {
        const sentences = briefingSentences(portfolio([event('KXFED-26DEC', .4, [link('TLT', 'Measured')])]), move, now);
        const source = (text: string) => sentences.find(sentence => sentence.text.includes(text))?.source;
        expect(source('session down 12.50 dollars')).toEqual({ label: 'Moves', href: '#moves' });
        expect(source('broad market contribution')).toEqual({ label: 'Moves', href: '#moves' });
        expect(source('The market closes on')).toEqual({ label: 'Event page', href: '#event/KXFED-26DEC' });
        expect(source('40 percent of your portfolio')).toEqual({ label: 'Event page', href: '#event/KXFED-26DEC' });
        expect(source('Kalshi currently puts yes at 70 percent')).toEqual({ label: 'Event page', href: '#event/KXFED-26DEC' });
        // The odds move is another event's, and links to that market.
        expect(source('The midpoint moved up 12.0 percentage points')).toEqual({ label: 'Event page', href: '#event/OIL-90' });
        // Sentences that state no figure carry no link.
        expect(source('That connection tells you where to pay attention')).toBeUndefined();
        expect(sentences.at(-1)).toEqual({ text: "That's your morning check-in. Odds from Kalshi. Not financial advice." });
    });
    it('never makes an event linked only by topic the main event, and names only the holdings that count', () => {
        // The topic-only event comes first in the list, as a wide one would; it has no reach.
        const text = buildBriefing(portfolio([event('KXSHELTER', 0, [link('HOME', 'Related')]), event('KXFED-26DEC', .13, [link('TLT', 'Measured'), link('HOME', 'Related'), link('JPM', 'Direct')])]), move, now);
        expect(text).toContain('KXFED-26DEC decision. The market closes on');
        expect(text).toContain('Your TLT, JPM holdings connect this event to 13 percent of your portfolio.');
        expect(text).not.toContain('KXSHELTER');
        expect(text).not.toContain('HOME');
        // With nothing but topic links, there is no main event to name.
        expect(buildBriefing(portfolio([event('KXSHELTER', 0, [link('HOME', 'Related')])]), move, now)).toContain("We haven't reviewed any upcoming event links for your holdings yet");
    });
});

describe('when each sentence is spoken', () => {
    const timed = (text: string, characters = [...text]) => ({ characters, characterStartTimesSeconds: characters.map((_, i) => i), characterEndTimesSeconds: characters.map((_, i) => i + 1) });
    it('starts a sentence with its first character and ends it with its last', () => {
        const sentences = ['Good morning.', 'Up 10.00 dollars.', 'Bye.'];
        expect(sentenceTimes(sentences, timed(sentences.join(' ')))).toEqual([{ start: 0, end: 13 }, { start: 14, end: 31 }, { start: 32, end: 36 }]);
    });
    it('follows timings given in pieces longer than one character', () => {
        // The service may time a few characters together: "Good", " ", "morning.", " ", "Bye."
        const pieces = ['Good', ' ', 'morning.', ' ', 'Bye.'];
        expect(sentenceTimes(['Good morning.', 'Bye.'], timed('', pieces))).toEqual([{ start: 0, end: 3 }, { start: 4, end: 5 }]);
    });
    it('gives no times when the timings are missing or are not of the text that was sent', () => {
        const sentences = ['Good morning.', 'Bye.'];
        expect(sentenceTimes(sentences, undefined)).toBeNull();
        expect(sentenceTimes(sentences, null)).toBeNull();
        expect(sentenceTimes(sentences, {})).toBeNull();
        expect(sentenceTimes(sentences, timed('Good morning! Bye.'))).toBeNull();
        const short = timed(sentences.join(' ')); short.characterEndTimesSeconds.pop();
        expect(sentenceTimes(sentences, short)).toBeNull();
        const broken = timed(sentences.join(' ')); broken.characterStartTimesSeconds[0] = NaN;
        expect(sentenceTimes(sentences, broken)).toBeNull();
    });
});
