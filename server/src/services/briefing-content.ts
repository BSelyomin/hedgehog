import type { ExposureResponse, MovesResponse } from '../../../shared/types.ts';
import { numbersSupported } from './ai-guard.ts';

export const BRIEFING_TIMEZONE = 'America/New_York';
export function briefingDay(now = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: BRIEFING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function morningReady(now = new Date()): boolean {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: BRIEFING_TIMEZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
    return hour >= 8;
}
// One sentence of the briefing, with the screen that shows the figure it states.
export interface BriefingSentence { text: string; source?: { label: string; href: string } }
export function buildBriefing(portfolio: ExposureResponse, move: MovesResponse | null, now = new Date()): string {
    return briefingSentences(portfolio, move, now).map(sentence => sentence.text).join(' ');
}
export function briefingSentences(portfolio: ExposureResponse, move: MovesResponse | null, now = new Date()): BriefingSentence[] {
    // An event linked only by an unmeasured topic reaches no counted share, so it is never the main event.
    const upcoming = portfolio.events.filter(e => Date.parse(e.closeTime) > now.getTime() && e.share > 0);
    const week = upcoming.filter(e => Date.parse(e.closeTime) <= now.getTime() + 7 * 86400_000);
    const top = week.length ? week.sort((a, b) => b.share - a.share).slice(0, 1)
        : upcoming.sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime) || b.share - a.share).slice(0, 1);
    const fresh = (asOf: string | null) => asOf !== null && Date.parse(asOf) <= now.getTime() && now.getTime() - Date.parse(asOf) <= 15 * 60_000;
    const spokenDate = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: BRIEFING_TIMEZONE, month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
    const spokenQuoteTime = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: BRIEFING_TIMEZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(date));
    const direction = (value: string) => Number(value) < 0 ? 'down' : 'up';
    const amount = (value: number | null | undefined) => value == null ? null : Math.abs(value).toFixed(2);
    // Events come biggest mover first, and so do each event's markets.
    const biggest = move?.movedEvents[0]?.markets[0];
    const facts = {
        asOf: portfolio.asOf,
        biggest: biggest ? {title: biggest.title, change: Math.abs(biggest.changePoints).toFixed(1), direction: biggest.changePoints < 0 ? 'down' : 'up'} : null,
        session: move?.date ? spokenDate(move.date) : null,
        total: move?.total == null ? null : move.total.toFixed(2),
        fromMarket: move?.fromMarket == null ? null : move.fromMarket.toFixed(2),
        beyondMarket: move?.beyondMarket == null ? null : move.beyondMarket.toFixed(2),
        totalMagnitude: amount(move?.total),
        marketMagnitude: amount(move?.fromMarket),
        remainderMagnitude: amount(move?.beyondMarket),
        events: top.map(e => ({ title: e.title, close: spokenDate(e.closeTime), holdings: e.links.filter(l => l.type !== 'Related').map(l => l.symbol).join(', '), share: Math.round(e.share * 100),
            market: fresh(portfolio.asOf) && e.markets.length === 1 && fresh(e.markets[0].asOf) && e.markets[0].probability !== null
                ? { title: e.markets[0].title, probability: Math.round(e.markets[0].probability * 100), asOf: spokenQuoteTime(e.markets[0].asOf!) } : null }))
    };
    // The daily move covers listed securities; cash, bonds held directly and property have no daily price.
    const subject = move?.unpricedValue ? 'Your listed holdings' : 'Your portfolio';
    // Where a sentence's figure can be checked. Tickers stay out of `facts`, which the number check reads.
    const onMoves = { label: 'Moves', href: '#moves' };
    const page = (ticker: string | undefined) => ticker ? { label: 'Event page', href: `#event/${encodeURIComponent(ticker)}` } : undefined;
    const onEvent = page(top[0]?.ticker);
    const parts: BriefingSentence[] = [];
    const say = (text: string, source?: BriefingSentence['source']) => { parts.push(source ? { text, source } : { text }); };
    say('Good morning.');
    if (facts.total !== null) {
        say(Number(facts.total) === 0
            ? `${subject} ended the ${facts.session} session unchanged.`
            : `${subject} ended the ${facts.session} session ${direction(facts.total)} ${facts.totalMagnitude} dollars.`, onMoves);
        if (facts.fromMarket !== null && facts.beyondMarket !== null)
            say(`Our historical model puts the broad market contribution at ${direction(facts.fromMarket)} ${facts.marketMagnitude} dollars, leaving ${direction(facts.beyondMarket)} ${facts.remainderMagnitude} dollars beyond that estimate.`, onMoves);
    } else say("We're still waiting for a complete view of the last trading session. In the meantime, let's look ahead.");
    const main = facts.events[0];
    if (main) {
        say(week.length ? "For the week ahead, here's the main event on your watchlist." : "The nearest event on your watchlist is further out, so this is something to keep in view rather than a deadline for today.");
        say(`${main.title.replace(/[.!?]+$/, '')}. The market closes on ${main.close}.`, onEvent);
        say(`${main.holdings ? `Your ${main.holdings} holdings connect this event to` : 'This event is linked to'} ${main.share} percent of your portfolio.`, onEvent);
        if (main.market) say(`Kalshi currently puts yes at ${main.market.probability} percent, using the bid ask midpoint.`, onEvent);
        else if (main.market === null) say("You can find the available outcomes and their quote times on the event page.");
        say("That connection tells you where to pay attention, not how much your stocks might move.");
    } else say("We haven't reviewed any upcoming event links for your holdings yet, so the watchlist is still incomplete.");
    if (facts.biggest) say(`One other development from the ${facts.session} session: ${facts.biggest.title.replace(/[.!?]+$/, '')}. The midpoint moved ${facts.biggest.direction} ${facts.biggest.change} percentage points. That doesn't establish a cause for your portfolio's move.`, page(biggest?.ticker));
    if (!fresh(portfolio.asOf)) say("The market feed needs an update, so current odds are unavailable.");
    say("That's your morning check-in. Odds from Kalshi. Not financial advice.");
    if (!numbersSupported(parts.map(part => part.text).join(' '), facts)) throw new Error('Briefing number check failed');
    return parts;
}

// When each sentence is spoken. ElevenLabs times every character of the text it was given, so a
// sentence starts with its first character and ends with its last. Timings that do not match the
// text exactly give no times at all: the transcript is then shown without following the voice.
export function sentenceTimes(sentences: string[], alignment?: { characters?: string[]; characterStartTimesSeconds?: number[]; characterEndTimesSeconds?: number[] } | null): { start: number; end: number }[] | null {
    const characters = alignment?.characters, starts = alignment?.characterStartTimesSeconds, ends = alignment?.characterEndTimesSeconds;
    if (!characters || !starts || !ends || starts.length !== characters.length || ends.length !== characters.length || characters.join('') !== sentences.join(' '))
        return null;
    // The place in the text where each timed character begins; one may be more than one unit long.
    const offsets: number[] = [];
    let offset = 0;
    for (const character of characters) { offsets.push(offset); offset += character.length; }
    const times: { start: number; end: number }[] = [];
    let from = 0;
    for (const sentence of sentences) {
        const to = from + sentence.length, first = offsets.findIndex(at => at >= from);
        let last = -1;
        offsets.forEach((at, i) => { if (at < to) last = i; });
        const start = starts[first], end = ends[last];
        if (first < 0 || last < first || !Number.isFinite(start) || !Number.isFinite(end) || end < start)
            return null;
        times.push({ start, end });
        from = to + 1;
    }
    return times;
}
