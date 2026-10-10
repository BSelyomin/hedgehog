import type { Trust } from '../../../shared/types.ts';
export const TRUST = { spreadMax: 30, activityMax: 25, depthMax: 20, trackMax: 25, spreadBest: 1, spreadWorst: 10, volumeLog: 5, interestLog: 6, missBest: 2, missWorst: 15, minSettled: 30, high: 80, medium: 60 } as const;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const trustBand = (total: number): 'High' | 'Medium' | 'Low' => total >= TRUST.high ? 'High' : total >= TRUST.medium ? 'Medium' : 'Low';
export function trustScore(spreadCents: number | null, volume24h: number | null, openInterest: number | null, avgMissPts: number | null, count: number): Trust {
    const valid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0;
    const spread = valid(spreadCents) ? TRUST.spreadMax * clamp((TRUST.spreadWorst - spreadCents) / (TRUST.spreadWorst - TRUST.spreadBest)) : null;
    const activity = valid(volume24h) ? TRUST.activityMax * clamp(volume24h === 0 ? 0 : Math.log10(volume24h) / TRUST.volumeLog) : null;
    const depth = valid(openInterest) ? TRUST.depthMax * clamp(openInterest === 0 ? 0 : Math.log10(openInterest) / TRUST.interestLog) : null;
    const trackRecord = count >= TRUST.minSettled && valid(avgMissPts) ? TRUST.trackMax * clamp((TRUST.missWorst - avgMissPts) / (TRUST.missWorst - TRUST.missBest)) : null;
    const total = spread === null || activity === null || depth === null ? null : (spread + activity + depth + (trackRecord ?? 0)) * (trackRecord === null ? 100 / (TRUST.spreadMax + TRUST.activityMax + TRUST.depthMax) : 1);
    return { total, band: total === null ? null : trustBand(total), spread, activity, depth, trackRecord, categoryCount: count, spreadCents };
}
