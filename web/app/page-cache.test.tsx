import { it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { api, cacheResponse, getCachedResponse, getCacheOwner, invalidateCachedResponses, setSessionKey } from '../lib/api-client';
import { useData } from './common';

const originalFetch = globalThis.fetch, originalNow = Date.now;
afterEach(() => { globalThis.fetch = originalFetch; Date.now = originalNow; setSessionKey('reset-after-page-cache-test'); });

function CachedPage({ path }: { path: string }) {
    const { data, error } = useData<{ value: number }>(path);
    return <p>{error || (data ? `Loaded ${data.value}` : 'Loading')}</p>;
}

it('reuses every page read and hydrates remounted pages on their first render', async () => {
    setSessionKey('navigation-owner'); const calls: string[] = [];
    globalThis.fetch = async url => { calls.push(String(url)); return Response.json({ value: calls.length, asOf: 'source-time' }); };
    const paths = ['/holdings', '/exposure', '/calendar?days=14', '/moves?range=day', '/earnings', '/earnings/AAPL',
        '/event/OIL', '/odds/OIL?range=week', '/track-record/ratings?horizon=24', '/track-record?horizon=24',
        '/holdings-history?subject=oil', '/briefing', '/brokerages', '/brokerages/accounts/id/activities?offset=0&limit=100', '/forecasts/ranked-events'];
    for (const path of paths) await api(path);
    for (const path of paths) {
        const snapshot = await api<{ value: number }>(path);
        assert.ok(renderToStaticMarkup(<CachedPage path={path}/>).includes(`Loaded ${snapshot.value}`));
        snapshot.value = -1;
        assert.notEqual(getCachedResponse<{ value: number }>(path)?.value, -1);
    }
    assert.equal(calls.length, paths.length);
    assert.equal(renderToStaticMarkup(<CachedPage path="/event/OTHER"/>), '<p>Loading</p>');
});

it('shares equivalent query strings while keeping different filters, dates and pages separate', async () => {
    setSessionKey('filters-owner'); let calls = 0;
    globalThis.fetch = async () => Response.json({ value: ++calls });
    await api('/moves?range=day&date=2026-10-09'); await api('/moves?date=2026-10-09&range=day');
    await api('/moves?range=week&date=2026-10-09'); await api('/moves?range=day&date=2026-10-08');
    await api('/track-record/ratings?page=1'); await api('/track-record/ratings?page=2');
    assert.equal(calls, 5);
});

it('expires page reads after five minutes without extending their lifetime on navigation', async () => {
    setSessionKey('expiry-owner'); let now = 1000, calls = 0; Date.now = () => now;
    globalThis.fetch = async () => Response.json({ value: ++calls });
    await api('/exposure'); now += 299_999; await api('/exposure'); assert.equal(calls, 1);
    now++; assert.equal(getCachedResponse('/exposure'), null); await api('/exposure'); assert.equal(calls, 2);
    await api('/health'); now += 30_000; assert.equal(getCachedResponse('/health'), null);
});

it('keeps authentication live and honors an explicit no-store request', async () => {
    setSessionKey('live-owner'); let calls = 0;
    globalThis.fetch = async () => Response.json({ value: ++calls });
    await api('/auth/session'); await api('/auth/session'); assert.equal(getCachedResponse('/auth/session'), null);
    await api('/moves', { cache: 'no-store' }); await api('/moves', { cache: 'no-store' });
    assert.equal(getCachedResponse('/moves'), null); assert.equal(calls, 4);
});

it('bounds the private cache and evicts the least recently used response', async () => {
    setSessionKey('bounded-owner');
    for (let i = 0; i < 200; i++) cacheResponse(`/event/${i}`, { value: i });
    assert.deepEqual(getCachedResponse('/event/0'), { value: 0 });
    cacheResponse('/event/200', { value: 200 });
    assert.equal(getCachedResponse('/event/1'), null);
    assert.deepEqual(getCachedResponse('/event/0'), { value: 0 });
});

it('cancels a navigating consumer while another consumer finishes the same request', async () => {
    setSessionKey('shared-owner'); let calls = 0, release!: (response: Response) => void, producerSignal: AbortSignal | null = null;
    globalThis.fetch = async (_url, options) => { calls++; producerSignal = options!.signal!; return new Promise(resolve => { release = resolve; }); };
    const controller = new AbortController();
    const first = api('/exposure', { signal: controller.signal }); const second = api('/exposure');
    controller.abort(); await assert.rejects(first, error => error instanceof Error && error.name === 'AbortError');
    assert.equal((producerSignal as AbortSignal | null)?.aborted, false);
    release(Response.json({ value: 100 })); assert.deepEqual(await second, { value: 100 });
    await api('/exposure'); assert.equal(calls, 1);
});

it('does not start a request for an already cancelled page', async () => {
    setSessionKey('cancelled-owner'); let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ value: 1 }); };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api('/calendar', { signal: controller.signal }), error => error instanceof Error && error.name === 'AbortError');
    assert.equal(calls, 0);
});

it('explicit reload supersedes an older in-flight read and only saves the refreshed response', async () => {
    setSessionKey('refresh-owner'); let calls = 0; const releases: ((response: Response) => void)[] = [];
    globalThis.fetch = async () => { calls++; return new Promise(resolve => { releases.push(resolve); }); };
    const old = api('/moves'); const fresh = api('/moves', { cache: 'reload' });
    const sameRefresh = api('/moves', { cache: 'reload' }); assert.equal(calls, 2);
    releases[1](Response.json({ value: 200 })); await fresh; await sameRefresh;
    releases[0](Response.json({ value: 100 })); await old;
    assert.deepEqual(await api('/moves'), { value: 200 }); assert.equal(calls, 2);
});

it('invalidates all pages around writes, including failed writes and reads made during a write', async () => {
    setSessionKey('write-owner'); let finishWrite!: (response: Response) => void, finishRead!: (response: Response) => void;
    cacheResponse('/exposure', { value: 100 }); cacheResponse('/moves', { value: 100 });
    globalThis.fetch = async (_url, options) => new Promise(resolve => {
        if (options?.method === 'POST') finishWrite = resolve; else finishRead = resolve;
    });
    const write = api('/holdings', { method: 'POST', body: '{}' }); assert.equal(getCachedResponse('/exposure'), null);
    const duringWrite = api('/moves'); finishWrite(Response.json({ saved: true })); await write;
    finishRead(Response.json({ value: 100 })); await duringWrite; assert.equal(getCachedResponse('/moves'), null);
    cacheResponse('/exposure', { value: 200 });
    globalThis.fetch = async () => { throw new Error('Write connection lost'); };
    await assert.rejects(api('/holdings', { method: 'POST', body: '{}' }), /connection lost/);
    assert.equal(getCachedResponse('/exposure'), null);
});

it('isolates accounts and refuses to save a response returned to an old account', async () => {
    setSessionKey('old-owner'); let release!: (response: Response) => void;
    const owner = getCacheOwner();
    globalThis.fetch = async () => new Promise(resolve => { release = resolve; });
    const old = api('/exposure'); setSessionKey('new-owner');
    release(Response.json({ value: 100 })); await old;
    cacheResponse('/brokerages', { value: 100 }, owner);
    assert.equal(getCachedResponse('/exposure'), null); assert.equal(getCachedResponse('/brokerages'), null);
    assert.equal(renderToStaticMarkup(<CachedPage path="/exposure"/>), '<p>Loading</p>');
});

it('does not evict page reads when calculating a scenario without saving portfolio changes', async () => {
    setSessionKey('scenario-owner'); let calls = 0;
    cacheResponse('/exposure', { value: 100 });
    globalThis.fetch = async () => { calls++; return Response.json({ changeUsd: 20 }); };
    for (const path of ['/forecasts/scenario', '/forecasts/event', '/forecasts/result/OIL'])
        await api(path, { method: 'POST', body: '{}' });
    assert.deepEqual(await api('/exposure'), { value: 100 }); assert.equal(calls, 3);
});

it('clears private page snapshots when the server rejects an expired or changed session', async () => {
    setSessionKey('expired-owner'); cacheResponse('/exposure', { value: 100 });
    globalThis.fetch = async () => Response.json({ error: 'Sign in required' }, { status: 401 });
    await assert.rejects(api('/brokerages'), /Sign in required/); assert.equal(getCachedResponse('/exposure'), null);
    cacheResponse('/moves', { value: 100 });
    globalThis.fetch = async () => Response.json({ error: 'Your session changed' }, { status: 409 });
    await assert.rejects(api('/calendar'), /session changed/); assert.equal(getCachedResponse('/moves'), null);
});

it('refreshes the earnings list explicitly, then reuses normal company reads without evicting other pages', async () => {
    setSessionKey('earnings-refresh-owner'); const refreshes: boolean[] = [];
    globalThis.fetch = async (_url, options) => {
        refreshes.push(new Headers(options?.headers).get('X-Hedgehog-Refresh') === '1');
        return Response.json({ value: refreshes.length });
    };
    await api('/exposure'); await api('/earnings'); await api('/earnings/AAPL');
    invalidateCachedResponses('/earnings/');
    await api('/earnings', { cache: 'reload' }); await api('/earnings/AAPL');
    await api('/earnings/AAPL'); await api('/exposure');
    assert.deepEqual(refreshes, [false, false, false, true, false]);
});
