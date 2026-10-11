import type { EarningsListResponse, EarningsReportMove, EarningsResponse, ExposureEvent, ExposureResponse } from '../../../shared/types.ts';
import { query } from '../db.ts';
import { exposure } from './exposure.ts';
import { briefingDay } from './briefing-content.ts';
import { secConfigured } from './sec.ts';
import { isSecurity } from './asset-links.ts';
import { featuredMetric, isReportedMetric, isResultsEvent, metricFor, typicalMove, upcomingCall } from './earnings-preview.ts';
import { getHoldings, portfolioRevision } from './holdings.ts';
import { timed } from './request-timing.ts';
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

const directEvents = (events: ExposureEvent[], symbol: string) => events.filter(e => e.links.some(l => l.symbol === symbol && l.type === 'Direct'));
const companyNames = async (symbols: string[]) => new Map((await query<{ symbol: string; name: string }>('SELECT symbol,name FROM companies WHERE symbol=ANY($1)', [symbols])).map(row => [row.symbol, row.name]));

interface EarningsContext {
    data: Pick<ExposureResponse, 'holdings' | 'totalValue' | 'events' | 'asOf'>;
    names: Map<string, string>;
    details: Map<string, Promise<EarningsResponse>>;
    list: EarningsListResponse;
}
const CACHE_MS = 5 * 60_000;
const MAX_PORTFOLIOS = 32;
const contexts = new Map<string, { promise: Promise<EarningsContext>; until: number }>();

// Browser refreshes still make authenticated requests. A cheap holdings read
// checks manual/brokerage changes before reusing the expensive private snapshot.
async function earningsContext(session: string, refresh: boolean): Promise<EarningsContext> {
    const portfolio = await timed('holdings', () => getHoldings(session));
    const key = JSON.stringify([session, portfolioRevision(portfolio), briefingDay(), secConfigured()]);
    const saved = contexts.get(key);
    if (!refresh && saved && saved.until > Date.now()) {
        contexts.delete(key); contexts.set(key, saved);
        return timed('earnings_cache_hit', () => saved.promise);
    }
    const entry: { promise: Promise<EarningsContext>; until: number } = { until: Infinity, promise: timed('earnings_build', async () => {
        const [exposed, names] = await Promise.all([
            exposure(session, portfolio), companyNames(portfolio.holdings.filter(isSecurity).map(h => h.symbol))
        ]);
        // Earnings needs company results only; don't retain the full exposure map.
        const data = { holdings: exposed.holdings, totalValue: exposed.totalValue, events: exposed.events.filter(isResultsEvent), asOf: exposed.asOf };
        entry.until = Date.now() + CACHE_MS;
        return { data, names, details: new Map(), list: buildEarningsList(data, names) };
    }) };
    contexts.delete(key); contexts.set(key, entry);
    if (contexts.size > MAX_PORTFOLIOS) contexts.delete(contexts.keys().next().value!);
    void entry.promise.catch(() => { if (contexts.get(key) === entry) contexts.delete(key); });
    return entry.promise;
}

// Holdings with an earnings call Kalshi has dated, soonest first. A company without one is left
// out: without Kalshi's date there is no report to preview.
function buildEarningsList(data: EarningsContext['data'], names: Map<string, string>): EarningsListResponse {
    const securities = data.holdings.filter(isSecurity);
    const companies = securities.flatMap(holding => {
        const results = directEvents(data.events, holding.symbol).filter(isResultsEvent);
        const call = upcomingCall(results);
        return call ? [{ symbol: holding.symbol, name: names.get(holding.symbol) ?? null, valueUsd: holding.valueUsd, callTime: call.time, session: call.session,
            markets: results.reduce((sum, event) => sum + event.markets.length, 0) }] : [];
    }).sort((a, b) => Date.parse(a.callTime) - Date.parse(b.callTime) || a.symbol.localeCompare(b.symbol));
    return { companies, holdings: securities.length, asOf: data.asOf };
}

export async function earningsList(session: string, refresh = false): Promise<EarningsListResponse> {
    return structuredClone((await earningsContext(session, refresh)).list);
}

export async function earnings(session: string, symbol: string, refresh = false): Promise<EarningsResponse> {
    const context = await earningsContext(session, refresh);
    const saved = context.details.get(symbol);
    if (saved) return structuredClone(await timed('earnings_detail_cache_hit', () => saved));
    const task = buildEarnings(context, symbol);
    // Only held securities are cached, so arbitrary ticker reads cannot grow a
    // portfolio's details map beyond its own holdings.
    if (context.data.holdings.some(h => h.symbol === symbol && isSecurity(h))) {
        context.details.set(symbol, task);
        void task.catch(() => { if (context.details.get(symbol) === task) context.details.delete(symbol); });
    }
    return structuredClone(await task);
}

async function buildEarnings({ data, names }: EarningsContext, symbol: string): Promise<EarningsResponse> {
    // Only markets about reported results belong here; other company markets stay on the other screens.
    const events = directEvents(data.events, symbol).filter(isResultsEvent);
    const holding = data.holdings.find(h => h.symbol === symbol && isSecurity(h));
    const history = holding ? await reportHistory(symbol) : [];
    const historyNote = history.length
        ? 'Report dates are the SEC filing dates of 8-K filings with Item 2.02 (results of operations). Each move runs from the last close before the filing date to the first close after it, which covers both pre-market and after-close releases. Closes are Yahoo Finance daily closes.'
        : secConfigured() ? 'No SEC results filings (8-K with Item 2.02) have been loaded for this holding.'
            : 'Past report-day moves unavailable: set SEC_USER_AGENT so report dates can be loaded from SEC EDGAR.';
    const metrics = events.filter(isReportedMetric).map(metricFor);
    return { symbol, events, asOf: data.asOf, ladders: events.flatMap(e => { const ladder = normalizeLadder(e); return ladder ? [ladder] : []; }), history: history.length ? history : null, historyNote,
        name: names.get(symbol) ?? (holding ? null : (await companyNames([symbol])).get(symbol) ?? null),
        position: holding ? { valueUsd: holding.valueUsd, share: data.totalValue ? holding.valueUsd / data.totalValue : 0 } : null,
        call: upcomingCall(events), featured: featuredMetric(metrics), metrics,
        typicalMove: holding ? typicalMove(history, holding.valueUsd) : null };
}
