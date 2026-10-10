import { beforeEach, afterEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { pool } from '../db.ts';
import { getHoldings, portfolioRevision, saveHoldings } from './holdings.ts';
import type { AssetType, HoldingDetails } from '../../../shared/types.ts';

const originalQuery = pool.query, originalConnect = pool.connect;
const envNames = ['SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY', 'SNAPTRADE_ENCRYPTION_KEY', 'SNAPTRADE_MODE', 'APP_URL'] as const;
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
type Row = { symbol: string; value_usd: string; updated_at: Date; asset_type?: AssetType; details?: HoldingDetails };
let manual: Row[], imported: Row[];
const writes: { sql: string; values: unknown[] }[] = [];
beforeEach(() => {
    Object.assign(process.env, { SNAPTRADE_CLIENT_ID: 'merge-test', SNAPTRADE_CONSUMER_KEY: 'test',
        SNAPTRADE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), SNAPTRADE_MODE: 'sandbox', APP_URL: 'http://localhost:3000' });
    writes.length = 0;
    const updated_at = new Date('2026-10-09T20:00:00Z');
    manual = [{ symbol: 'AAPL', value_usd: '100', updated_at },
        { symbol: 'HOME', value_usd: '400000', updated_at, asset_type: 'property', details: { state: 'California', adjustableMortgage: 200000 } }];
    imported = [{ symbol: 'AAPL', value_usd: '50', updated_at }, { symbol: 'MSFT', value_usd: '20', updated_at }];
    const execute = async (sql: string, values: unknown[] = []) => {
        let rows: Row[] = [];
        if (sql.includes('SELECT * FROM holdings')) rows = manual;
        if (sql.includes('FROM brokerage_holdings')) rows = imported;
        if (sql.startsWith('DELETE FROM holdings')) { manual = []; writes.push({ sql, values }); }
        if (sql.startsWith('INSERT INTO holdings')) {
            manual.push({ symbol: String(values[1]), value_usd: String(values[2]), updated_at: new Date(), asset_type: values[3] as AssetType, details: JSON.parse(String(values[4])) });
            writes.push({ sql, values });
        }
        return { rows, rowCount: rows.length };
    };
    pool.query = execute as typeof pool.query;
    pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
});
afterEach(() => {
    pool.query = originalQuery; pool.connect = originalConnect;
    for (const name of envNames) {
        if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name];
    }
});

it('combines brokerage securities while retaining manual asset types and terms', async () => {
    const result = await getHoldings('user:test');
    assert.deepEqual(result.holdings, [{ symbol: 'AAPL', valueUsd: 150 },
        { symbol: 'HOME', valueUsd: 400000, assetType: 'property', details: { state: 'California', adjustableMortgage: 200000 } },
        { symbol: 'MSFT', valueUsd: 20 }]);
    assert.equal(result.manualHoldings[0].valueUsd, 100);
    assert.equal(result.brokerageHoldings[0].valueUsd, 50);
    assert.equal(result.sandbox, true);
});
it('saves and clears only manual holdings, preserving imported positions and asset terms', async () => {
    let result = await saveHoldings('user:test', [{ symbol: 'HOME', valueUsd: 500000, assetType: 'property', details: { state: 'Florida' } }]);
    assert.equal(result.holdings.find(h => h.symbol === 'AAPL')?.valueUsd, 50);
    assert.deepEqual(result.holdings.find(h => h.symbol === 'HOME')?.details, { state: 'Florida' });
    assert.ok(writes.every(write => !write.sql.includes('brokerage')));
    result = await saveHoldings('user:test', []);
    assert.deepEqual(result.manualHoldings, []);
    assert.deepEqual(result.holdings, [{ symbol: 'AAPL', valueUsd: 50 }, { symbol: 'MSFT', valueUsd: 20 }]);
});
it('invalidates cached AI for changed asset terms but not source timestamps', async () => {
    const first = portfolioRevision(await getHoldings('user:test'));
    manual.forEach(row => { row.updated_at = new Date('2026-10-10'); });
    imported.forEach(row => { row.updated_at = new Date('2026-10-10'); });
    assert.equal(portfolioRevision(await getHoldings('user:test')), first);
    manual[1].details!.adjustableMortgage = 250000;
    assert.notEqual(portfolioRevision(await getHoldings('user:test')), first);
});
