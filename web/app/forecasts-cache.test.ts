import { it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { api, cacheResponse, getCachedResponse, invalidateCachedResponses, setSessionKey } from '../lib/api-client';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; setSessionKey('reset-after-cache-test'); });

it('coalesces forecast requests, caches completed responses and reloads explicitly without sharing mutable snapshots', async () => {
    setSessionKey('cache-reader'); let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ events: ['stored'], asOf: null }); };
    const [a, b] = await Promise.all([api<{ events: string[] }>('/forecasts/ranked-events'), api<{ events: string[] }>('/forecasts/ranked-events')]);
    assert.equal(calls, 1); a.events.push('mutation'); assert.deepEqual(b.events, ['stored']);
    assert.deepEqual((await api<{ events: string[] }>('/forecasts/ranked-events')).events, ['stored']); assert.equal(calls, 1);
    await api('/forecasts/ranked-events', { cache: 'reload' }); assert.equal(calls, 2);
});

it('does not cache pending assessments or transport errors; terminal unavailable results are cached', async () => {
    setSessionKey('pending-reader'); let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ assessments: [{ assessment: { status: calls <= 2 ? 'pending' : 'unavailable' } }], asOf: null }); };
    for (let i = 0; i < 4; i++) await api('/forecasts/assessments');
    assert.equal(calls, 3);
    globalThis.fetch = async () => { calls++; throw new Error('network offline'); };
    await assert.rejects(api('/forecasts/assessments', { cache: 'reload' }), /network offline/);
    await assert.rejects(api('/forecasts/assessments', { cache: 'reload' }), /network offline/);
    assert.equal(calls, 5);
});

it('invalidates forecast responses after holding mutations and account changes', async () => {
    setSessionKey('first-owner'); let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ totalValue: calls, asOf: null }); };
    await api('/forecasts'); await api('/forecasts'); assert.equal(calls, 1);
    await api('/holdings', { method: 'POST', body: '{}' });
    await api('/forecasts'); assert.equal(calls, 3);
    setSessionKey('second-owner'); await api('/forecasts'); assert.equal(calls, 4);
});

it('never saves an old in-flight portfolio reply after holdings change', async () => {
    setSessionKey('in-flight-owner'); let release!: (response: Response) => void, calls = 0;
    globalThis.fetch = async (_url, options) => {
        calls++;
        if (!options?.method || options.method === 'GET') {
            if (calls === 1) return new Promise<Response>(resolve => { release = resolve; });
            return Response.json({ totalValue: 2000, asOf: null });
        }
        return Response.json({ saved: true, asOf: null });
    };
    const stale = api('/forecasts');
    await api('/holdings', { method: 'POST', body: '{}' });
    release(Response.json({ totalValue: 1000, asOf: null })); await stale;
    assert.equal((await api<{ totalValue: number }>('/forecasts')).totalValue, 2000); assert.equal(calls, 3);
});

it('refreshes ranked data once, then reads assessments/results normally without retaining earlier forecast page snapshots', async () => {
    setSessionKey('forecast-page-refresh');
    const calls: { path: string; refresh: string | null }[] = [];
    let version = 1;
    globalThis.fetch = async (url, options) => {
        const path = String(url); calls.push({ path, refresh: new Headers(options?.headers).get('X-Hedgehog-Refresh') });
        return Response.json({ version, assessments: [{ assessment: { status: 'ready' } }], asOf: null });
    };
    const paths = ['/forecasts/ranked-events', '/forecasts/assessments', '/forecasts/result/M'];
    for (const path of [...paths, '/moves']) await api(path);
    version = 2; calls.length = 0;
    invalidateCachedResponses('/forecasts');
    await api(paths[0], { cache: 'reload' });
    await api(paths[1]); await api(paths[2]);
    assert.deepEqual(calls, paths.map((path, i) => ({ path: `/api${path}`, refresh: i === 0 ? '1' : null })));
    for (const path of paths) assert.equal(getCachedResponse<{ version: number }>(path)?.version, 2);
    assert.equal(getCachedResponse<{ version: number }>('/moves')?.version, 1);
    for (const path of paths) await api(path);
    assert.equal(calls.length, 3);
});

it('invalidates only a selected result status when requesting AI, preserving other page caches and excluding older reads', async () => {
    setSessionKey('individual-result-cache');
    const path = '/forecasts/result/M11/assessment';
    let release!: (response: Response) => void;
    globalThis.fetch = async (_url, options) => options?.method === 'POST'
        ? Response.json({ marketTicker: 'M11', status: 'ready', predictions: [], asOf: null })
        : new Promise(resolve => { release = resolve; });
    cacheResponse('/moves', { holdings: ['stored'], asOf: null });
    cacheResponse('/forecasts/ranked-events', { events: ['stored'], asOf: null });
    const previousRead = api(path);
    const result = await api(path, { method: 'POST', body: '{}' });
    cacheResponse(path, result);
    release(Response.json({ marketTicker: 'M11', status: 'not-requested', asOf: null })); await previousRead;
    assert.equal(getCachedResponse<{ status: string }>(path)?.status, 'ready');
    assert.deepEqual(getCachedResponse('/moves'), { holdings: ['stored'], asOf: null });
    assert.deepEqual(getCachedResponse('/forecasts/ranked-events'), { events: ['stored'], asOf: null });
    await api(`${path}/retry`, { method: 'POST', body: '{}' });
    assert.equal(getCachedResponse(path), null);
    assert.deepEqual(getCachedResponse('/moves'), { holdings: ['stored'], asOf: null });
});
