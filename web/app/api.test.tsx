import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { api, readApiResponse, setSessionKey } from '../lib/api-client';
import { proxyApi } from '../lib/api-proxy';
const originalFetch = globalThis.fetch, originalUrl = process.env.API_INTERNAL_URL;
beforeEach(() => { process.env.API_INTERNAL_URL = 'http://backend:4000'; });
afterEach(() => { globalThis.fetch = originalFetch; if (originalUrl === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = originalUrl; });

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
