import type { ForecastAssessmentResponse, ForecastAssessmentsResponse, ForecastMarket } from '../../../shared/types.ts';
import { PAGE_CACHE_MS } from '../../../shared/cache.ts';
import { getHoldings, portfolioRevision } from './holdings.ts';
import { forecastMarkets, loadForecasts, MAX_QUOTE_AGE_MS } from './forecasts.ts';
import { forecastResult, rankedForecasts } from './ranked-forecasts.ts';
import { forecastAssessment, forecastAssessments, retryForecastAssessment } from './forecast-assessment.ts';
import { completedPriceDate } from './price-date.ts';
import { timed } from './request-timing.ts';
import { snowflakeConfigured } from './snowflake.ts';
import { forecastResultAssessment } from './forecast-result-assessment.ts';

interface Snapshot {
    portfolio: Awaited<ReturnType<typeof getHoldings>>;
    until: number;
    refreshing: boolean;
    reads: Map<string, { promise: Promise<unknown> }>;
}
const MAX_PORTFOLIOS = 32, MAX_READS = 128;
const snapshots = new Map<string, Snapshot>();

async function withSnapshot<T>(session: string, refresh: boolean, run: (snapshot: Snapshot) => Promise<T>): Promise<T> {
    const portfolio = await timed('holdings', () => getHoldings(session));
    const key = JSON.stringify([session, portfolioRevision(portfolio), completedPriceDate(new Date(Date.now())),
        snowflakeConfigured(), process.env.SNOWFLAKE_ACCOUNT_URL?.trim(), process.env.SNOWFLAKE_CORTEX_MODEL?.trim()]);
    let snapshot = snapshots.get(key);
    if (!snapshot || snapshot.until <= Date.now() || refresh && !snapshot.refreshing) {
        snapshot = { portfolio, until: Date.now() + PAGE_CACHE_MS, refreshing: refresh, reads: new Map() };
    }
    snapshots.delete(key); snapshots.set(key, snapshot);
    if (snapshots.size > MAX_PORTFOLIOS) snapshots.delete(snapshots.keys().next().value!);
    try { return structuredClone(await run(snapshot)); }
    finally { snapshot.refreshing = false; }
}

// Shared lazy reads avoid fetching long baseline history for the main event table.
// Pending assessments and missing results are not retained; status checks stay live.
async function read<T>(snapshot: Snapshot, key: string, build: () => Promise<T>, retain: (value: T) => boolean = () => true): Promise<T> {
    const saved = snapshot.reads.get(key);
    if (saved) {
        snapshot.reads.delete(key); snapshot.reads.set(key, saved);
        return timed('forecasts_cache_hit', () => saved.promise as Promise<T>);
    }
    const entry = { promise: timed('forecasts_build', build) };
    snapshot.reads.set(key, entry);
    if (snapshot.reads.size > MAX_READS) snapshot.reads.delete(snapshot.reads.keys().next().value!);
    try {
        const value = await entry.promise;
        if (!retain(value) && snapshot.reads.get(key) === entry) snapshot.reads.delete(key);
        return value;
    } catch (error) {
        if (snapshot.reads.get(key) === entry) snapshot.reads.delete(key);
        throw error;
    }
}

function model(session: string, snapshot: Snapshot, history: 2 | 321 = 2) {
    const key = history === 2 && snapshot.reads.has('model:321') ? 'model:321' : `model:${history}`;
    return read(snapshot, key, () => loadForecasts(session, history, snapshot.portfolio));
}
function limitLifetime(snapshot: Snapshot, markets: Pick<ForecastMarket, 'closeTime' | 'probability' | 'asOf'>[]) {
    // Never retain an open contract past close or a quoted probability past its
    // existing freshness limit, even if the page cache has time left.
    for (const market of markets) {
        snapshot.until = Math.min(snapshot.until, Date.parse(market.closeTime));
        if (market.probability !== null && market.asOf) snapshot.until = Math.min(snapshot.until, Date.parse(market.asOf) + MAX_QUOTE_AGE_MS);
    }
}
function ranked(session: string, snapshot: Snapshot) {
    return read(snapshot, 'ranked', async () => {
        const data = await rankedForecasts(session, await model(session, snapshot));
        limitLifetime(snapshot, data.events.flatMap(event => event.outcomes));
        return data;
    });
}
async function assessmentContext(session: string, snapshot: Snapshot) {
    const events = await ranked(session, snapshot), data = await model(session, snapshot);
    return { events, model: data };
}
const terminal = (value: ForecastAssessmentResponse | null) => value !== null && value.status !== 'pending';

export function cachedForecasts(session: string, refresh = false) {
    return withSnapshot(session, refresh, async snapshot => (await model(session, snapshot, 321)).data);
}
export function cachedForecastMarkets(session: string, refresh = false) {
    return withSnapshot(session, refresh, snapshot => read(snapshot, 'markets', async () => {
        const data = await forecastMarkets(session, snapshot.portfolio);
        limitLifetime(snapshot, data.markets);
        return data;
    }));
}
export function cachedRankedForecasts(session: string, refresh = false) {
    return withSnapshot(session, refresh, snapshot => ranked(session, snapshot));
}
export function cachedForecastResult(session: string, ticker: string, refresh = false) {
    return withSnapshot(session, refresh, snapshot => read(snapshot, `result:${ticker}`,
        async () => {
            const data = await forecastResult(session, ticker, undefined, await model(session, snapshot));
            if (data) limitLifetime(snapshot, [data.market]);
            return data;
        }, value => value !== null));
}
export function cachedForecastAssessment(session: string, ticker: string, refresh = false) {
    return withSnapshot(session, refresh, snapshot => read(snapshot, `assessment:${ticker}`,
        async () => forecastAssessment(session, ticker, await assessmentContext(session, snapshot)), terminal));
}
export function cachedForecastAssessments(session: string, refresh = false) {
    return withSnapshot(session, refresh, snapshot => read<ForecastAssessmentsResponse>(snapshot, 'assessment:all',
        async () => forecastAssessments(session, await assessmentContext(session, snapshot)),
        value => value.assessments.every(item => terminal(item.assessment))));
}
export function cachedRetryForecastAssessment(session: string, ticker: string) {
    return withSnapshot(session, true, async snapshot => {
        const clear = () => { for (const key of snapshot.reads.keys()) if (key.startsWith('assessment:')) snapshot.reads.delete(key); };
        clear();
        try { return await retryForecastAssessment(session, ticker, await assessmentContext(session, snapshot)); }
        finally { clear(); }
    });
}

export function cachedForecastResultAssessment(session: string, ticker: string,
    action: 'read' | 'start' | 'retry' = 'read', refresh = false) {
    return withSnapshot(session, refresh, async snapshot =>
        forecastResultAssessment(session, ticker, action, await assessmentContext(session, snapshot)));
}
