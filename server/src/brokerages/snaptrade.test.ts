import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { request } from '../auth/request-test.ts';
import { digest } from '../auth/session.ts';
import { canonical, configuration, decryptSecret, encryptSecret, signature, snaptrade } from './client.ts';
import { parsePositions, positionValue } from './positions.ts';
import { connect, sync } from './service.ts';

const originalQuery = pool.query, originalConnect = pool.connect, originalFetch = globalThis.fetch;
const variables = ['SNAPTRADE_CLIENT_ID','SNAPTRADE_CONSUMER_KEY','SNAPTRADE_ENCRYPTION_KEY','SNAPTRADE_MODE','APP_URL'];
const previous = variables.map(key => process.env[key]);
const userId = randomUUID(), connectionId = randomUUID(), token = 'b'.repeat(64);
const calls: { sql: string; values: unknown[] }[] = [];
let respond: (sql: string, values: unknown[]) => { rows: Record<string, unknown>[]; rowCount: number };
const result = (rows: Record<string, unknown>[] = []) => ({ rows, rowCount: rows.length });
const account = { id: userId, email: 'alex@example.com', name: 'Alex', created_at: new Date(), expires_at: new Date(Date.now() + 86400000) };
const headers = { cookie: `hedgehog_auth=${token}`, 'x-hedgehog-request':'1', 'x-hedgehog-session':digest(token) };
function configured() {
    process.env.SNAPTRADE_CLIENT_ID = 'commercial-test'; process.env.SNAPTRADE_CONSUMER_KEY = 'test-consumer-key';
    process.env.SNAPTRADE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.SNAPTRADE_MODE = 'sandbox'; process.env.APP_URL = 'http://localhost:3000';
}
function position(overrides: Record<string, unknown> = {}) {
    return { instrument: { kind:'stock',raw_symbol:'AAPL',currency:'USD',exchange:'XNAS' }, units:'2.5', price:'100.25', currency:'USD', cash_equivalent:false, ...overrides };
}
beforeEach(() => {
    for (const key of variables) delete process.env[key];
    calls.length = 0;
    respond = sql => sql.includes('JOIN users') ? result([account]) : sql.includes('auth_rate_limits') ? result([{ attempts:1,retry:900 }]) : sql.includes('pg_try_advisory_lock') ? result([{ locked:true }]) : result();
    const execute = async (sql: string, values: unknown[] = []) => { calls.push({ sql,values }); return respond(sql,values); };
    pool.query = execute as typeof pool.query;
    pool.connect = (async () => ({ query:execute, release() {} })) as unknown as typeof pool.connect;
    globalThis.fetch = async () => { throw new Error('Unexpected provider request'); };
});
afterEach(() => {
    pool.query = originalQuery; pool.connect = originalConnect; globalThis.fetch = originalFetch;
    variables.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
});
it('signs recursively canonical JSON including the exact query and API prefix', () => {
    const body = { z: [{ b:2,a:1 }], a:'value' }, query = 'clientId=TEST&timestamp=1715123456&userSecret=a%2Bb';
    assert.equal(canonical(body), '{"a":"value","z":[{"a":1,"b":2}]}');
    const payload = `{"content":{"a":"value","z":[{"a":1,"b":2}]},"path":"/api/v1/snapTrade/login","query":"${query}"}`;
    assert.equal(signature('/api/v1/snapTrade/login',query,body,'key'), createHmac('sha256','key').update(payload).digest('base64'));
    assert.equal(signature('/api/v1/accounts',query,{},'key'), signature('/api/v1/accounts',query,null,'key'));
});
it('disables incomplete configuration and rejects unsafe callback URLs and modes', () => {
    assert.equal(configuration().configured,false); configured(); assert.equal(configuration().configured,true);
    process.env.APP_URL = 'http://example.com'; assert.equal(configuration().configured,false);
    process.env.APP_URL = 'https://user:password@example.com'; assert.equal(configuration().configured,false);
    process.env.APP_URL = 'https://example.com'; process.env.SNAPTRADE_MODE = 'typo'; assert.equal(configuration().configured,false);
});
it('encrypts provider secrets with authenticated encryption bound to the owner and mode', () => {
    configured(); const owner = `${userId}:sandbox`, secret = 'private-provider-secret';
    const encrypted = encryptSecret(secret,owner);
    assert.ok(!encrypted.includes(secret)); assert.equal(decryptSecret(encrypted,owner),secret);
    assert.notEqual(encrypted,encryptSecret(secret,owner));
    assert.throws(() => decryptSecret(encrypted,`${userId}:live`));
    assert.throws(() => decryptSecret(encrypted,'another-user:sandbox'));
    process.env.SNAPTRADE_ENCRYPTION_KEY = Buffer.alloc(32,8).toString('base64');
    assert.throws(() => decryptSecret(encrypted,owner));
});
it('calculates fractional positions exactly to cents and never substitutes cost basis', () => {
    assert.equal(positionValue('2.5','100.25'),250.63);
    assert.equal(positionValue('0.1','0.05'),0.01);
    assert.equal(positionValue('0','10'),null); assert.equal(positionValue('-1','10'),null);
    assert.equal(positionValue('1','NaN'),null); assert.equal(positionValue('1e4','5'),null);
    const parsed = parsePositions({ results:[position({ cost_basis:'5' })],data_freshness:{ as_of:'2026-01-01T00:00:00Z' } });
    assert.equal(parsed.positions[0].valueUsd,250.63); assert.equal(parsed.asOf,'2026-01-01T00:00:00.000Z');
    assert.equal(parsePositions({ results:[position({ price:null,cost_basis:'250' })] }).positions[0].valueUsd,null);
});
it('excludes shorts, options, cash, foreign listings, unknown tickers and missing currency or prices', () => {
    for (const row of [position({ units:'-2' }),position({ cash_equivalent:true }),position({ currency:'CAD' }),position({ price:null }),
        position({ instrument:{kind:'option',raw_symbol:'CALL'} }),position({ instrument:{kind:'stock',raw_symbol:'AAPL',currency:'USD',exchange:'XTSE'} }),
        position({ instrument:{kind:'stock',raw_symbol:'unsafe:symbol',currency:'USD',exchange:'XNAS'} }),position({ currency:null })]) {
        const parsed = parsePositions({ results:[row] }).positions[0];
        assert.equal(parsed.valueUsd,null); assert.ok(parsed.excludedReason);
    }
    assert.throws(() => parsePositions({ holdings:[] })); assert.throws(() => parsePositions({ results:[{}] }));
    assert.equal(parsePositions({ results:[],data_freshness:{as_of:'invalid'} }).asOf,null);
});
it('requires a Hedgehog account for all brokerage endpoints', async () => {
    for (const [path,method] of [['/brokerages','GET'],['/brokerages/connect','POST'],['/brokerages/sync','POST'],[`/brokerages/accounts/${connectionId}`,'POST'],[`/brokerages/connections/${connectionId}/disconnect`,'POST']]) {
        const guest = randomUUID();
        const response = await request(createApp(),path,{method,headers:{cookie:`hedgehog_session=${guest}`,'x-hedgehog-request':'1','x-hedgehog-session':digest(guest)},...(method === 'POST' ? {body:{}} : {})});
        assert.equal(response.status,401); assert.ok(!calls.some(c => c.sql.includes('snaptrade_users')));
    }
});
it('reports unconfigured integration without disabling manual holdings', async () => {
    const status = await request(createApp(),'/brokerages',{headers});
    assert.equal(status.status,200); assert.equal(status.body.configured,false); assert.equal(status.body.mode,'sandbox');
    assert.equal((await request(createApp(),'/holdings',{headers})).status,200);
    const link = await request(createApp(),'/brokerages/connect',{method:'POST',headers,body:{}});
    assert.equal(link.status,503); assert.ok(!JSON.stringify(link.body).includes('userSecret'));
});
it('checks ownership before reconnecting, selecting or disconnecting a foreign account', async () => {
    configured();
    for (const [path,body] of [['/brokerages/connect',{ reconnect:connectionId }],[`/brokerages/accounts/${connectionId}`,{included:true}],[`/brokerages/connections/${connectionId}/disconnect`,{}]] as const) {
        const response = await request(createApp(),path,{method:'POST',headers,body}); assert.equal(response.status,404);
    }
    assert.ok(calls.filter(c => c.sql.includes('brokerage_connections')).every(c => c.values[0] === userId && c.values[1] === 'sandbox'));
});
it('forces read-only SANDBOX linking and stores only encrypted credentials', async () => {
    configured(); const requests: {url:URL;body:Record<string,unknown>}[] = [];
    globalThis.fetch = async (url,init) => {
        const parsed = new URL(String(url)), body = JSON.parse(String(init?.body));
        requests.push({url:parsed,body});
        const query = parsed.search.slice(1);
        assert.equal(new Headers(init?.headers).get('Signature'),signature(parsed.pathname,query,body,'test-consumer-key'));
        const output = parsed.pathname.endsWith('registerUser') ? {userId:body.userId,userSecret:'provider-secret'} : {redirectURI:'https://app.snaptrade.com/snapTrade/redeemToken?token=temporary'};
        return new Response(JSON.stringify(output),{status:200});
    };
    const response = await connect(userId);
    assert.equal(requests[1].body.connectionType,'read'); assert.equal(requests[1].body.broker,'SANDBOX');
    assert.equal(requests[1].body.customRedirect,'http://localhost:3000/#brokerages');
    assert.ok(requests[0].body.userId !== account.email);
    assert.ok(!JSON.stringify(response).includes('provider-secret'));
    const insert = calls.find(c => c.sql.startsWith('INSERT INTO snaptrade_users'))!;
    assert.ok(!JSON.stringify(insert.values).includes('provider-secret'));
    assert.equal(decryptSecret(String(insert.values[4]),`${userId}:sandbox`),'provider-secret');
});
it('blocks trading endpoints and sanitizes provider errors', async () => {
    configured(); await assert.rejects(snaptrade('POST','/orders',undefined,{}),/Unsupported/);
    globalThis.fetch = async () => new Response('{"message":"userSecret=private"}',{status:400});
    await assert.rejects(snaptrade('POST','/snapTrade/login',{userId,userSecret:'private'},{connectionType:'read'}),error => error instanceof Error && !error.message.includes('private'));
});
it('rejects untrusted portal URLs', async () => {
    configured();
    globalThis.fetch = async (_url,init) => new Response(JSON.stringify(String(_url).includes('registerUser') ? {userId:JSON.parse(String(init?.body)).userId,userSecret:'secret'} : {redirectURI:'https://evil.example/'}));
    await assert.rejects(connect(userId),/untrusted/);
});
it('preserves the database snapshot on an unexpected account-list response', async () => {
    configured(); const saved = {provider_user_id:'provider-id',encrypted_secret:encryptSecret('secret',`${userId}:sandbox`),client_hash:configuration().clientHash};
    const base = respond; respond = (sql,values) => sql.includes('SELECT * FROM snaptrade_users') ? result([saved]) : base(sql,values);
    globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('/authorizations') ? [] : {unexpected:[]}));
    await assert.rejects(sync(userId),/unexpected/);
    assert.ok(!calls.some(c => c.sql === 'BEGIN' || c.sql.startsWith('DELETE FROM holdings') || c.sql.startsWith('UPDATE brokerage_accounts')));
});
