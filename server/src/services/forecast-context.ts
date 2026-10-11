import type { RankedForecastEvent, RankedForecastOutcome } from '../../../shared/types.ts';

const compare = (a: RankedForecastOutcome, b: RankedForecastOutcome) =>
    Number(b.probability !== null) - Number(a.probability !== null)
    || Number(b.result.changeUsd !== null) - Number(a.result.changeUsd !== null)
    || Math.abs((a.probability ?? .5) - .5) - Math.abs((b.probability ?? .5) - .5)
    || a.ticker.localeCompare(b.ticker);

/** Limit per-contract output work, while representing different times and formats.
 * The complete compact contract set is sent separately for the joint assessment.
 */
export function representativeOutcomes(event: RankedForecastEvent, limit = 48): RankedForecastOutcome[] {
    if (limit <= 0) return [];
    const sets = new Map<string, RankedForecastOutcome[]>();
    for (const outcome of event.outcomes) {
        const key = `${outcome.closeTime}:${outcome.seriesTicker ?? ''}`;
        const set = sets.get(key) ?? []; set.push(outcome); sets.set(key, set);
    }
    let buckets = [...sets].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => rows.sort(compare));
    if (buckets.length > limit) {
        const all = buckets;
        buckets = Array.from({ length: limit }, (_, i) => all[Math.round(i * (all.length - 1) / Math.max(1, limit - 1))]);
    }
    const selected: RankedForecastOutcome[] = [];
    for (let round = 0; selected.length < limit; round++) {
        let added = false;
        for (const bucket of buckets) if (bucket[round] && selected.length < limit) {
            selected.push(bucket[round]); added = true;
        }
        if (!added) break;
    }
    return selected;
}

export function jointForecastScope(event: RankedForecastEvent) {
    const fallback = [...event.measuredSymbols, ...event.unmeasuredSymbols];
    return fallback.filter(symbol => event.outcomes.every(m => (m.linkedSymbols ?? fallback).includes(symbol))).sort();
}
