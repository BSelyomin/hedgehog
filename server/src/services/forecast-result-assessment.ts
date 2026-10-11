import type { ForecastResultAssessmentResponse } from '../../../shared/types.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { aiPool, query } from '../db.ts';
import { cachedAI, contentHash, readAI } from './ai-cache.ts';
import { assessmentPredictions, assessmentRequest, assessmentRejectionReasons, checkedForecastEstimate,
    FORECAST_INSTRUCTIONS, FORECAST_PROMPT, FORECAST_SCHEMA, type ForecastAssessmentContext } from './forecast-assessment.ts';
import { loadForecasts } from './forecasts.ts';
import { forecastResult, rankedForecasts } from './ranked-forecasts.ts';
import { CortexError, cortexResult, isObject, readCortexResult, snowflakeConfigured, type SourcePassage } from './snowflake.ts';

const LEGACY_INSTRUCTIONS = FORECAST_INSTRUCTIONS + ' This is an explicitly selected individual result. Return exactly one assumption for its marketTicker if it has allowedDrivers and no supported change. Keep jointForecasts empty. The other contracts are context only; do not substitute a combined forecast for this conditional result.';
const INSTRUCTIONS = FORECAST_PROMPT + ' Assess only the single supplied market. Return its exact marketTicker as selectedMarketTicker and exactly one assumptions item using one allowedDriver, a finite change in its stated unit, and integer confidence from 0 to 100. Keep jointForecasts empty. Text must be short, qualitative and contain no numbers or URLs. Cite the supplied sourceIds. Missing verified driver-level mapping calls for a cautious, explicitly labeled driver assumption, not an empty assumptions array. Stock effects will be calculated from the supplied historical measurements by code.';
const running = new Map<string, Promise<ForecastResultAssessmentResponse>>();
let executing = 0;
const failures = new Map<string, string>();
const FAILURE_NAMESPACE = 'forecast-result-failure-v1';

/** GET is cache/status only. A POST authorizes one attempt; retry must be explicit. */
export async function forecastResultAssessment(session: string, ticker: string,
    action: 'read' | 'start' | 'retry' = 'read', context?: ForecastAssessmentContext): Promise<ForecastResultAssessmentResponse | null> {
    const events = context?.events ?? await rankedForecasts(session);
    const event = events.events.find(e => e.outcomes.some(m => m.ticker === ticker));
    if (!event) return null; // Membership comes from this session's reviewed portfolio links.
    const model = context?.model ?? await loadForecasts(session, 2);
    const { input, identity: portfolioIdentity, sources } = assessmentRequest(event, model.data, model.holdings, ticker);
    const identity = { ...portfolioIdentity, outcomes: portfolioIdentity.outcomes.filter(m => m.ticker === ticker), session };
    // Neither quotes nor the arrival of sibling contracts should restart a stopped result.
    const failureIdentity = { session, marketTicker: ticker, groupKey: portfolioIdentity.groupKey,
        holdings: portfolioIdentity.holdings, measurements: portfolioIdentity.measurements,
        // A prompt improvement does not authorize retrying a previously stopped request.
        instructions: LEGACY_INSTRUCTIONS, account: process.env.SNOWFLAKE_ACCOUNT_URL?.trim(), model: process.env.SNOWFLAKE_CORTEX_MODEL?.trim() };
    const key = contentHash(failureIdentity);
    const status = (state: ForecastResultAssessmentResponse['status'], reason: string | null): ForecastResultAssessmentResponse => ({
        marketTicker: ticker, status: state, selectedMarketTicker: null, summary: null, generatedAt: null, reason, asOf: events.asOf });
    const outcome = event.outcomes.find(m => m.ticker === ticker)!;
    if (outcome.result.changeUsd !== null) {
        const prediction = await forecastResult(session, ticker, undefined, model);
        return prediction && prediction.result.changeUsd !== null ? { ...status('ready', 'A measured result is already available; no AI request is needed.'),
            selectedMarketTicker: ticker, predictions: [prediction] }
            : status('unavailable', 'This result no longer has an open, supported stock-effects calculation. Reload forecasts for current results.');
    }
    if (!input.markets[0]?.allowedDrivers.length) return status('unavailable', 'No reliable measured driver is available for the reviewed holdings linked to this result. Load price history and run the measurement job.');
    if (!snowflakeConfigured()) return status('unavailable', 'Configure Snowflake Cortex to enable AI assumptions.');
    if (!sources.length) return status('unavailable', 'No verified source references are available for this result.');
    const schema = {
        ...FORECAST_SCHEMA, properties: { ...FORECAST_SCHEMA.properties,
            selectedMarketTicker: { type: 'string', enum: [ticker] },
            assumptions: { ...FORECAST_SCHEMA.properties.assumptions, description: 'Return exactly one conditional driver assumption for the selected market.',
                items: { ...FORECAST_SCHEMA.properties.assumptions.items,
                    properties: { ...FORECAST_SCHEMA.properties.assumptions.items.properties,
                        marketTicker: { type: 'string', enum: [ticker] },
                        driver: { type: 'string', enum: input.markets[0].allowedDrivers },
                        confidence: FORECAST_SCHEMA.properties.assumptions.items.properties.confidence } } },
            jointForecasts: { ...FORECAST_SCHEMA.properties.jointForecasts, description: 'Return an empty array for this individual conditional result.' } }
    };
    // Sibling contracts belong to the combined assessment. Including thousands of
    // them here swamps the conditional task without improving its measurements.
    const targetedInput = { ...input, contracts: input.contracts.filter(m => m.marketTicker === ticker),
        sources: sources.filter(s => !s.id.startsWith('event-') || input.markets.some(m => m.eventTicker === event.sourceEvents?.[Number(s.id.slice(6))]?.ticker)) };

    const ready = (stored: { result: unknown; input: unknown }, createdAt: string) => {
        const originalSources = isObject(stored.input) && Array.isArray(stored.input.sources) ? stored.input.sources as SourcePassage[] : [];
        const checked = checkedForecastEstimate(stored.result, stored.input, originalSources);
        const predictions = checked ? assessmentPredictions(event, model.data, checked.assumptions) : [];
        if (!checked || checked.selectedMarketTicker !== ticker || predictions.length !== 1 || predictions[0].result.changeUsd === null)
            return status('unavailable', 'The individual estimate failed validation or no longer has a usable measurement.');
        return { marketTicker: ticker, status: 'ready' as const, selectedMarketTicker: ticker, summary: checked.summary,
            generatedAt: createdAt, reason: checked.explanationReason, explanationStatus: checked.explanationStatus,
            assumptions: checked.assumptions, predictions, asOf: events.asOf };
    };
    const cached = await readCortexResult(INSTRUCTIONS, schema, identity)
        ?? await readCortexResult(LEGACY_INSTRUCTIONS, FORECAST_SCHEMA, identity);
    if (cached) {
        console.info('[Forecast result AI] cache_hit', { generatedAt: cached.createdAt });
        return ready(cached.value, cached.createdAt);
    }
    const active = running.get(key);
    if (active) return action === 'read' ? status('pending', null) : active;
    if (action === 'retry') {
        await query('DELETE FROM ai_cache WHERE namespace=$1 AND input_hash=$2', [FAILURE_NAMESPACE, key]);
        failures.delete(key);
    }
    const failure = failures.get(key) ?? (await readAI<{ reason: string }>(FAILURE_NAMESPACE, failureIdentity))?.value.reason;
    if (failure) return status('unavailable', `${failure} Automatic retries are stopped. Use Retry result estimate for another explicit attempt.`);
    if (action === 'read') return status('not-requested', 'Open View results to load conditional stock-effects estimates.');
    const started = running.get(key);
    if (started) return started;
    if (running.size >= 32) return status('not-requested', 'The estimate queue is full. Select Estimate this result when current estimates finish.');

    const task = (async () => {
        let acquired = false;
        try {
            // This is a queue for the first authorized attempt, not a retry of a
            // provider request. Hold no database connection while other AI jobs run.
            const deadline = performance.now() + 45_000;
            const available = () => executing < 2 && aiPool.totalCount - aiPool.idleCount < (aiPool.options.max ?? 2) && aiPool.waitingCount === 0;
            while (!available()) {
                if (performance.now() >= deadline) return status('not-requested', 'AI capacity is still busy. Select Estimate this result for a new attempt.');
                await delay(250);
            }
            executing++; acquired = true;
            const stored = await cortexResult(INSTRUCTIONS, targetedInput, schema, identity, result => {
                const checked = checkedForecastEstimate(result, targetedInput, targetedInput.sources);
                const accepted = checked?.selectedMarketTicker === ticker && checked.assumptions.length === 1;
                const rejectionReasons = accepted ? [] : assessmentRejectionReasons(result, targetedInput, targetedInput.sources);
                console.info('[Forecast result AI] response_validated', { accepted, rejectionReasons,
                    assumptions: checked?.assumptions.map(a => ({ driver: a.driver, change: a.change, confidence: a.confidence })) ?? [] });
                if (!accepted) throw new CortexError(`Snowflake result estimate rejected: ${rejectionReasons.join(', ')}.`);
                return true;
            });
            return ready(stored.value, stored.createdAt);
        } catch (error) {
            const reason = error instanceof CortexError ? error.message : 'Individual AI estimate storage or configuration failed. Check backend settings.';
            failures.set(key, reason);
            console.warn('[Forecast result AI] assessment_failed', { reason });
            try { await cachedAI(FAILURE_NAMESPACE, failureIdentity, async () => ({ reason })); }
            catch { console.warn('[Forecast result AI] failure_status_not_saved', { reason: 'database_unavailable' }); }
            return status('unavailable', `${reason} Automatic retries are stopped. Use Retry result estimate for another explicit attempt.`);
        } finally { if (acquired) executing--; running.delete(key); }
    })();
    running.set(key, task);
    return task;
}
