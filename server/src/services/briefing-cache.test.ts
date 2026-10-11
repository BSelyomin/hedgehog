import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { cachedBriefingResponse } from './briefing-cache.ts';

const originalQuery = pool.query, originalNow = Date.now;
const names = ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'];
let env: (string | undefined)[], caseNumber = 0, owner: string, now: number, value: number;
let snapshot: { value: { date: string; text: string; audio: string | null; asOf: string }; created_at: Date } | null;
let fail: boolean, authenticated: boolean, pause: (() => Promise<void>) | undefined;
const calls: string[] = [];
const reads = () => calls.filter(sql => sql.includes('FROM ai_cache')).length;
beforeEach(() => {
    owner = `50000000-0000-0000-0000-${String(++caseNumber).padStart(12, '0')}`;
    now = Date.parse('2026-10-10T16:00:00Z'); Date.now = () => now;
    value = 1000; fail = false; authenticated = true; pause = undefined; calls.length = 0;
    env = names.map(name => process.env[name]); names.forEach(name => { delete process.env[name]; });
    snapshot = { value: { date: '2026-10-10', text: 'Saved source-checked briefing.', audio: 'AQID', asOf: '2026-10-09T20:00:00Z' }, created_at: new Date('2026-10-10T12:00:00Z') };
    pool.query = (async (sql: string) => {
        calls.push(sql); let rows: unknown[] = [];
        if (sql.includes('FROM auth_sessions')) rows = authenticated ? [{ id: owner, email: 'cache@example.test', name: 'Cache tester', created_at: new Date(now), expires_at: new Date('2099-01-01') }] : [];
        else if (sql.includes('SELECT * FROM holdings')) rows = [{ symbol: 'AAPL', value_usd: String(value), updated_at: new Date('2026-10-01') }];
        else if (sql.includes('FROM ai_cache')) {
            const captured = snapshot, failed = fail;
            await pause?.();
            if (failed) throw new Error('Briefing database read failed');
            rows = captured ? [captured] : [];
        }
        return { rows, rowCount: rows.length };
    }) as typeof pool.query;
});
afterEach(() => {
    pool.query = originalQuery; Date.now = originalNow;
    names.forEach((name, i) => { if (env[i] === undefined) delete process.env[name]; else process.env[name] = env[i]; });
});

it('caches all three Overview reads across F5 with original source times and private HTTP responses', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    const paths = ['/exposure', '/calendar?days=14', '/briefing'];
    const first = await Promise.all(paths.map(path => request(app, path, { headers })));
    assert.ok(first.every(result => result.status === 200));
    assert.equal(calls.filter(sql => sql.includes('SELECT m.*')).length, 1);
    assert.equal(reads(), 1);
    assert.equal(first[2].body.generatedAt, '2026-10-10T12:00:00.000Z');
    assert.equal(first[2].body.asOf, '2026-10-09T20:00:00Z');
    assert.equal(first[2].body.audioUrl, '/api/briefing/audio?v=2026-10-10T12%3A00%3A00.000Z');
    assert.equal(first[2].body.audio, undefined);
    calls.length = 0;
    const warm = await Promise.all(paths.map(path => request(app, path, { headers })));
    assert.deepEqual(warm.map(result => result.body), first.map(result => result.body));
    assert.equal(calls.length, 3); assert.equal(reads(), 0);
    assert.match(String(warm[0].headers['server-timing']), /exposure_cache_hit/);
    assert.match(String(warm[1].headers['server-timing']), /exposure_cache_hit/);
    assert.match(String(warm[2].headers['server-timing']), /briefing_cache_hit/);
    assert.equal(warm[2].headers['cache-control'], 'no-store');
});

it('checks current holding contents and keeps owners isolated without relying on update timestamps', async () => {
    await cachedBriefingResponse(owner); await cachedBriefingResponse(owner); assert.equal(reads(), 1);
    value = 2000; await cachedBriefingResponse(owner); assert.equal(reads(), 2);
    await cachedBriefingResponse(`${owner}-other`); assert.equal(reads(), 3);
});

it('rechecks auth before serving a cached private briefing', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}; hedgehog_auth=${'b'.repeat(64)}` };
    assert.equal((await request(app, '/briefing', { headers })).status, 200);
    assert.equal((await request(app, '/briefing', { headers })).status, 200);
    assert.equal(calls.filter(sql => sql.includes('FROM auth_sessions')).length, 2); assert.equal(reads(), 1);
    authenticated = false;
    assert.equal((await request(app, '/briefing', { headers })).status, 401); assert.equal(reads(), 1);
});

it('reloads metadata on the refresh header without regenerating or writing AI/audio', async () => {
    const app = createApp(), headers = { cookie: `hedgehog_session=${owner}` };
    const first = await request(app, '/briefing', { headers });
    snapshot = { ...snapshot!, value: { ...snapshot!.value, text: 'Updated saved snapshot.' }, created_at: new Date(now) };
    assert.deepEqual((await request(app, '/briefing', { headers })).body, first.body);
    const fresh = await request(app, '/briefing', { headers: { ...headers, 'x-hedgehog-refresh': '1' } });
    assert.equal(fresh.body.text, 'Updated saved snapshot.'); assert.equal(reads(), 2);
    assert.deepEqual((await request(app, '/briefing', { headers })).body, fresh.body);
    assert.ok(calls.every(sql => !sql.includes('INSERT') && !sql.includes('DELETE')));
});

it('expires metadata after five minutes and across the New York date or voice configuration boundary', async () => {
    await cachedBriefingResponse(owner);
    now += 299_999; await cachedBriefingResponse(owner); assert.equal(reads(), 1);
    now++; await cachedBriefingResponse(owner); assert.equal(reads(), 2);
    process.env.ELEVENLABS_VOICE_ID = 'other-fixture-voice'; await cachedBriefingResponse(owner); assert.equal(reads(), 3);
    process.env.ELEVENLABS_API_KEY = 'fixture-enabled'; await cachedBriefingResponse(owner); assert.equal(reads(), 4);
    now = Date.parse('2026-10-11T03:59:00Z'); await cachedBriefingResponse(owner);
    now += 60_000; await cachedBriefingResponse(owner); assert.equal(reads(), 6);
});

it('does not retain missing snapshots, so a scheduled briefing appears on the next read', async () => {
    snapshot = null; assert.equal((await cachedBriefingResponse(owner)).text, null);
    snapshot = { value: { date: '2026-10-10', text: 'New scheduled briefing.', audio: null, asOf: '2026-10-09T20:00:00Z' }, created_at: new Date(now) };
    assert.equal((await cachedBriefingResponse(owner)).text, 'New scheduled briefing.');
    await cachedBriefingResponse(owner); assert.equal(reads(), 2);
});

it('coalesces concurrent metadata reads and returns independent snapshots', async () => {
    const [first, second] = await Promise.all([cachedBriefingResponse(owner), cachedBriefingResponse(owner)]);
    assert.equal(reads(), 1); first.text = 'Local edit';
    assert.equal(second.text, 'Saved source-checked briefing.');
    assert.equal((await cachedBriefingResponse(owner)).text, second.text);
});

it('does not cache failures or retry a failed metadata read', async () => {
    fail = true; await assert.rejects(cachedBriefingResponse(owner), /Briefing database/); assert.equal(reads(), 1);
    fail = false; assert.equal((await cachedBriefingResponse(owner)).text, 'Saved source-checked briefing.'); assert.equal(reads(), 2);
});

it('does not let an older response or failure overwrite a refreshed snapshot', async () => {
    for (const shouldFail of [false, true]) {
        const session = `${owner}-${shouldFail}`;
        let release!: () => void, started!: () => void;
        const waiting = new Promise<void>(resolve => { started = resolve; });
        pause = () => { started(); return new Promise<void>(resolve => { release = resolve; }); };
        fail = shouldFail;
        const old = cachedBriefingResponse(session);
        const failure = shouldFail ? assert.rejects(old, /Briefing database/) : undefined;
        await waiting; pause = undefined; fail = false;
        snapshot = { ...snapshot!, value: { ...snapshot!.value, text: `Refreshed ${shouldFail}` } };
        const fresh = await cachedBriefingResponse(session, true);
        release(); if (failure) await failure; else await old;
        assert.deepEqual(await cachedBriefingResponse(session), fresh);
    }
});

it('bounds retained metadata and evicts the least recently used portfolio', async () => {
    await cachedBriefingResponse(owner);
    for (let i = 0; i < 32; i++) await cachedBriefingResponse(`${owner}-${i}`);
    const before = reads(); await cachedBriefingResponse(owner); assert.equal(reads(), before + 1);
});
