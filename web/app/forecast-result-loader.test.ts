import { it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type { ForecastResultAssessmentResponse } from '../../shared/types';
import { cacheResponse, getCachedResponse, setSessionKey } from '../lib/api-client';
import { loadForecastResultAssessment } from '../lib/forecast-result-loader';

const originalFetch = globalThis.fetch, originalNow = Date.now;
afterEach(() => { globalThis.fetch = originalFetch; Date.now = originalNow; setSessionKey('result-loader-reset'); });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const ready = (marketTicker: string): ForecastResultAssessmentResponse => ({ marketTicker, status: 'ready', selectedMarketTicker: marketTicker,
    summary: null, generatedAt: '2026-10-10T12:00:00Z', asOf: '2026-10-10T12:00:00Z', reason: null, predictions: [] });

it('loads all requested rows with two concurrent requests, coalesces duplicates and reuses saved results', async () => {
    setSessionKey('opened-family');
    const calls: string[] = [];
    let active = 0, maximum = 0, started = 0;
    globalThis.fetch = async url => {
        calls.push(String(url)); maximum = Math.max(maximum, ++active);
        await tick(); active--;
        const ticker = String(url).split('/')[4];
        return Response.json(ready(ticker));
    };
    const values = await Promise.all(Array.from({ length: 12 }, (_, i) => loadForecastResultAssessment(`M${i}`, () => { started++; })));
    assert.equal(calls.length, 12); assert.equal(maximum, 2); assert.equal(started, 12);
    assert.ok(values.every(v => v.status === 'ready'));
    for (let i = 0; i < 12; i++) await loadForecastResultAssessment(`M${i}`, () => { throw new Error('Cached results must not start requests'); });
    assert.equal(calls.length, 12);
    const [a, b] = await Promise.all([loadForecastResultAssessment('OTHER', () => { started++; }), loadForecastResultAssessment('OTHER', () => { started++; })]);
    assert.equal(calls.length, 13); assert.equal(started, 13); a.reason = 'local mutation'; assert.equal(b.reason, null);
});

it('keeps rejected estimates stopped until explicit retry, without invalidating other pages', async () => {
    setSessionKey('stopped-family');
    const path = '/forecasts/result/FAILED/assessment';
    cacheResponse(path, { ...ready('FAILED'), status: 'unavailable', reason: 'Rejected confidence.' });
    cacheResponse('/moves', { total: 10 });
    const calls: string[] = [];
    globalThis.fetch = async url => { calls.push(String(url)); return Response.json(ready('FAILED')); };
    assert.equal((await loadForecastResultAssessment('FAILED', () => {})).status, 'unavailable'); assert.equal(calls.length, 0);
    assert.equal((await loadForecastResultAssessment('FAILED', () => {}, true)).status, 'ready');
    assert.deepEqual(calls, ['/api/forecasts/result/FAILED/assessment/retry']);
    assert.deepEqual(getCachedResponse('/moves'), { total: 10 });
});

it('stops transport failures too and lets other rows finish without automatic retry', async () => {
    setSessionKey('failed-transport-family'); let calls = 0;
    globalThis.fetch = async url => {
        calls++; if (String(url).includes('/FAILED/')) throw new Error('Connection lost');
        return Response.json(ready('OTHER'));
    };
    const [failed, other] = await Promise.all([loadForecastResultAssessment('FAILED', () => {}), loadForecastResultAssessment('OTHER', () => {})]);
    assert.equal(failed.status, 'unavailable'); assert.equal(failed.reason, 'Connection lost'); assert.equal(other.status, 'ready');
    await loadForecastResultAssessment('FAILED', () => {}); assert.equal(calls, 2);
    Date.now = () => originalNow() + 3_600_001;
    await loadForecastResultAssessment('FAILED', () => {}); assert.equal(calls, 2, 'Page expiry must not retry a failed request');
});

it('does not send queued work with another account or save old account responses', async () => {
    setSessionKey('old-family-owner');
    const release: (() => void)[] = [], calls: string[] = [];
    globalThis.fetch = async url => { calls.push(String(url)); await new Promise<void>(resolve => { release.push(resolve); }); return Response.json(ready('OLD')); };
    const first = loadForecastResultAssessment('OLD1', () => {}), second = loadForecastResultAssessment('OLD2', () => {});
    const queued = loadForecastResultAssessment('QUEUED', () => {});
    const rejected = assert.rejects(queued, error => error instanceof Error && error.name === 'AbortError');
    await tick(); assert.equal(calls.length, 2);
    setSessionKey('new-family-owner'); release.forEach(done => done());
    await Promise.all([first, second, rejected]);
    assert.equal(calls.length, 2); assert.equal(getCachedResponse('/forecasts/result/OLD1/assessment'), null);
});
