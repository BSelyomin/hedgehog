import type { ForecastResultAssessmentResponse } from '../../shared/types';
import { api, cacheResponse, getCachedResponse, getCacheOwner, getCacheRevision } from './api-client';

// Opening results authorizes first attempts for the family, not retries. Two lanes
// keep large families from flooding the backend or monopolizing its database pool.
const lanes = [Promise.resolve(), Promise.resolve()];
let nextLane = 0;
const requests = new Map<string, Promise<ForecastResultAssessmentResponse>>();
const stopped = new Map<string, ForecastResultAssessmentResponse>();

export function loadForecastResultAssessment(ticker: string, onStarted: () => void, retry = false): Promise<ForecastResultAssessmentResponse> {
    const owner = getCacheOwner(), revision = getCacheRevision(), path = `/forecasts/result/${encodeURIComponent(ticker)}/assessment`;
    const stopKey = JSON.stringify([owner, revision, path]);
    const failure = stopped.get(stopKey);
    if (!retry && failure) return Promise.resolve(structuredClone(failure));
    const cached = getCachedResponse<ForecastResultAssessmentResponse>(path);
    if (!retry && cached && (cached.status === 'ready' || cached.status === 'unavailable')) return Promise.resolve(cached);
    const key = JSON.stringify([owner, revision, path, retry]);
    const pending = requests.get(key);
    if (pending) return pending.then(value => structuredClone(value));
    const lane = nextLane++ % lanes.length;
    const task = lanes[lane].then(async () => {
        if (owner !== getCacheOwner() || revision !== getCacheRevision()) throw new DOMException('Portfolio changed', 'AbortError');
        onStarted();
        let value: ForecastResultAssessmentResponse;
        try {
            value = await api<ForecastResultAssessmentResponse>(retry ? `${path}/retry` : path,
                { method: 'POST', body: '{}' }, 150_000);
            stopped.delete(stopKey);
        } catch (error) {
            value = { marketTicker: ticker, status: 'unavailable', selectedMarketTicker: null, summary: null,
                generatedAt: null, asOf: null, reason: error instanceof Error ? error.message : 'Result request failed.' };
            stopped.set(stopKey, value);
            if (stopped.size > 200) stopped.delete(stopped.keys().next().value!);
        }
        // Transport failures stop this browser's automatic loading too. Only an
        // explicit retry may resume them; owner checks prevent private cache leaks.
        if (revision === getCacheRevision()) cacheResponse(path, value, owner);
        return value;
    });
    lanes[lane] = task.then(() => {}, () => {});
    requests.set(key, task);
    void task.finally(() => { if (requests.get(key) === task) requests.delete(key); }).catch(() => {});
    return task.then(value => structuredClone(value));
}
