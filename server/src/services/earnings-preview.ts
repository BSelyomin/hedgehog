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

// The "above X" markets of an event in order of level. Null when the event is not such a ladder.
export function thresholdLadder(event: ExposureEvent): EarningsThreshold[] | null {
    if (event.markets.length < 2 || !event.markets.every(m => typeof m.floorStrike === 'number' && m.kind !== 'bracket'))
        return null;
    return event.markets.map(m => ({ ticker: m.ticker, label: m.subtitle || m.title, strike: m.floorStrike!, probability: m.probability }))
        .sort((a, b) => a.strike - b.strike);
}

// Where the odds cross 50%: the highest level traders think is more likely than not to be
// exceeded, and the next level up. Each side is a real midpoint; nothing is interpolated.
// Null when a quote is missing or the odds do not fall as the level rises, because then the
// ladder does not describe one consistent expectation.
export function evenOdds(ladder: EarningsThreshold[]): EarningsMetric['evenOdds'] {
    if (ladder.some(t => t.probability === null) || ladder.some((t, i) => i > 0 && t.probability! > ladder[i - 1].probability!))
        return null;
    const likely = ladder.filter(t => t.probability! >= 0.5);
    return { above: likely.at(-1) ?? null, below: ladder[likely.length] ?? null };
}

export function metricFor(event: ExposureEvent): EarningsMetric {
    const thresholds = thresholdLadder(event) ?? [];
    return { eventTicker: event.ticker, title: event.title, eventTime: event.eventTime, eventTimeSource: event.eventTimeSource, thresholds,
        evenOdds: thresholds.length ? evenOdds(thresholds) : null, trust: medianTrust(event.markets) };
}

// The metric to lead with: one whose ladder gives a clear reading, the best supported first.
export function featuredMetric(metrics: EarningsMetric[]): EarningsMetric | null {
    return metrics.filter(m => m.evenOdds !== null)
        .sort((a, b) => (b.trust?.total ?? -1) - (a.trust?.total ?? -1) || b.thresholds.length - a.thresholds.length || a.eventTicker.localeCompare(b.eventTicker))[0] ?? null;
}

// Whether a time falls before the New York stock market opens, during trading or after the close.
export function callSession(time: string): EarningsCall['session'] {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(time));
    const minutes = Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
    return minutes < 9 * 60 + 30 ? 'before-open' : minutes >= 16 * 60 ? 'after-close' : 'market-hours';
}

// The next earnings call Kalshi lists for a company: the call event whose date comes from
// Kalshi's occurrence time and is still ahead. A call that has happened no longer counts.
export function upcomingCall(events: ExposureEvent[], now = Date.now()): EarningsCall | null {
    const event = events.filter(e => isEarningsCall(e) && e.eventTimeSource === 'occurrence' && Date.parse(e.eventTime) > now)
        .sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime))[0];
    if (!event)
        return null;
    const topics = event.markets.map(m => ({ ticker: m.ticker, word: m.subtitle || m.title, probability: m.probability }))
        .sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1) || a.word.localeCompare(b.word));
    return { eventTicker: event.ticker, time: event.eventTime, session: callSession(event.eventTime), topics, trust: medianTrust(event.markets) };
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
