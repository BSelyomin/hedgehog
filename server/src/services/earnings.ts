import type { EarningsResponse, ExposureEvent } from '../../../shared/types.ts';
import { exposure } from './exposure.ts';
export function normalizeLadder(event: ExposureEvent) {
    if (!event.mutuallyExclusive || !event.markets.length || !event.markets.every(m => m.kind === 'bracket' && m.probability !== null))
        return null;
    const rawSum = event.markets.reduce((s, m) => s + m.probability!, 0);
    if (rawSum <= 0)
        return null;
    return { eventTicker: event.ticker, rawSum, outcomes: event.markets.map(m => ({ ticker: m.ticker, title: m.subtitle || m.title, probability: m.probability! / rawSum })) };
}
export async function earnings(session: string, symbol: string): Promise<EarningsResponse> { const data = await exposure(session); const events = data.events.filter(e => e.links.some(l => l.symbol === symbol && l.type === 'Direct')); return { symbol, events, asOf: data.asOf, ladders: events.flatMap(e => { const ladder = normalizeLadder(e); return ladder ? [ladder] : []; }), history: null, historyNote: 'Past report-day moves unavailable: no verified free historical report-date source has been configured.' }; }
