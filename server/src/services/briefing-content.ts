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
export function buildBriefing(portfolio: ExposureResponse, move: MovesResponse | null, now = new Date()): string {
    const upcoming = portfolio.events.filter(e => Date.parse(e.closeTime) > now.getTime());
    const week = upcoming.filter(e => Date.parse(e.closeTime) <= now.getTime() + 7 * 86400_000);
    const top = week.length ? week.sort((a, b) => b.share - a.share).slice(0, 1)
        : upcoming.sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime) || b.share - a.share).slice(0, 1);
    const fresh = (asOf: string | null) => asOf !== null && Date.parse(asOf) <= now.getTime() && now.getTime() - Date.parse(asOf) <= 15 * 60_000;
    const spokenDate = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: BRIEFING_TIMEZONE, month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
    const spokenQuoteTime = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: BRIEFING_TIMEZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(date));
    const direction = (value: string) => Number(value) < 0 ? 'down' : 'up';
    const amount = (value: number | null | undefined) => value == null ? null : Math.abs(value).toFixed(2);
    const facts = {
        asOf: portfolio.asOf,
        biggest: move?.oddsMoves[0] ? {title: move.oddsMoves[0].title, change: Math.abs(move.oddsMoves[0].changePoints).toFixed(1), direction: move.oddsMoves[0].changePoints < 0 ? 'down' : 'up'} : null,
        session: move?.date ? spokenDate(move.date) : null,
        total: move?.total == null ? null : move.total.toFixed(2),
        fromMarket: move?.fromMarket == null ? null : move.fromMarket.toFixed(2),
        beyondMarket: move?.beyondMarket == null ? null : move.beyondMarket.toFixed(2),
        totalMagnitude: amount(move?.total),
        marketMagnitude: amount(move?.fromMarket),
        remainderMagnitude: amount(move?.beyondMarket),
        events: top.map(e => ({ title: e.title, close: spokenDate(e.closeTime), holdings: e.links.map(l => l.symbol).join(', '), share: Math.round(e.share * 100),
            market: fresh(portfolio.asOf) && e.markets.length === 1 && fresh(e.markets[0].asOf) && e.markets[0].probability !== null
                ? { title: e.markets[0].title, probability: Math.round(e.markets[0].probability * 100), asOf: spokenQuoteTime(e.markets[0].asOf!) } : null }))
    };
    // The daily move covers listed securities; cash, bonds held directly and property have no daily price.
    const subject = move?.unpricedValue ? 'Your listed holdings' : 'Your portfolio';
    const parts = ['Good morning.'];
    if (facts.total !== null) {
        parts.push(Number(facts.total) === 0
            ? `${subject} ended the ${facts.session} session unchanged.`
            : `${subject} ended the ${facts.session} session ${direction(facts.total)} ${facts.totalMagnitude} dollars.`);
        if (facts.fromMarket !== null && facts.beyondMarket !== null)
            parts.push(`Our historical model puts the broad market contribution at ${direction(facts.fromMarket)} ${facts.marketMagnitude} dollars, leaving ${direction(facts.beyondMarket)} ${facts.remainderMagnitude} dollars beyond that estimate.`);
    } else parts.push("We're still waiting for a complete view of the last trading session. In the meantime, let's look ahead.");
    const main = facts.events[0];
    if (main) {
        parts.push(week.length ? "For the week ahead, here's the main event on your watchlist." : "The nearest event on your watchlist is further out, so this is something to keep in view rather than a deadline for today.");
        parts.push(`${main.title.replace(/[.!?]+$/, '')}. The market closes on ${main.close}.`);
        parts.push(`${main.holdings ? `Your ${main.holdings} holdings connect this event to` : 'This event is linked to'} ${main.share} percent of your portfolio.`);
        if (main.market) parts.push(`Kalshi currently puts yes at ${main.market.probability} percent, using the bid ask midpoint.`);
        else if (main.market === null) parts.push("You can find the available outcomes and their quote times on the event page.");
        parts.push("That connection tells you where to pay attention, not how much your stocks might move.");
    } else parts.push("We haven't reviewed any upcoming event links for your holdings yet, so the watchlist is still incomplete.");
    if (facts.biggest) parts.push(`One other development from the ${facts.session} session: ${facts.biggest.title.replace(/[.!?]+$/, '')}. The midpoint moved ${facts.biggest.direction} ${facts.biggest.change} percentage points. That doesn't establish a cause for your portfolio's move.`);
    if (!fresh(portfolio.asOf)) parts.push("The market feed needs an update, so current odds are unavailable.");
    parts.push("That's your morning check-in. Odds from Kalshi. Not financial advice.");
    const text = parts.join(' ');
    if (!numbersSupported(text, facts)) throw new Error('Briefing number check failed');
    return text;
}
