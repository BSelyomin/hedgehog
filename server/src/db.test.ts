import { it } from 'vitest';
import assert from 'node:assert/strict';
import { pool, query } from './db.ts';

it('identifies a timed-out operation without logging SQL, values or errors, and makes one attempt', async () => {
    const originalQuery = pool.query, originalWarn = console.warn;
    const logs: unknown[][] = [];
    const error = Object.assign(new Error('private connection-string and portfolio information'), { code: '57014' });
    let attempts = 0;
    pool.query = (async () => { attempts++; throw error; }) as typeof pool.query;
    console.warn = (...args: unknown[]) => { logs.push(args); };
    try {
        await assert.rejects(query('SELECT private_sql', ['private-account-id'], 'exposure_quotes'), value => value === error);
        assert.equal(attempts, 1); assert.equal(logs.length, 1);
        assert.equal(logs[0][0], '[Database] query_failed');
        const diagnostic = logs[0][1] as Record<string, unknown>;
        assert.equal(diagnostic.operation, 'exposure_quotes'); assert.equal(diagnostic.code, '57014');
        assert.ok(typeof diagnostic.elapsedMs === 'number' && diagnostic.elapsedMs >= 0);
        assert.equal(diagnostic.totalConnections, pool.totalCount);
        assert.equal(diagnostic.idleConnections, pool.idleCount);
        assert.equal(diagnostic.waitingRequests, pool.waitingCount);
        assert.ok(!JSON.stringify(logs).includes('private'));
    } finally { pool.query = originalQuery; console.warn = originalWarn; }
});

it('logs safe connection classifications and leaves successful reads quiet', async () => {
    const originalQuery = pool.query, originalWarn = console.warn;
    const logs: unknown[][] = [];
    console.warn = (...args: unknown[]) => { logs.push(args); };
    try {
        for (const code of ['ETIMEDOUT', 'private://credentials']) {
            pool.query = (async () => { throw { code }; }) as typeof pool.query;
            await assert.rejects(query('SELECT private_sql'));
        }
        assert.equal((logs[0][1] as { code: string }).code, 'ETIMEDOUT');
        assert.equal((logs[1][1] as { code: string }).code, 'UNAVAILABLE');
        assert.ok(!JSON.stringify(logs).includes('private'));
        pool.query = (async () => ({ rows: [{ ok: true }] })) as unknown as typeof pool.query;
        assert.deepEqual(await query('SELECT true AS ok'), [{ ok: true }]);
        assert.equal(logs.length, 2);
    } finally { pool.query = originalQuery; console.warn = originalWarn; }
});
