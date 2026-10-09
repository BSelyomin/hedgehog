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
    const top = week.length ? week.sort((a, b) => b.share - a.share).slice(0, 3)
        : upcoming.sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime) || b.share - a.share).slice(0, 3);
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
    const parts = ["Good morning. Let's take a look at your portfolio, then turn to what's coming up."];
    if (facts.total !== null) {
        parts.push(Number(facts.total) === 0
            ? `Your portfolio finished the ${facts.session} trading session unchanged in dollar terms.`
            : `Your portfolio finished the ${facts.session} trading session ${direction(facts.total)} ${facts.totalMagnitude} dollars.`);
        if (facts.fromMarket !== null && facts.beyondMarket !== null) {
            parts.push(`To put that move in context, our historical model estimates a broad market contribution of ${direction(facts.fromMarket)} ${facts.marketMagnitude} dollars. The remaining move was ${direction(facts.beyondMarket)} ${facts.remainderMagnitude} dollars. That split is an estimate, not an explanation of every stock's move.`);
        } else parts.push("We don't yet have enough aligned history to separate the broad market contribution from the rest of the move.");
    } else parts.push("The full portfolio move is not available yet, so we'll leave that figure out rather than give you an incomplete picture.");
    if (facts.biggest) parts.push(`There was also a shift in the prediction markets during the ${facts.session} session: ${facts.biggest.title.replace(/[.!?]+$/, '')}. Its midpoint moved ${facts.biggest.direction} ${facts.biggest.change} percentage points. That happened alongside the trading session; it doesn't tell us what caused your stocks to move.`);
    if (facts.events.length) parts.push(week.length
        ? "Now, looking ahead. Here are the events closing this week that touch the largest shares of your portfolio."
        : "None of your linked events close this week. Looking a little further ahead, here's what's next.");
    else parts.push("There are no reviewed upcoming events linked to your holdings yet. That means our event coverage is incomplete; it doesn't mean your portfolio has no event risk.");
    facts.events.forEach((e, index) => {
        const transition = index === 0 ? 'First on the watchlist' : index === 1 ? 'Also on the horizon' : 'And finally';
        parts.push(`${transition}: ${e.title.replace(/[.!?]+$/, '')}. The market closes on ${e.close}. ${e.holdings ? `Through your ${e.holdings} holdings, this` : 'This'} touches ${e.share} percent of your portfolio.`);
        if (e.market) parts.push(`For the question, ${e.market.title.replace(/[.!?]+$/, '')}, Kalshi's bid ask midpoint puts yes at ${e.market.probability} percent, as of ${e.market.asOf} New York time.`);
    });
    if (!fresh(portfolio.asOf)) parts.push("The market feed is stale or unavailable right now, so we're leaving current odds out of this briefing.");
    if (facts.events.length) parts.push("Those are the events on your watchlist. The shares describe which holdings are connected, not how much you might lose or a forecast of your stocks' next move.");
    parts.push('Thanks for listening. This is Hedgehog, with odds from Kalshi. Not financial advice.');
    const text = parts.join(' ');
    if (!numbersSupported(text, facts)) throw new Error('Briefing number check failed');
    return text;
}
