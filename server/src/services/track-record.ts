import type { TrackRecordResponse, CategoryRecord } from '../../../shared/types.ts';
import { query, iso } from '../db.ts';
import { brier, calibration } from '../math/statistics.ts';
export async function trackRecord(): Promise<TrackRecordResponse> {
    const rows = await query<{
        category: string;
        prob_24h_before: number;
        outcome: number;
        loaded_at: Date;
    }>('SELECT category,prob_24h_before,outcome,loaded_at FROM settled_markets');
    const categories: CategoryRecord[] = [];
    for (const category of new Set(rows.map(r => r.category))) {
        const data = rows.filter(r => r.category === category);
        const probs = data.map(r => r.prob_24h_before), outcomes = data.map(r => r.outcome);
        const { avgMiss, buckets } = calibration(probs, outcomes);
        const headline = data.filter(r => r.prob_24h_before >= 0.65 && r.prob_24h_before < 0.75);
        categories.push({ category, count: data.length, avgMiss, brier: brier(probs, outcomes), buckets, headline70: headline.length ? { count: headline.length, observedRate: headline.reduce((s, r) => s + r.outcome, 0) / headline.length } : null });
    }
    return { categories: categories.sort((a, b) => b.count - a.count), asOf: iso(rows.reduce<Date | null>((d, r) => !d || r.loaded_at > d ? r.loaded_at : d, null)) };
}
