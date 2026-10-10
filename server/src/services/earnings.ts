import type { EarningsReportMove, EarningsResponse, ExposureEvent } from '../../../shared/types.ts';
import { query } from '../db.ts';
import { exposure } from './exposure.ts';
import { briefingDay } from './briefing-content.ts';
import { secConfigured } from './sec.ts';
export function normalizeLadder(event: ExposureEvent) {
    if (!event.mutuallyExclusive || !event.markets.length || !event.markets.every(m => m.kind === 'bracket' && m.probability !== null))
        return null;
    const rawSum = event.markets.reduce((s, m) => s + m.probability!, 0);
    if (rawSum <= 0)
        return null;
    return { eventTicker: event.ticker, rawSum, outcomes: event.markets.map(m => ({ ticker: m.ticker, title: m.subtitle || m.title, probability: m.probability! / rawSum })) };
}

const WEEK = 7 * 86400000;
// The move across a results filing: last close before the SEC filing date to the first close after
// it. Two sessions cover both a pre-market and an after-close release without needing the release
// time, which EDGAR's JSON does not report reliably. A close more than a week away means the price
// history has a gap, so no move is shown.
export function reportMove(filingDate: string, closes: { date: string; close: number }[]) {
    const near = (row?: { date: string; close: number }) => row && Math.abs(Date.parse(row.date) - Date.parse(filingDate)) <= WEEK && row.close > 0 ? row : null;
    const before = near(closes.filter(row => row.date < filingDate).at(-1)), after = near(closes.find(row => row.date > filingDate));
    return { beforeDate: before?.date ?? null, closeBefore: before?.close ?? null, afterDate: after?.date ?? null, closeAfter: after?.close ?? null,
        move: before && after ? after.close / before.close - 1 : null };
}

async function reportHistory(symbol: string): Promise<EarningsReportMove[]> {
    const reports = await query<{ filing_date: string; source_url: string }>(
        `SELECT to_char(filing_date,'YYYY-MM-DD') filing_date,source_url FROM earnings_reports WHERE symbol=$1 ORDER BY filing_date DESC LIMIT 8`, [symbol]);
    if (!reports.length)
        return [];
    // Yahoo's daily candle for the current New York day can still be in progress; never use it as a close.
    const closes = await query<{ date: string; close: number }>(
        `SELECT to_char(ts,'YYYY-MM-DD') date,close FROM prices WHERE symbol=$1 AND ts>=$2::date-interval '10 days' AND ts::date<$3::date ORDER BY ts`,
        [symbol, reports.at(-1)!.filing_date, briefingDay()]);
    return reports.map(report => ({ filingDate: report.filing_date, sourceUrl: report.source_url, ...reportMove(report.filing_date, closes) }));
}

export async function earnings(session: string, symbol: string): Promise<EarningsResponse> {
    const data = await exposure(session);
    const events = data.events.filter(e => e.links.some(l => l.symbol === symbol && l.type === 'Direct'));
    const history = data.holdings.some(h => h.symbol === symbol) ? await reportHistory(symbol) : [];
    const historyNote = history.length
        ? 'Report dates are the SEC filing dates of 8-K filings with Item 2.02 (results of operations). Each move runs from the last close before the filing date to the first close after it, which covers both pre-market and after-close releases. Closes are Yahoo Finance daily closes.'
        : secConfigured() ? 'No SEC results filings (8-K with Item 2.02) have been loaded for this holding.'
            : 'Past report-day moves unavailable: set SEC_USER_AGENT so report dates can be loaded from SEC EDGAR.';
    return { symbol, events, asOf: data.asOf, ladders: events.flatMap(e => { const ladder = normalizeLadder(e); return ladder ? [ladder] : []; }), history: history.length ? history : null, historyNote };
}
