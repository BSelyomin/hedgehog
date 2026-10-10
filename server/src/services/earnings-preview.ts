import type { EarningsCall, EarningsMetric, EarningsReportMove, EarningsThreshold, ExposureEvent, Market, TrustSummary } from '../../../shared/types.ts';
import { trustBand } from '../config/trust.ts';

// The Earnings screen shows only markets about a company's reported results: its earnings call,
// and numeric metrics for a reporting period ("headcount in 2026", "bookings in Q3"). Products,
// lawsuits, executives, prices and rankings stay on the other screens.
const PERIOD = /\bin (?:Q[1-4]|fiscal|FY ?\d{2,4}|20\d\d)\b/i;
export const isEarningsCall = (event: ExposureEvent) => event.category === 'Mentions' && /earnings call/i.test(event.title);
export const isReportedMetric = (event: ExposureEvent) => event.category !== 'Mentions' && PERIOD.test(event.title)
    && event.markets.length > 0 && event.markets.every(m => typeof m.floorStrike === 'number' || m.kind === 'bracket');
export const isResultsEvent = (event: ExposureEvent) => isEarningsCall(event) || isReportedMetric(event);

// One trust figure for a group of markets: the median of their scores, so one thin market
// neither sinks nor lifts the group.
export function medianTrust(markets: Market[]): TrustSummary | null {
    const totals = markets.flatMap(m => m.trust.total === null ? [] : [m.trust.total]).sort((a, b) => a - b);
    if (!totals.length)
        return null;
    const middle = Math.floor(totals.length / 2);
    const total = totals.length % 2 ? totals[middle] : (totals[middle - 1] + totals[middle]) / 2;
    return { total, band: trustBand(total), markets: totals.length };
}

const cents = (value: number) => Math.round(value * 10000) / 10000;
// The "above X" markets of an event in order of level, each with the bid and ask behind its
// midpoint. Null when the event is not such a ladder.
export function thresholdLadder(event: ExposureEvent): EarningsThreshold[] | null {
    if (event.markets.length < 2 || !event.markets.every(m => typeof m.floorStrike === 'number' && m.kind !== 'bracket'))
        return null;
    return event.markets.map(m => {
        const quoted = m.probability !== null && m.spread !== null;
        return { ticker: m.ticker, label: m.subtitle || m.title, strike: m.floorStrike!, probability: m.probability,
            bid: quoted ? cents(m.probability! - m.spread! / 2) : null, ask: quoted ? cents(m.probability! + m.spread! / 2) : null };
    }).sort((a, b) => a.strike - b.strike);
}

// Where the odds cross 50%. A level counts as more likely than not only when even its bid is at
// 50% or better, and as less likely only when even its ask is at 50% or below. A quote that
// straddles 50%, as every quote wider than 50 cents must, says neither and is passed over. The
// reading is the highest clearly likely level and the lowest clearly unlikely one: both are real
// quotes and nothing is interpolated. Null when no level is clearly on either side, or when a
// likely level sits above an unlikely one, because then the ladder holds no single expectation.
export function evenOdds(ladder: EarningsThreshold[]): EarningsMetric['evenOdds'] {
    const above = ladder.filter(t => t.bid !== null && t.bid >= 0.5).at(-1) ?? null;
    const below = ladder.find(t => t.ask !== null && t.ask <= 0.5 && t.bid! < 0.5) ?? null;
    if ((!above && !below) || (above && below && above.strike >= below.strike))
        return null;
    return { above, below };
}

export function metricFor(event: ExposureEvent): EarningsMetric {
    const thresholds = thresholdLadder(event) ?? [];
    return { eventTicker: event.ticker, title: event.title, eventTime: event.eventTime, eventTimeSource: event.eventTimeSource, thresholds,
        evenOdds: thresholds.length ? evenOdds(thresholds) : null, trust: medianTrust(event.markets) };
}

// The metric to lead with: one that pins even odds between two levels, the best supported first.
export function featuredMetric(metrics: EarningsMetric[]): EarningsMetric | null {
    const pinned = (m: EarningsMetric) => m.evenOdds?.above && m.evenOdds.below ? 1 : 0;
    return metrics.filter(m => m.evenOdds !== null)
        .sort((a, b) => pinned(b) - pinned(a) || (b.trust?.total ?? -1) - (a.trust?.total ?? -1) || b.thresholds.length - a.thresholds.length || a.eventTicker.localeCompare(b.eventTicker))[0] ?? null;
}

const newYorkMinutes = (time: string) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(time));
    return Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
};
// Whether a time falls before the New York stock market opens, during trading or after the close.
export function callSession(time: string): NonNullable<EarningsCall['session']> {
    const minutes = newYorkMinutes(time);
    return minutes < 9 * 60 + 30 ? 'before-open' : minutes >= 16 * 60 ? 'after-close' : 'market-hours';
}

const HALF_DAY = 12 * 3600000;
// The next earnings call Kalshi has dated for a company. The date comes from Kalshi's stated day
// or from an occurrence time on that day (see eventTime). The time of day is reported only when
// Kalshi gives the call's own: half of these markets carry exactly 10:00 am New York time, its
// default, which says nothing about when the call is.
export function upcomingCall(events: ExposureEvent[], now = Date.now()): EarningsCall | null {
    const dated = (e: ExposureEvent) => e.eventTimeSource === 'occurrence' ? Date.parse(e.eventTime) > now : e.eventTimeSource === 'stated' && Date.parse(e.eventTime) + HALF_DAY > now;
    const event = events.filter(e => isEarningsCall(e) && dated(e)).sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime))[0];
    if (!event)
        return null;
    const topics = event.markets.map(m => ({ ticker: m.ticker, word: m.subtitle || m.title, probability: m.probability }))
        .sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1) || a.word.localeCompare(b.word));
    const timed = event.eventTimeSource === 'occurrence' && newYorkMinutes(event.eventTime) !== 10 * 60;
    return { eventTicker: event.ticker, time: event.eventTime, session: timed ? callSession(event.eventTime) : null, topics, trust: medianTrust(event.markets) };
}

// How far the stock typically moved across past reports: the average size of the move, whichever
// direction, and the same in dollars on the holding. Fewer than four reports is too few to call typical.
export function typicalMove(history: EarningsReportMove[], valueUsd: number) {
    const moves = history.flatMap(report => report.move === null ? [] : [Math.abs(report.move)]);
    if (moves.length < 4)
        return null;
    const percent = moves.reduce((sum, move) => sum + move, 0) / moves.length;
    return { percent, usd: Math.round(percent * valueUsd * 100) / 100, reports: moves.length };
}
