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
    const facts = {
        asOf: portfolio.asOf,
        biggest: move?.oddsMoves[0] ? {title: move.oddsMoves[0].title, change: move.oddsMoves[0].changePoints.toFixed(1)} : null,
        session: move?.date ?? null,
        total: move?.total == null ? null : move.total.toFixed(2),
        fromMarket: move?.fromMarket == null ? null : move.fromMarket.toFixed(2),
        beyondMarket: move?.beyondMarket == null ? null : move.beyondMarket.toFixed(2),
        events: top.map(e => ({ title: e.title, close: e.closeTime.slice(0, 10), share: Math.round(e.share * 100),
            market: fresh(portfolio.asOf) && e.markets.length === 1 && fresh(e.markets[0].asOf) && e.markets[0].probability !== null
                ? { title: e.markets[0].title, probability: Math.round(e.markets[0].probability * 100), asOf: e.markets[0].asOf } : null }))
    };
    const parts = ['Your Hedgehog morning briefing.'];
    if (facts.total !== null) {
        parts.push(`For the trading session dated ${facts.session}, your portfolio dollar move was ${facts.total}.`);
        if (facts.fromMarket !== null && facts.beyondMarket !== null)
            parts.push(`The estimated broad market component was ${facts.fromMarket} dollars, with ${facts.beyondMarket} dollars remaining.`);
    } else parts.push('A complete portfolio move for the latest available completed trading session is not available yet.');
    if (facts.biggest) parts.push(`During the trading session dated ${facts.session}, ${facts.biggest.title} moved ${facts.biggest.change} percentage points. This does not establish what caused your stocks to move.`);
    parts.push(facts.events.length ? 'Next on your event calendar.' : 'No reviewed upcoming events are linked to your holdings yet.');
    for (const e of facts.events) {
        parts.push(`${e.title}. The market closes on ${e.close}. It reaches ${e.share} percent of your portfolio.`);
        if (e.market) parts.push(`The bid ask midpoint for ${e.market.title} is ${e.market.probability} percent yes, quoted at ${e.market.asOf}.`);
    }
    if (!fresh(portfolio.asOf)) parts.push('Market data is stale or unavailable; current odds are omitted.');
    parts.push('Reach measures linked holdings, not predicted losses. Not financial advice. Odds from Kalshi.');
    const text = parts.join(' ');
    if (!numbersSupported(text, facts)) throw new Error('Briefing number check failed');
    return text;
}
