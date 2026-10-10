import type { EarningsCall, EarningsMetric, EarningsResponse, EarningsThreshold } from '../../../shared/types';

const DAY = 86400000;
const startOfDay = (time: number) => { const day = new Date(time); day.setHours(0, 0, 0, 0); return day.getTime(); };

// "today", "tomorrow" or "in N days", counted in calendar days where the viewer is.
export function countdown(time: string, now = Date.now()): string {
    const days = Math.round((startOfDay(Date.parse(time)) - startOfDay(now)) / DAY);
    return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

export const sessionText = (session: EarningsCall['session']) =>
    session === 'before-open' ? 'before the market opens' : session === 'after-close' ? 'after the close' : 'during market hours';

const share = (value: number | null) => value === null ? 'unavailable' : `${(value * 100).toFixed(1)}%`;

// Kalshi labels a level "Above 164000". The bare level reads better in a sentence, with
// thousands separators when it is a plain whole number.
export function level(label: string): string {
    const rest = label.replace(/^(?:above|at least|more than|over)\s+/i, '');
    return /^\d{5,}$/.test(rest) ? Number(rest).toLocaleString('en-US') : rest;
}
const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
const outcome = (threshold: EarningsThreshold) => /^(?:above|at least|more than|over)\s/i.test(threshold.label) ? `${lower(threshold.label.split(/\s+/)[0])} ${level(threshold.label)}` : lower(threshold.label);

// Says where traders put even odds, using only the two markets either side of 50%.
export function describeEvenOdds(metric: EarningsMetric): string | null {
    const odds = metric.evenOdds;
    if (!odds)
        return null;
    const { above, below } = odds;
    if (above && below)
        return `Even odds fall between ${level(above.label)} and ${level(below.label)}. Traders give a ${share(above.probability)} chance of ${outcome(above)} and a ${share(below.probability)} chance of ${outcome(below)}.`;
    if (above)
        return `Traders give better than even odds of ${outcome(above)}, the highest level Kalshi lists (${share(above.probability)}).`;
    if (below)
        return `Traders give less than even odds of ${outcome(below)}, the lowest level Kalshi lists (${share(below.probability)}).`;
    return null;
}

// The same reading in a few words, for a table row.
export function summarizeEvenOdds(metric: EarningsMetric): string {
    const odds = metric.evenOdds;
    if (!odds)
        return metric.thresholds.length ? 'Odds do not fall in order across its levels' : 'A range ladder; see its outcomes below';
    if (odds.above && odds.below)
        return `Even odds between ${level(odds.above.label)} and ${level(odds.below.label)}`;
    return odds.above ? `Likely ${outcome(odds.above)} (${share(odds.above.probability)})` : odds.below ? `Unlikely ${outcome(odds.below)} (${share(odds.below.probability)})` : 'No levels listed';
}

// The two levels either side of even odds, which the bars highlight.
export const leadTickers = (metric: EarningsMetric) => new Set([metric.evenOdds?.above?.ticker, metric.evenOdds?.below?.ticker].filter((ticker): ticker is string => Boolean(ticker)));

// The average size of the move across past reports and what it is in dollars on the holding.
export function describeTypicalMove(data: EarningsResponse, money: (value: number) => string): string | null {
    const typical = data.typicalMove;
    if (!typical || !data.position)
        return null;
    return `±${(typical.percent * 100).toFixed(1)}% ≈ ±${money(typical.usd)} on your ${money(data.position.valueUsd)}`;
}

export const signed = (move: number) => `${move < 0 ? '−' : '+'}${Math.abs(move * 100).toFixed(1)}`;
