import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { prices, yahoo } from './prices.ts';
import { measure } from './measure.ts';
import { completedPriceDate } from '../services/price-date.ts';

const mutableYahoo = yahoo as unknown as { chart: typeof yahoo.chart };
const originalQuery = pool.query, originalChart = yahoo.chart, originalFetch = globalThis.fetch;
const originalFred = process.env.FRED_API_KEY;
afterEach(() => {
    pool.query = originalQuery; mutableYahoo.chart = originalChart; globalThis.fetch = originalFetch;
    if (originalFred === undefined) delete process.env.FRED_API_KEY; else process.env.FRED_API_KEY = originalFred;
});
beforeEach(() => { delete process.env.FRED_API_KEY; });

it('refreshes stored price history, bootstraps new holdings, and excludes incomplete candles', async () => {
    const cutoff = completedPriceDate(), future = new Date(Date.parse(cutoff) + 86400000);
    const written: unknown[][] = [], requested: { symbol: string; period1: Date }[] = [];
    pool.query = (async (sql: string, args: unknown[] = []) => {
        if (sql.includes('SELECT DISTINCT symbol')) return { rows: [{ symbol: 'NEW' }] };
        if (sql.includes('min(ts) AS first')) return { rows: [{ symbol: 'SPY', first: new Date('2010-01-01'), last: new Date(cutoff) }] };
        if (sql.includes('INSERT INTO prices')) written.push(args);
        return { rows: [] };
    }) as typeof pool.query;
    mutableYahoo.chart = (async (symbol: string, options: { period1: Date }) => {
        requested.push({ symbol, period1: options.period1 });
        return { quotes: [{ date: new Date(cutoff), close: 100 }, { date: future, close: 999 }] };
    }) as typeof yahoo.chart;
    await prices();
    assert.equal(requested[0].symbol, 'SPY');
    assert.equal(requested[0].period1.getTime(), Date.parse(cutoff) - 7 * 86400000);
    assert.ok(requested.find(r => r.symbol === 'NEW')!.period1.getTime() < Date.parse(cutoff) - 9 * 365 * 86400000);
    assert.ok(written.length > 0);
    written.forEach(args => { assert.deepEqual(args[1], [cutoff]); assert.deepEqual(args[2], [100]); });
});
it('allows measurement to continue when the optional FRED provider fails', async () => {
    process.env.FRED_API_KEY = 'test-key';
    pool.query = (async () => ({ rows: [] })) as unknown as typeof pool.query;
    mutableYahoo.chart = (async () => ({ quotes: [] })) as unknown as typeof yahoo.chart;
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    await assert.doesNotReject(prices());
});
it('persists the last aligned price date with a measured beta even when the job runs later', async () => {
    let stock = 200, spy = 100;
    const stockRows: { ts: Date; close: number }[] = [], spyRows: typeof stockRows = [];
    for (let i = 0; i <= 100; i++) {
        const ts = new Date(Date.parse('2026-10-09') - (100 - i) * 86400000);
        const change = Math.sin(i * 1.7) * .01;
        stock *= 1 + 1.5 * change; spy *= 1 + change;
        stockRows.push({ ts, close: stock }); spyRows.push({ ts, close: spy });
    }
    const measurements: unknown[][] = [];
    pool.query = (async (sql: string, args: unknown[] = []) => {
        if (sql.includes('SELECT DISTINCT symbol')) return { rows: [{ symbol: 'AAPL' }] };
        if (sql.includes('SELECT ts,close')) {
            assert.ok(sql.includes('ts < (($3::date+1)'), 'Measurement must exclude incomplete/future prices');
            return { rows: args[0] === 'SPY' ? spyRows : args[0] === 'AAPL' ? stockRows : [] };
        }
        if (sql.includes('INSERT INTO measured_links')) measurements.push(args);
        return { rows: [] };
    }) as typeof pool.query;
    await measure();
    const beta = measurements.find(args => args[1] === 'SPY')!;
    assert.ok(beta);
    assert.ok(Math.abs(Number(beta[2]) - 1.5) < 1e-8);
    assert.equal(beta[6], 100);
    assert.equal(beta[7], true);
    assert.equal(beta[8], '2026-10-09');
});
