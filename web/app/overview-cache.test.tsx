import { it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExposureResponse, CalendarResponse, BriefingResponse } from '../../shared/types';
import { api, getCachedResponse, setSessionKey } from '../lib/api-client';
import { Overview, reloadOverview } from './screens/overview';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; setSessionKey('reset-after-overview-cache-test'); });

it('renders cached Overview totals, upcoming events and saved briefing immediately on navigation', async () => {
    setSessionKey('overview-navigation'); const paths: string[] = [];
    const categories = { totalValue: 1000, holdings: [], assetClasses: [], themes: [] };
    const exposure: ExposureResponse = { holdings: [{ symbol: 'AAPL', valueUsd: 1000 }], totalValue: 1000, byHolding: [], categories, events: [], asOf: '2026-10-09T20:00:00Z' };
    const calendar: CalendarResponse = { days: 14, categories, events: [], asOf: exposure.asOf };
    const briefing: BriefingResponse = { text: 'Saved source-checked briefing.', date: '2026-10-10', generatedAt: '2026-10-10T12:00:00Z', asOf: exposure.asOf, audioUrl: '/api/briefing/audio?v=stored' };
    globalThis.fetch = async url => {
        const path = String(url); paths.push(path);
        return Response.json(path === '/api/exposure' ? exposure : path.startsWith('/api/calendar') ? calendar : briefing);
    };
    for (const path of ['/exposure', '/calendar?days=14', '/briefing']) await api(path);
    for (let i = 0; i < 2; i++) {
        const html = renderToStaticMarkup(<Overview/>);
        assert.ok(html.includes('$1,000.00') && html.includes('In the next 14 days'));
        assert.ok(html.includes('Saved source-checked briefing.') && html.includes('Cached briefing for your current holdings.'));
        assert.ok(html.includes('/api/briefing/audio?v=stored'));
        assert.ok(!html.includes('Loading your data') && !html.includes('Loading upcoming events'));
    }
    assert.equal(paths.length, 3);
});

it('refreshes exposure once before calendar, refreshes briefing metadata and leaves other pages cached', async () => {
    setSessionKey('overview-reload'); let version = 1;
    const calls: { path: string; refresh: string | null; method: string }[] = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ path: String(url), refresh: new Headers(options?.headers).get('X-Hedgehog-Refresh'), method: options?.method ?? 'GET' });
        return Response.json({ version, asOf: 'stored-source-time', generatedAt: 'original-briefing-time' });
    };
    const paths = ['/exposure', '/calendar?days=14', '/calendar?days=30', '/briefing'];
    for (const path of [...paths, '/forecasts']) await api(path);
    version = 2; calls.length = 0;
    await reloadOverview(() => api('/exposure', { cache: 'reload' }), () => api('/calendar?days=14'), () => api('/briefing', { cache: 'reload' }));
    assert.deepEqual(calls, [
        { path: '/api/exposure', refresh: '1', method: 'GET' },
        { path: '/api/calendar?days=14', refresh: null, method: 'GET' },
        { path: '/api/briefing', refresh: '1', method: 'GET' }
    ]);
    for (const path of ['/exposure', '/calendar?days=14', '/briefing']) assert.equal(getCachedResponse<{ version: number }>(path)?.version, 2);
    assert.equal(getCachedResponse('/calendar?days=30'), null);
    assert.equal(getCachedResponse<{ version: number }>('/forecasts')?.version, 1);
    for (const path of ['/exposure', '/calendar?days=14', '/briefing']) await api(path);
    assert.equal(calls.length, 3);
    assert.equal(getCachedResponse<{ generatedAt: string }>('/briefing')?.generatedAt, 'original-briefing-time');
});

it('waits for exposure to finish and does not retry or refresh sibling data after it fails', async () => {
    setSessionKey('overview-failure'); const calls: string[] = [];
    globalThis.fetch = async url => { calls.push(String(url)); throw new Error('Backend unavailable'); };
    await assert.rejects(reloadOverview(() => api('/exposure', { cache: 'reload' }), () => api('/calendar?days=14'), () => api('/briefing', { cache: 'reload' })), /Backend unavailable/);
    assert.deepEqual(calls, ['/api/exposure']);
    let invoked = 0;
    await reloadOverview(async () => undefined, async () => { invoked++; }, async () => { invoked++; });
    assert.equal(invoked, 0);
});

it('attempts sibling metadata reads only once and never invokes the briefing generator on Overview reload', async () => {
    setSessionKey('overview-detail-failure'); const calls: string[] = [];
    globalThis.fetch = async url => {
        const path = String(url); calls.push(path);
        if (path === '/api/briefing') throw new Error('Briefing unavailable');
        return Response.json({ value: 1 });
    };
    await assert.rejects(reloadOverview(() => api('/exposure', { cache: 'reload' }), () => api('/calendar?days=14'), () => api('/briefing', { cache: 'reload' })), /Briefing unavailable/);
    assert.deepEqual(calls, ['/api/exposure', '/api/calendar?days=14', '/api/briefing']);
    assert.equal(getCachedResponse<{ value: number }>('/calendar?days=14')?.value, 1);
});
