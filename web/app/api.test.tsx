import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { api, readApiResponse, setSessionKey } from '../lib/api-client';
import { proxyApi } from '../lib/api-proxy';
const originalFetch = globalThis.fetch, originalUrl = process.env.API_INTERNAL_URL;
const originalBinding = process.env.HEDGEHOG_SERVER_URL, originalVercel = process.env.VERCEL;
beforeEach(() => { process.env.API_INTERNAL_URL = 'http://backend:4000'; delete process.env.HEDGEHOG_SERVER_URL; delete process.env.VERCEL; });
afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [['API_INTERNAL_URL', originalUrl], ['HEDGEHOG_SERVER_URL', originalBinding], ['VERCEL', originalVercel]]) {
        if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
});

it('allows queued result estimates enough time while keeping ordinary read/write deadlines', async () => {
    const timeout = AbortSignal.timeout, deadlines: number[] = [];
    AbortSignal.timeout = milliseconds => { deadlines.push(milliseconds); return new AbortController().signal; };
    globalThis.fetch = async () => Response.json({ asOf: null });
    try {
        for (const [path, method] of [
            ['/api/forecasts/result/M/assessment', 'POST'], ['/api/forecasts/result/M/assessment/retry', 'POST'],
            ['/api/forecasts/result/M/assessment', 'GET'], ['/api/holdings', 'POST']
        ]) assert.equal((await proxyApi(new Request(`http://localhost:3000${path}`, {
            method, ...(method === 'POST' ? { body: '{}', headers: { 'Content-Type': 'application/json' } } : {})
        }))).status, 200);
        assert.deepEqual(deadlines, [145000, 145000, 25000, 85000]);
    } finally { AbortSignal.timeout = timeout; }
});

it('prefers the injected binding and preserves its base path, query, cookies and refresh', async () => {
    process.env.VERCEL = '1';
    process.env.HEDGEHOG_SERVER_URL = 'https://server.internal/deployment/service/';
    globalThis.fetch = async (url, init) => {
        assert.equal(String(url), 'https://server.internal/deployment/service/exposure?days=14');
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('cookie'), 'hedgehog_auth=fixture');
        assert.equal(headers.get('x-hedgehog-refresh'), '1');
        assert.equal(headers.get('authorization'), null);
        return Response.json({ asOf: null });
    };
    const result = await proxyApi(new Request('https://hedgehog.example/api/exposure?days=14', {
        headers: { Cookie: 'hedgehog_auth=fixture', 'X-Hedgehog-Refresh': '1', Authorization: 'Bearer unrelated' },
    }));
    assert.equal(result.status, 200);
});
it('reads changed bindings at request time and never sends traffic to an obsolete override', async () => {
    const seen: string[] = [];
    globalThis.fetch = async url => { seen.push(String(url)); return Response.json({ asOf: null }); };
    process.env.HEDGEHOG_SERVER_URL = 'http://first.internal';
    await proxyApi(new Request('https://hedgehog.example/api/holdings'));
    process.env.HEDGEHOG_SERVER_URL = 'http://second.internal/';
    await proxyApi(new Request('https://hedgehog.example/api/holdings'));
    assert.deepEqual(seen, ['http://first.internal/holdings', 'http://second.internal/holdings']);
});
it('returns JSON without fetching when a Vercel runtime has no binding', async () => {
    process.env.VERCEL = '1';
    globalThis.fetch = async () => { throw new Error('Must not fall back to localhost or Docker'); };
    const response = await proxyApi(new Request('https://hedgehog.example/api/exposure'));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /binding/);
});
it('forwards cron authorization only to protected operational endpoints', async () => {
    process.env.HEDGEHOG_SERVER_URL = 'https://server.internal/';
    globalThis.fetch = async (url, init) => {
        assert.equal(String(url), 'https://server.internal/internal/jobs/poll');
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-secret');
        return Response.json({ status: 'accepted', asOf: null }, { status: 202 });
    };
    const response = await proxyApi(new Request('https://hedgehog.example/api/internal/jobs/poll', {
        headers: { Authorization: 'Bearer fixture-secret' },
    }));
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

it('replaces the reported plain-text Internal Server Error with an actionable message', async () => {
    await assert.rejects(readApiResponse(new Response('Internal Server Error', { status: 500 }), '/brokerages'),
        error => error instanceof Error && error.message.includes('HTTP 500') && error.message.includes('backend') && !error.message.includes('Unexpected token'));
    await assert.rejects(readApiResponse(new Response('<html>private server details</html>', { status: 502 }), '/holdings'),
        error => error instanceof Error && !error.message.includes('private server details'));
});
it('preserves valid application errors and rejects null/array success responses', async () => {
    await assert.rejects(readApiResponse(Response.json({ error: 'Database unavailable', asOf: null }, { status: 503 }), '/holdings'), /Database unavailable/);
    for (const payload of [null, [], 'not an object']) await assert.rejects(readApiResponse(Response.json(payload), '/holdings'), /unexpected response/);
    assert.deepEqual(await readApiResponse(Response.json({ holdings: [], asOf: null }), '/holdings'), { holdings: [], asOf: null });
});
it('returns JSON when the frontend cannot reach the backend without leaking connection details', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED password=private-secret'); };
    const response = await proxyApi(new Request('http://localhost:3000/api/brokerages'));
    assert.equal(response.status, 502); assert.ok(response.headers.get('content-type')?.includes('application/json'));
    const body = await response.json(); assert.ok(body.error.includes('Cannot reach')); assert.equal(body.asOf, null); assert.ok(!body.error.includes('private-secret'));
});
it('wraps malformed backend responses as JSON and preserves retry headers', async () => {
    globalThis.fetch = async () => new Response('Internal Server Error with private details', { status: 500, headers: { 'Retry-After': '30' } });
    const response = await proxyApi(new Request('http://localhost:3000/api/auth/session'));
    assert.equal(response.status, 502); assert.equal(response.headers.get('retry-after'), '30');
    const body = await response.json(); assert.ok(body.error.includes('HTTP 500')); assert.ok(!body.error.includes('private details'));
});
it('forwards session and CSRF headers, JSON bodies and all authentication cookies', async () => {
    globalThis.fetch = async (url, init) => {
        assert.equal(String(url), 'http://backend:4000/auth/signup');
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('cookie'), 'hedgehog_session=test-guest');
        assert.equal(headers.get('x-hedgehog-session'), 'test-session-key'); assert.equal(headers.get('x-hedgehog-request'), '1');
        assert.equal(headers.get('sec-fetch-site'), 'same-origin');
        assert.deepEqual(JSON.parse(Buffer.from(init?.body as ArrayBuffer).toString()), { name: 'Alex' });
        const response = Response.json({ user: { name: 'Alex' }, asOf: null }, { status: 201 });
        response.headers.append('Set-Cookie', 'hedgehog_auth=test-token; HttpOnly; SameSite=Lax; Path=/');
        response.headers.append('Set-Cookie', 'hedgehog_session=new-guest; HttpOnly; SameSite=Lax; Path=/');
        return response;
    };
    const response = await proxyApi(new Request('http://localhost:3000/api/auth/signup', { method: 'POST', headers: {
        'Content-Type': 'application/json', Cookie: 'hedgehog_session=test-guest', 'X-Hedgehog-Session': 'test-session-key', 'X-Hedgehog-Request': '1', 'Sec-Fetch-Site': 'same-origin',
    }, body: JSON.stringify({ name: 'Alex' }) }));
    assert.equal(response.status, 201); assert.equal(response.headers.getSetCookie().length, 2);
    assert.equal(response.headers.get('cache-control'), 'no-store');
});
it('passes voice audio through and reads the backend address at request time', async () => {
    process.env.API_INTERNAL_URL = 'http://changed-backend:4000';
    globalThis.fetch = async url => {
        assert.equal(String(url), 'http://changed-backend:4000/briefing/audio');
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg', 'X-Data-As-Of': '2026-01-01T00:00:00Z' } });
    };
    const response = await proxyApi(new Request('http://localhost:3000/api/briefing/audio'));
    assert.equal(response.headers.get('content-type'), 'audio/mpeg'); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});
it('keeps browser API calls authenticated and rejects non-JSON failures', async () => {
    setSessionKey('current-session');
    globalThis.fetch = async (url, init) => {
        assert.equal(url, '/api/holdings'); assert.equal(init?.credentials, 'same-origin'); assert.equal(new Headers(init?.headers).get('X-Hedgehog-Session'), 'current-session');
        return new Response('Internal Server Error', { status: 500 });
    };
    await assert.rejects(api('/holdings'), /non-JSON response/);
});
it('rejects oversized requests before forwarding them to the backend', async () => {
    globalThis.fetch = async () => { throw new Error('Oversized requests must not be forwarded'); };
    const response = await proxyApi(new Request('http://localhost:3000/api/holdings', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(33 * 1024) }) }));
    assert.equal(response.status, 413); assert.equal((await response.json()).asOf, null);
});
it('ends a stalled API request with an actionable timeout rather than endless loading', async () => {
    let cancelled = false;
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => { cancelled = true; reject(new DOMException('Aborted', 'AbortError')); });
    });
    await assert.rejects(api('/exposure', undefined, 10), /timed out.*Reload/);
    assert.equal(cancelled, true);
});
it('preserves navigation cancellation without reporting it as a timeout', async () => {
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    const controller = new AbortController();
    const pending = api('/moves', { signal: controller.signal }, 1000);
    controller.abort();
    await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
});

it('forwards backend timing metrics so the browser can diagnose a slow Moves request', async () => {
    const timing = 'backend;dur=1234.5, odds;dur=950.0, sql_count;desc="7 queries"';
    globalThis.fetch = async () => Response.json({ holdings: [], asOf: null }, { headers: { 'Server-Timing': timing } });
    const result = await proxyApi(new Request('http://localhost:3000/api/moves'));
    assert.equal(result.headers.get('server-timing'), timing);
    assert.equal(result.headers.get('cache-control'), 'no-store');
});

it('forwards an explicit earnings refresh to the authenticated backend', async () => {
    globalThis.fetch = async (_url, options) => {
        assert.equal(new Headers(options?.headers).get('X-Hedgehog-Refresh'), '1');
        return Response.json({ companies: [], holdings: 0, asOf: null });
    };
    const response = await proxyApi(new Request('http://localhost:3000/api/earnings', { headers: { 'X-Hedgehog-Refresh': '1' } }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
});
