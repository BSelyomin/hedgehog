import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { poll } from './poll.ts';

const original = { fetch: globalThis.fetch, connect: pool.connect, query: pool.query, now: Date.now, vercel: process.env.VERCEL };
let cursor = '', clock = 0, failStore = false;
let statements: string[] = [], saved: string[] = [], requests: string[] = [];
let pages: { events: unknown; cursor: string }[] = [];
beforeEach(() => {
    cursor = ''; clock = 0; failStore = false; statements = []; saved = []; requests = []; pages = [];
    process.env.VERCEL = '1'; Date.now = () => clock;
    pool.query = (async (sql: string, values?: string[]) => {
        if (sql.startsWith('SELECT cursor')) return { rows: [{ cursor }] };
        if (sql.startsWith('INSERT INTO job_state')) { cursor = values![1]; saved.push(cursor); }
        return { rows: [] };
    }) as typeof pool.query;
    pool.connect = (async () => ({
        query: async (sql: string) => {
            statements.push(sql);
            if (failStore && sql.startsWith('INSERT INTO markets')) throw new Error('fixture storage failure');
            return { rows: [] };
        },
        release: () => {},
    })) as unknown as typeof pool.connect;
    globalThis.fetch = async url => {
        const parsed = new URL(String(url));
        requests.push(parsed.searchParams.get('cursor') ?? '');
        assert.equal(parsed.searchParams.get('with_nested_markets'), 'true');
        assert.equal(parsed.searchParams.get('status'), 'open');
        const page = pages.shift(); assert.ok(page, 'No fixture page left');
        return Response.json(page);
    };
});
afterEach(() => {
    globalThis.fetch = original.fetch; pool.connect = original.connect; pool.query = original.query; Date.now = original.now;
    if (original.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = original.vercel;
});
it('continues a saved import and clears its cursor only after all pages are committed', async () => {
    cursor = 'saved-page'; pages = [{ events: [], cursor: 'last-page' }, { events: [], cursor: '' }];
    await poll();
    assert.deepEqual(requests, ['saved-page', 'last-page']);
    assert.deepEqual(saved, ['last-page', '']);
    assert.equal(statements.filter(sql => sql === 'COMMIT').length, 2);
});
it('yields with the next page saved when its serverless budget is reached', async () => {
    const read = globalThis.fetch;
    globalThis.fetch = async (...args) => { const result = await read(...args); clock = 300001; return result; };
    pages = [{ events: [], cursor: 'next-page' }];
    await poll();
    assert.deepEqual(requests, ['']); assert.deepEqual(saved, ['next-page']);
    assert.equal(statements.filter(sql => sql === 'COMMIT').length, 1);
});
it('does not acknowledge a page whose database transaction failed', async () => {
    cursor = 'retry-this-page'; failStore = true; pages = [{ events: [], cursor: 'uncommitted-next-page' }];
    await assert.rejects(poll(), /fixture storage failure/);
    assert.equal(cursor, 'retry-this-page'); assert.deepEqual(saved, []);
    assert.ok(statements.includes('ROLLBACK')); assert.ok(!statements.includes('COMMIT'));
});
it('keeps standalone Docker polls independent of the serverless checkpoint', async () => {
    delete process.env.VERCEL; cursor = 'serverless-only';
    pages = [{ events: [], cursor: 'second' }, { events: [], cursor: '' }];
    await poll();
    assert.deepEqual(requests, ['', 'second']); assert.deepEqual(saved, []);
    assert.equal(cursor, 'serverless-only');
});
it('rejects malformed pages without replacing the last saved cursor', async () => {
    cursor = 'original'; pages = [{ events: null, cursor: 'bad-next' }];
    await assert.rejects(poll(), /Invalid events response/);
    assert.equal(cursor, 'original'); assert.deepEqual(saved, []); assert.deepEqual(statements, []);
});
