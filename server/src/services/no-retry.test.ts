import { it } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { runWithoutRetry } from './no-retry.ts';
import { runJob } from '../jobs/scheduler.ts';
import { kalshi } from './kalshi.ts';
import { snaptrade } from '../brokerages/client.ts';

it('Kalshi and SnapTrade make exactly one HTTP attempt for rate limits and provider failures', async () => {
    const fetch = globalThis.fetch;
    const names = ['SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY', 'SNAPTRADE_ENCRYPTION_KEY', 'SNAPTRADE_MODE', 'APP_URL'];
    const previous = names.map(name => process.env[name]);
    Object.assign(process.env, { SNAPTRADE_CLIENT_ID: 'test-client', SNAPTRADE_CONSUMER_KEY: 'test-secret',
        SNAPTRADE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), SNAPTRADE_MODE: 'sandbox', APP_URL: 'http://localhost:3000' });
    try {
        for (const status of [429, 503]) {
            let calls = 0;
            globalThis.fetch = async () => { calls++; return new Response('untrusted error', { status }); };
            await assert.rejects(kalshi('/events'), /automatic retries are disabled/); assert.equal(calls, 1);
            calls = 0; await assert.rejects(snaptrade('GET', '/accounts')); assert.equal(calls, 1);
        }
    } finally {
        globalThis.fetch = fetch;
        names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
    }
});

it('persists failed background tasks without storing the raw error and keeps them stopped after module restart', async () => {
    const query = pool.query, rows = new Set<string>(); let calls = 0;
    pool.query = (async (sql: string, args: string[]) => {
        if (sql.startsWith('INSERT')) rows.add(args[0]);
        return { rows: sql.startsWith('SELECT') && rows.has(args[0]) ? [{ name: args[0] }] : [], rowCount: 0 };
    }) as typeof pool.query;
    try {
        const fail = async () => { calls++; throw new Error('private provider content'); };
        await assert.rejects(runWithoutRetry('test-task', fail));
        assert.equal(await runWithoutRetry('test-task', fail), undefined); assert.equal(calls, 1);
        const modulePath = './no-retry.ts?test-restart';
        const restarted = await import(modulePath);
        assert.equal(await restarted.runWithoutRetry('test-task', fail), undefined); assert.equal(calls, 1);
        assert.deepEqual([...rows], ['stopped-task:test-task']);
        let release!: () => void;
        const task = async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return 7; };
        const first = runWithoutRetry('coalesced-task', task), second = runWithoutRetry('coalesced-task', task);
        await new Promise<void>(resolve => setImmediate(resolve)); release();
        assert.deepEqual(await Promise.all([first, second]), [7, 7]); assert.equal(calls, 2);
    } finally { pool.query = query; }
});

it('stops a failed scheduled job across subsequent schedules and a module restart', async () => {
    const query = pool.query, connect = pool.connect, rows = new Set<string>(); let attempts = 0, released = 0;
    pool.query = (async (sql: string, args: string[]) => {
        if (sql.startsWith('INSERT')) rows.add(args[0]);
        return { rows: sql.startsWith('SELECT') && rows.has(args[0]) ? [{ name: args[0] }] : [] };
    }) as typeof pool.query;
    pool.connect = (async () => ({ query: async () => ({ rows: [{ locked: true }] }), release() { released++; } })) as unknown as typeof pool.connect;
    try {
        const fail = async () => { attempts++; throw new Error('failed'); };
        await runJob('failed-schedule', fail); await runJob('failed-schedule', fail);
        const modulePath = '../jobs/scheduler.ts?test-restart';
        const restarted = await import(modulePath); await restarted.runJob('failed-schedule', fail);
        assert.equal(attempts, 1); assert.equal(released, 1); assert.ok(rows.has('stopped-job:failed-schedule'));
        // Explicit acknowledgement clears the durable marker; a backend restart
        // also clears its in-memory stopped state before ordinary schedules resume.
        rows.delete('stopped-job:failed-schedule');
        const resumedPath = '../jobs/scheduler.ts?test-manual-resume';
        const resumed = await import(resumedPath);
        await resumed.runJob('failed-schedule', async () => { attempts++; });
        assert.equal(attempts, 2); assert.equal(released, 2);
    } finally { pool.query = query; pool.connect = connect; }
});
