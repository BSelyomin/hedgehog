export function midpoint(yesBid: number, yesAsk: number) { if (!Number.isFinite(yesBid) || !Number.isFinite(yesAsk) || yesBid < 0 || yesAsk > 1 || yesBid > yesAsk)
    throw new Error('Invalid bid/ask'); return { p: (yesBid + yesAsk) / 2, spread: yesAsk - yesBid }; }
export function checkSensitivity(b: number, se: number, days: number, minDays = 60) { const low = b - 1.96 * se, high = b + 1.96 * se; return { b, low, high, days, reliable: Number.isFinite(b) && Number.isFinite(se) && se >= 0 && Number.isInteger(days) && days >= minDays && (low > 0 || high < 0) }; }
function validatePairs(probs: number[], outcomes: number[]) { if (!probs.length || probs.length !== outcomes.length || probs.some(p => !Number.isFinite(p) || p < 0 || p > 1) || outcomes.some(o => o !== 0 && o !== 1))
    throw new Error('Invalid probabilities/outcomes'); }
export function brier(probs: number[], outcomes: number[]) { validatePairs(probs, outcomes); return probs.reduce((s, p, i) => s + (p - outcomes[i]) ** 2, 0) / probs.length; }
export function calibration(probs: number[], outcomes: number[]) {
    validatePairs(probs, outcomes);
    const buckets = Array.from({ length: 10 }, (_, i) => { const indices = probs.flatMap((p, j) => Math.min(9, Math.floor(p * 10)) === i ? [j] : []); const count = indices.length; return { low: i / 10, high: (i + 1) / 10, count, meanProb: count ? indices.reduce((s, j) => s + probs[j], 0) / count : null, observedRate: count ? indices.reduce((s, j) => s + outcomes[j], 0) / count : null }; });
    const avgMiss = buckets.reduce((s, b) => s + b.count * Math.abs((b.meanProb ?? 0) - (b.observedRate ?? 0)), 0) / probs.length * 100;
    return { buckets, avgMiss };
}
