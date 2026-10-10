import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool, aiPool } from '../db.ts';
import { cachedAI, readAI, contentHash } from './ai-cache.ts';
import { cortexJson, cortexResult, searchSources } from './snowflake.ts';
import { portfolioRevision } from './holdings.ts';
import { checkedSummary } from '../jobs/summaries.ts';

const originalQuery = pool.query, originalConnect = aiPool.connect, originalFetch = globalThis.fetch;
const names = ['SNOWFLAKE_ACCOUNT_URL', 'SNOWFLAKE_PAT', 'SNOWFLAKE_CORTEX_MODEL',
    'SNOWFLAKE_SEARCH_DATABASE', 'SNOWFLAKE_SEARCH_SCHEMA', 'SNOWFLAKE_SEARCH_SERVICE'];
const originalEnv = names.map(name => process.env[name]);
const records = new Map<string, { value: unknown; created_at: Date }>();
let writes = 0, requests = 0, generatedText = 'Odds are 38%.';
const schema = { type: 'object', properties: { text: { type: 'string' }, sourceIds: { type: 'array', items: { type: 'string' } } }, required: ['text', 'sourceIds'] };
const passages = [{ id: 'source-0', title: 'Reporting', text: 'Oil reporting', url: 'https://news.example/report' }];

beforeEach(() => {
    records.clear(); writes = 0; requests = 0; generatedText = 'Odds are 38%.';
    names.forEach(name => { process.env[name] = 'test'; });
    process.env.SNOWFLAKE_ACCOUNT_URL = 'https://test.snowflakecomputing.com';
    const execute = async (sql: string, values: unknown[] = []) => {
        const key = `${values[0]}:${values[1]}`;
        let rows: unknown[] = [];
        if (sql.startsWith('SELECT value,created_at')) rows = records.has(key) ? [records.get(key)] : [];
        if (sql.startsWith('INSERT INTO ai_cache')) {
            const value: unknown = JSON.parse(String(values[2]));
            const old = records.get(key);
            if (!old || contentHash(old.value) !== contentHash(value)) {
                const row = { value, created_at: new Date(Date.UTC(2026, 9, 9, 12, 0, writes++)) };
                records.set(key, row); rows = [row];
            }
        }
        return { rows, rowCount: rows.length };
    };
    pool.query = execute as typeof pool.query;
    aiPool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof aiPool.connect;
    globalThis.fetch = async () => {
        requests++;
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: generatedText, sourceIds: ['source-0'] }) } }] });
    };
});
afterEach(() => {
    pool.query = originalQuery; aiPool.connect = originalConnect; globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (originalEnv[i] === undefined) delete process.env[name]; else process.env[name] = originalEnv[i]; });
});

it('canonicalizes object keys without discarding meaningful array order', () => {
    assert.equal(contentHash({ a: 1, b: { c: 2, d: 3 } }), contentHash({ b: { d: 3, c: 2 }, a: 1 }));
    assert.notEqual(contentHash([1, 2]), contentHash([2, 1]));
});
it('ignores portfolio timestamps and row ordering, but tracks values, sources and sandbox mode', () => {
    const holdings = [{ symbol: 'AAPL', valueUsd: 100 }, { symbol: 'MSFT', valueUsd: 200 }];
    const p = { holdings, manualHoldings: holdings, brokerageHoldings: [], sandbox: false, asOf: '2026-10-01' };
    const key = portfolioRevision(p);
    assert.equal(key, portfolioRevision({ ...p, holdings: [...holdings].reverse(), manualHoldings: [...holdings].reverse(), asOf: '2026-10-09' }));
    assert.notEqual(key, portfolioRevision({ ...p, holdings: [{ symbol: 'AAPL', valueUsd: 101 }] }));
    assert.notEqual(key, portfolioRevision({ ...p, sandbox: true }));
    assert.notEqual(key, portfolioRevision({ ...p, manualHoldings: [], brokerageHoldings: holdings }));
});
it('reads persisted entries without a TTL and preserves their original timestamp', async () => {
    const key = { portfolio: 'A' };
    const old = { value: { text: 'Saved snapshot' }, created_at: new Date('2020-01-01') };
    records.set(`voice:${contentHash(key)}`, old);
    let calls = 0;
    const result = await cachedAI('voice', key, async () => { calls++; return { text: 'New' }; });
    assert.equal(calls, 0); assert.equal(writes, 0);
    assert.deepEqual(result, { value: old.value, createdAt: old.created_at.toISOString() });
});
it('regenerates for changed inputs and reuses a previously seen portfolio', async () => {
    let calls = 0;
    const produce = async () => ({ generation: ++calls });
    const a = await cachedAI('voice', { user: 'a', value: 100 }, produce);
    await cachedAI('voice', { user: 'a', value: 200 }, produce);
    assert.deepEqual(await cachedAI('voice', { user: 'a', value: 100 }, produce), a);
    assert.equal(calls, 2);
});
it('coalesces concurrent identical requests into one provider call', async () => {
    let calls = 0;
    const produce = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return { text: 'One' }; };
    const entries = await Promise.all(Array.from({ length: 10 }, () => cachedAI('voice', 'same', produce)));
    assert.equal(calls, 1); assert.equal(writes, 1);
    entries.forEach(e => assert.deepEqual(e, entries[0]));
});
it('does not cache failed calls or leave a failed promise blocking retries', async () => {
    await assert.rejects(cachedAI('voice', 'same', async () => { throw new Error('Provider offline'); }), /offline/);
    assert.equal(await readAI('voice', 'same'), null);
    const result = await cachedAI('voice', 'same', async () => 'Recovered');
    assert.equal(result.value, 'Recovered');
});
it('keeps source refresh timestamps stable unless retrieved content changes', async () => {
    const first = await cachedAI('search', 'query', async () => ['A']);
    assert.deepEqual(await cachedAI('search', 'query', async () => ['A'], true), first);
    const changed = await cachedAI('search', 'query', async () => ['B'], true);
    assert.notEqual(changed.createdAt, first.createdAt);
    await assert.rejects(cachedAI('search', 'query', async () => { throw new Error('Offline'); }, true));
    assert.deepEqual(await readAI('search', 'query'), changed);
});
it('isolates private snapshots by user identity', async () => {
    await cachedAI('briefing', { session: 'user:a', portfolio: 'same' }, async () => 'Private A');
    assert.equal(await readAI('briefing', { session: 'user:b', portfolio: 'same' }), null);
});
it('caches Cortex completions and invalidates when input data or model changes', async () => {
    const first = await cortexJson('Explain', { holdings: ['AAPL'] }, schema);
    assert.deepEqual(await cortexJson('Explain', { holdings: ['AAPL'] }, schema), first);
    assert.equal(requests, 1);
    await cortexJson('Explain', { holdings: ['MSFT'] }, schema);
    process.env.SNOWFLAKE_CORTEX_MODEL = 'changed-model';
    await cortexJson('Explain', { holdings: ['MSFT'] }, schema);
    assert.equal(requests, 3);
});
it('keeps original summary numbers when only Kalshi odds and timestamps change', async () => {
    const event = { ticker: 'OIL', title: 'Oil event' }, identity = { event, passages };
    const firstInput = { marketData: { event, markets: [{ probability: 38, ts: '2026-10-01' }] }, passages };
    const first = await cortexResult('Explain', firstInput, schema, identity,
        result => checkedSummary(result, firstInput.marketData, passages) !== null);
    const nextInput = { marketData: { event, markets: [{ probability: 72, ts: '2026-10-09' }] }, passages };
    const next = await cortexResult('Explain', nextInput, schema, identity,
        result => checkedSummary(result, nextInput.marketData, passages) !== null);
    assert.deepEqual(next, first); assert.equal(requests, 1);
    assert.ok(checkedSummary(next.value.result, firstInput.marketData, passages));
    assert.equal(checkedSummary(next.value.result, nextInput.marketData, passages), null);
    generatedText = 'Odds are 72%.';
    await cortexResult('Explain', nextInput, schema, { event, passages: [{ ...passages[0], text: 'Updated reporting' }] });
    assert.equal(requests, 2);
});
it('does not cache malformed or ungrounded completions', async () => {
    generatedText = 'Unsupported 99%.';
    for (let i = 0; i < 2; i++) await assert.rejects(cortexResult('Explain', { probability: 38 }, schema, 'same',
        result => checkedSummary(result, { probability: 38 }, passages) !== null));
    assert.equal(requests, 2); assert.equal(records.size, 0);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"text":42}' } }] });
    await assert.rejects(cortexJson('Explain', {}, schema));
    assert.equal(records.size, 0);
});
it('caches Cortex Search until an explicit reload checks for changed reporting', async () => {
    let text = 'Original reporting';
    globalThis.fetch = async () => { requests++; return Response.json({ results: [{ TITLE: 'Report', URL: 'https://news.example/report', TEXT: text }] }); };
    const first = await searchSources('Oil');
    text = 'New reporting';
    assert.deepEqual(await searchSources('Oil'), first); assert.equal(requests, 1);
    assert.equal((await searchSources('Oil', true))[0].text, text); assert.equal(requests, 2);
    assert.equal((await searchSources('Oil'))[0].text, text); assert.equal(requests, 2);
});

it('does not change search content or timestamps when only source ranking changes', async () => {
    const rows = [{ TITLE: 'A', URL: 'https://news.example/a', TEXT: 'First source' },
        { TITLE: 'B', URL: 'https://news.example/b', TEXT: 'Second source' }];
    globalThis.fetch = async () => Response.json({ results: rows });
    const first = await searchSources('Oil');
    const timestamp = [...records.values()][0].created_at;
    rows.reverse();
    assert.deepEqual(await searchSources('Oil', true), first);
    assert.deepEqual([...records.values()][0].created_at, timestamp);
    assert.equal(writes, 1);
});
it('uses a separate connection pool for long-running AI generation', async () => {
    const connect = pool.connect;
    pool.connect = (async () => { throw new Error('Page-read pool must not be acquired by AI'); }) as typeof pool.connect;
    try {
        assert.equal((await cachedAI('isolation', 'input', async () => 'Generated')).value, 'Generated');
    } finally { pool.connect = connect; }
});

it('invalidates a portfolio snapshot for added, removed or revalued stocks, not row order or sync time', async () => {
    const a = { symbol: 'AAPL', valueUsd: 100 }, b = { symbol: 'MSFT', valueUsd: 200 };
    let generations = 0;
    const snapshot = (holdings: typeof a[], asOf = '2026-10-01') => cachedAI('portfolio-test', {
        session: 'owner', portfolio: portfolioRevision({ holdings, manualHoldings: holdings, brokerageHoldings: [], sandbox: false, asOf })
    }, async () => ({ generation: ++generations }));
    const original = await snapshot([a]);
    await snapshot([a, b]);
    await snapshot([b, a], '2026-10-10');
    assert.equal(generations, 2);
    await snapshot([b]);
    await snapshot([{ ...b, valueUsd: 201 }]);
    assert.equal(generations, 4);
    assert.deepEqual(await snapshot([a], '2026-10-10'), original);
    assert.equal(generations, 4);
});
