import { it } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { operationalRequest, type OperationsDependencies } from './operations.ts';
import { schedules, scheduleDue } from '../jobs/schedules.ts';

const secret = 'fixture-secret-at-least-sixteen';
const input = (path: string, method = 'GET') => ({ path, method, secret, authorization: `Bearer ${secret}` });
function fixture() {
    const calls: string[] = [], tasks: Promise<unknown>[] = [];
    const deps: OperationsDependencies = {
        jobs: ['poll', 'nightly', 'bootstrap', 'odds-candles-daily'],
        run: async name => { calls.push(`run:${name}`); },
        resume: async name => { calls.push(`resume:${name}`); },
        migrate: async () => { calls.push('migrate'); },
        status: async () => { calls.push('status'); return { pendingMigrations: [], readOnly: false }; },
        background: task => { tasks.push(task); },
    };
    return { deps, calls, tasks };
}
it('rejects missing, short and incorrect secrets before any database or background work', async () => {
    const { deps, calls, tasks } = fixture();
    for (const path of ['/jobs/poll', '/migrate', '/resume/nightly', '/status']) {
        for (const value of [undefined, '', 'short'])
            assert.equal((await operationalRequest({ ...input(path), secret: value }, deps)).status, 503);
        for (const authorization of [undefined, 'wrong', `Bearer ${secret}extra`, `bearer ${secret}`])
            assert.equal((await operationalRequest({ ...input(path), authorization }, deps)).status, 401);
    }
    assert.deepEqual(calls, []); assert.deepEqual(tasks, []);
});
it('retains scheduled work after responding and performs only one invocation', async () => {
    const { deps, calls, tasks } = fixture();
    let finish = () => {};
    deps.run = async name => { calls.push(name); await new Promise<void>(resolve => { finish = resolve; }); };
    const result = await operationalRequest(input('/jobs/poll'), deps);
    assert.equal(result.status, 202); assert.equal((result.body as { status: string }).status, 'accepted');
    assert.deepEqual(calls, ['poll']); assert.equal(tasks.length, 1);
    finish(); await Promise.all(tasks);
    assert.deepEqual(calls, ['poll']);
});
it('rejects HEAD, POST cron dispatches and GET migrations without starting jobs', async () => {
    const { deps, calls } = fixture();
    for (const method of ['HEAD', 'POST', 'DELETE', 'OPTIONS']) {
        const result = await operationalRequest(input('/jobs/poll', method), deps);
        assert.equal(result.status, 405); assert.equal(result.allow, 'GET');
    }
    assert.equal((await operationalRequest(input('/migrate'), deps)).status, 405);
    assert.equal((await operationalRequest(input('/resume/poll'), deps)).status, 405);
    assert.deepEqual(calls, []);
});
it('does not retry failed background work or expose its error payload in logs', async () => {
    const { deps, calls, tasks } = fixture();
    deps.run = async name => { calls.push(name); throw new Error('private-provider-error-payload'); };
    const originalWarn = console.warn, warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
        assert.equal((await operationalRequest(input('/jobs/poll'), deps)).status, 202);
        await Promise.all(tasks);
        assert.deepEqual(calls, ['poll']);
        assert.equal(warnings.length, 1);
        assert.ok(!JSON.stringify(warnings).includes('private-provider-error-payload'));
    } finally { console.warn = originalWarn; }
});
it('rejects unknown jobs and prototype-like names and permits explicit bootstrap only', async () => {
    const { deps, calls, tasks } = fixture();
    for (const name of ['constructor', '__proto__', 'no-such-job'])
        assert.equal((await operationalRequest(input(`/jobs/${name}`), deps)).status, 404);
    assert.equal((await operationalRequest(input('/jobs/bootstrap'), deps)).status, 202);
    await Promise.all(tasks); assert.deepEqual(calls, ['run:bootstrap']);
});
it('keeps daily jobs at their New York hour during standard and daylight time', () => {
    const nightly = schedules.find(s => s.id === 'nightly')!;
    assert.equal(scheduleDue(nightly, new Date('2026-01-12T03:30:00Z')), true);
    assert.equal(scheduleDue(nightly, new Date('2026-01-12T02:30:00Z')), false);
    assert.equal(scheduleDue(nightly, new Date('2026-07-12T02:30:00Z')), true);
    assert.equal(scheduleDue(nightly, new Date('2026-07-12T03:30:00Z')), false);
    const candles = schedules.find(s => s.id === 'odds-candles-daily')!;
    assert.equal(scheduleDue(candles, new Date('2026-07-12T04:20:00Z')), true);
    assert.equal(scheduleDue(candles, new Date('2026-01-12T05:20:00Z')), true);
    assert.equal(scheduleDue(candles, new Date('2026-01-12T04:20:00Z')), false);
});
it('skips the extra UTC invocation, with an authenticated force option for manual runs', async () => {
    const { deps, calls, tasks } = fixture();
    const request = { ...input('/jobs/nightly'), at: new Date('2026-07-12T03:30:00Z') };
    assert.equal((await operationalRequest(request, deps)).status, 200);
    assert.deepEqual(calls, []);
    assert.equal((await operationalRequest({ ...request, force: true }, deps)).status, 202);
    await Promise.all(tasks); assert.deepEqual(calls, ['run:nightly']);
});
it('exposes authenticated migration status, retains migrations and resumes only explicitly', async () => {
    const { deps, calls, tasks } = fixture();
    deps.status = async () => ({ pendingMigrations: ['001_initial.sql'], readOnly: true });
    const state = await operationalRequest(input('/status'), deps);
    assert.deepEqual(state.body, { status: 'pending', pendingMigrations: ['001_initial.sql'], readOnly: true, asOf: state.body.asOf });
    assert.equal((await operationalRequest(input('/migrate', 'POST'), deps)).status, 202);
    assert.equal((await operationalRequest(input('/resume/nightly', 'POST'), deps)).status, 200);
    await Promise.all(tasks); assert.deepEqual(calls, ['migrate', 'resume:nightly']);
});
it('matches every deployed cron to its dispatch definition and keeps the backend internal', async () => {
    const config = JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));
    assert.deepEqual(config.crons, schedules.map(s => ({ path: `/api/internal/jobs/${s.id}`, schedule: s.cron })));
    assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: { service: 'web' } }]);
    assert.deepEqual(config.services.web.bindings, [{ type: 'service', service: 'server', format: 'url', env: 'HEDGEHOG_SERVER_URL' }]);
    assert.equal(config.services.server.entrypoint, 'src/server.ts');
    for (const key of ['framework', 'buildCommand', 'installCommand', 'functions', 'outputDirectory'])
        assert.equal(config[key], undefined);
});
