import { it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.ts';
import { createApp } from '../app.ts';
import { hashPassword, validatePassword, verifyPassword } from './passwords.ts';
import { digest } from './session.ts';
import { normalizeEmail } from './routes.ts';
import { request } from './request-test.ts';

const originalQuery = pool.query, originalConnect = pool.connect;
const guest = randomUUID(), token = 'a'.repeat(64), id = randomUUID();
const date = new Date('2026-01-01T00:00:00Z');
const account = { id, email: 'alex@example.com', name: 'Alex', created_at: date, expires_at: new Date(Date.now() + 86400000) };
const calls: { sql: string; values: unknown[] }[] = [];
type Result = { rows: Record<string, unknown>[]; rowCount: number };
let respond: (sql: string, values: unknown[]) => Result | Promise<Result>;
const result = (rows: Record<string, unknown>[] = []): Result => ({ rows, rowCount: rows.length });
beforeEach(() => {
    calls.length = 0;
    respond = () => result();
    const execute = async (sql: string, values: unknown[] = []) => { calls.push({ sql, values }); return respond(sql, values); };
    pool.query = execute as typeof pool.query;
    pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
});
afterEach(() => { pool.query = originalQuery; pool.connect = originalConnect; });
function headers(signed = false) {
    return { cookie: `hedgehog_session=${guest}${signed ? `; hedgehog_auth=${token}` : ''}`, 'x-hedgehog-request': '1', 'x-hedgehog-session': digest(signed ? token : guest) };
}
const password = 'a memorable test passphrase';

it('hashes with fresh salts and rejects incorrect passwords and unknown accounts', async () => {
    const first = await hashPassword(password), second = await hashPassword(password);
    assert.notEqual(first, second);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword('an incorrect passphrase', first), false);
    assert.equal(await verifyPassword(password, null), false);
    assert.ok(!first.includes(password));
});
it('normalizes emails and enforces password length without trimming the password', () => {
    assert.equal(normalizeEmail(' Alex@Example.COM '), 'alex@example.com');
    assert.throws(() => normalizeEmail('missing-at.example.com'));
    assert.throws(() => validatePassword('too short'));
    assert.throws(() => validatePassword('x'.repeat(129)));
    assert.equal(validatePassword(` ${password} `), ` ${password} `);
});
it('keeps existing guest portfolio UUIDs and returns no bearer credential', async () => {
    const response = await request(createApp(), '/auth/session', { headers: headers() });
    assert.equal(response.status, 200);
    assert.equal(response.body.user, null);
    assert.equal(response.body.sessionKey, digest(guest));
    assert.ok(!JSON.stringify(response.body).includes(guest));
    assert.equal(response.headers['cache-control'], 'no-store');
});
it('resolves account ownership from the stored token digest, not a supplied user id', async () => {
    respond = (sql) => sql.includes('JOIN users') ? result([account]) : result();
    const response = await request(createApp(), '/holdings?userId=someone-else', { headers: headers(true) });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.find(c => c.sql.includes('JOIN users'))?.values, [digest(token)]);
    assert.deepEqual(calls.find(c => c.sql.includes('FROM holdings'))?.values, [`user:${id}`]);
});
it('cannot use a forged guest cookie to address an account portfolio', async () => {
    const response = await request(createApp(), '/holdings', { headers: { cookie: `hedgehog_session=user:${id}` } });
    assert.equal(response.status, 200);
    assert.notEqual(calls.find(c => c.sql.includes('FROM holdings'))?.values[0], `user:${id}`);
});
it('rejects revoked sessions instead of falling back to anonymous portfolio writes', async () => {
    const response = await request(createApp(), '/holdings', { method: 'POST', headers: headers(true), body: { holdings: [] } });
    assert.equal(response.status, 401);
    assert.ok(!calls.some(c => c.sql.includes('DELETE FROM holdings')));
});
it('resets an expired session to a fresh guest through the session endpoint', async () => {
    const response = await request(createApp(), '/auth/session', { headers: headers(true) });
    assert.equal(response.status, 200);
    assert.equal(response.body.user, null);
    assert.notEqual(response.body.sessionKey, digest(guest));
    assert.ok(String(response.headers['set-cookie']).includes('hedgehog_auth=;'));
});
it('rejects writes without the custom CSRF header and cross-site requests', async () => {
    for (const h of [{ cookie: `hedgehog_session=${guest}` }, { ...headers(), 'sec-fetch-site': 'cross-site' }]) {
        const response = await request(createApp(), '/holdings', { method: 'POST', headers: h, body: { holdings: [] } });
        assert.equal(response.status, 403);
    }
    assert.equal(calls.length, 0);
});
it('rejects stale-tab writes and reads after an account switch', async () => {
    respond = sql => sql.includes('JOIN users') ? result([account]) : result();
    for (const method of ['GET', 'POST']) {
        const response = await request(createApp(), '/holdings', { method, headers: { ...headers(true), 'x-hedgehog-session': digest(guest) }, ...(method === 'POST' ? { body: { holdings: [] } } : {}) });
        assert.equal(response.status, 409);
    }
    assert.ok(!calls.some(c => c.sql.includes('FROM holdings')));
});
it('creates an account and transfers only its guest portfolio in one transaction', async () => {
    respond = sql => sql.includes('auth_rate_limits') ? result([{ attempts: 1, retry: 900 }]) : sql.startsWith('INSERT INTO users') ? result([{ created_at: date }]) : result();
    const response = await request(createApp(), '/auth/signup', { method: 'POST', headers: headers(), body: { name: ' Alex ', email: 'Alex@Example.com', password, saveGuestHoldings: true } });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.name, 'Alex');
    assert.equal(response.body.user.email, 'alex@example.com');
    assert.deepEqual(calls.find(c => c.sql.startsWith('UPDATE holdings'))?.values, [`user:${response.body.user.id}`, guest]);
    assert.ok(calls.some(c => c.sql === 'COMMIT'));
    const cookies = String(response.headers['set-cookie']);
    assert.ok(cookies.includes('HttpOnly') && cookies.includes('SameSite=Lax'));
    assert.ok(!JSON.stringify(response.body).includes('password_hash'));
    assert.notEqual(calls.find(c => c.sql.startsWith('INSERT INTO auth_sessions'))?.values[0], cookies.match(/hedgehog_auth=([^;]+)/)?.[1]);
});
it('can create an empty account without adopting guest holdings', async () => {
    respond = sql => sql.includes('auth_rate_limits') ? result([{ attempts: 1, retry: 900 }]) : sql.startsWith('INSERT INTO users') ? result([{ created_at: date }]) : result();
    const response = await request(createApp(), '/auth/signup', { method: 'POST', headers: headers(), body: { name: 'Alex', email: 'alex@example.com', password, saveGuestHoldings: false } });
    assert.equal(response.status, 201);
    assert.ok(!calls.some(c => c.sql.includes('UPDATE holdings')));
});
it('rejects duplicate accounts without moving the guest portfolio', async () => {
    respond = sql => sql.includes('auth_rate_limits') ? result([{ attempts: 1, retry: 900 }]) : result();
    const response = await request(createApp(), '/auth/signup', { method: 'POST', headers: headers(), body: { name: 'Alex', email: 'alex@example.com', password, saveGuestHoldings: true } });
    assert.equal(response.status, 409);
    assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
    assert.ok(!calls.some(c => c.sql.includes('UPDATE holdings')));
});
it('rolls back account creation when portfolio transfer fails', async () => {
    respond = sql => {
        if (sql.includes('auth_rate_limits')) return result([{ attempts: 1, retry: 900 }]);
        if (sql.startsWith('INSERT INTO users')) return result([{ created_at: date }]);
        if (sql.startsWith('UPDATE holdings')) throw new Error('Database failure');
        return result();
    };
    const response = await request(createApp(), '/auth/signup', { method: 'POST', headers: headers(), body: { name: 'Alex', email: 'alex@example.com', password, saveGuestHoldings: true } });
    assert.equal(response.status, 503);
    assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
    assert.ok(!String(response.headers['set-cookie']).includes('hedgehog_auth='));
});
it('signs in without merging the guest portfolio and rotates the bearer token', async () => {
    const encoded = await hashPassword(password);
    respond = sql => sql.includes('auth_rate_limits') ? result([{ attempts: 1, retry: 900 }]) : sql.includes('FROM users') ? result([{ ...account, password_hash: encoded }]) : result();
    const response = await request(createApp(), '/auth/signin', { method: 'POST', headers: headers(), body: { email: 'alex@example.com', password } });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.id, id);
    assert.ok(!calls.some(c => c.sql.includes('holdings')));
    assert.notEqual(response.body.sessionKey, digest(guest));
});
it('returns the same sign-in error for unknown accounts and incorrect passwords', async () => {
    const encoded = await hashPassword(password);
    for (const rows of [[], [{ ...account, password_hash: encoded }]]) {
        respond = sql => sql.includes('auth_rate_limits') ? result([{ attempts: 1, retry: 900 }]) : sql.includes('FROM users') ? result(rows) : result();
        const response = await request(createApp(), '/auth/signin', { method: 'POST', headers: headers(), body: { email: 'alex@example.com', password: 'an incorrect passphrase' } });
        assert.equal(response.status, 401);
        assert.equal(response.body.error, 'Email or password is incorrect.');
    }
});
it('rate limits authentication before doing password verification', async () => {
    respond = () => result([{ attempts: 11, retry: 800 }]);
    const response = await request(createApp(), '/auth/signin', { method: 'POST', headers: headers(), body: { email: 'alex@example.com', password } });
    assert.equal(response.status, 429);
    assert.equal(response.headers['retry-after'], '800');
    assert.equal(calls.length, 1);
});
it('signs out by revoking the stored session and issuing a fresh guest cookie', async () => {
    respond = sql => sql.includes('JOIN users') ? result([account]) : result();
    const response = await request(createApp(), '/auth/signout', { method: 'POST', headers: headers(true), body: {} });
    assert.equal(response.status, 200);
    assert.equal(response.body.user, null);
    assert.notEqual(response.body.sessionKey, digest(guest));
    assert.deepEqual(calls.find(c => c.sql.startsWith('DELETE FROM auth_sessions'))?.values, [digest(token)]);
});
it('requires authentication for password changes', async () => {
    const response = await request(createApp(), '/auth/password', { method: 'POST', headers: headers(), body: { currentPassword: password, newPassword: 'another strong passphrase' } });
    assert.equal(response.status, 401);
});
it('changes the password and revokes every old session atomically', async () => {
    const encoded = await hashPassword(password);
    respond = sql => sql.includes('JOIN users') ? result([account]) : sql.includes('auth_rate_limits') ? result([{ attempts: 1, retry: 900 }]) : sql.includes('SELECT password_hash') ? result([{ password_hash: encoded }]) : sql.startsWith('SELECT 1 FROM auth_sessions') ? result([{ '?column?': 1 }]) : result();
    const response = await request(createApp(), '/auth/password', { method: 'POST', headers: headers(true), body: { currentPassword: password, newPassword: 'another strong passphrase' } });
    assert.equal(response.status, 200);
    assert.notEqual(response.body.sessionKey, digest(token));
    assert.deepEqual(calls.find(c => c.sql === 'DELETE FROM auth_sessions WHERE user_id=$1')?.values, [id]);
    const updatedHash = calls.find(c => c.sql.startsWith('UPDATE users'))?.values[0];
    assert.equal(await verifyPassword('another strong passphrase', String(updatedHash)), true);
    assert.ok(calls.some(c => c.sql === 'COMMIT'));
});
it('signs out other sessions while preserving the current one', async () => {
    respond = sql => sql.includes('JOIN users') ? result([account]) : sql.startsWith('SELECT 1 FROM auth_sessions') ? result([{ '?column?': 1 }]) : result();
    const response = await request(createApp(), '/auth/signout-others', { method: 'POST', headers: headers(true), body: {} });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.find(c => c.sql.includes('token_hash<>'))?.values, [id, digest(token)]);
});
it('protects briefing refresh against cross-site and stale-session writes', async () => {
    for (const h of [{ cookie: `hedgehog_session=${guest}` }, { ...headers(), 'sec-fetch-site': 'cross-site' }]) {
        const response = await request(createApp(), '/briefing/refresh', {method:'POST',headers:h,body:{}});
        assert.equal(response.status,403);
    }
    respond = sql => sql.includes('JOIN users') ? result([account]) : result();
    const response = await request(createApp(), '/briefing/refresh', {method:'POST',headers:{...headers(true),'x-hedgehog-session':digest(guest)},body:{}});
    assert.equal(response.status,409);
    assert.ok(!calls.some(c => c.sql.includes('pg_try_advisory_lock')));
});
it('scopes briefing reads and refresh generation to the authenticated portfolio', async () => {
    respond = sql => sql.includes('JOIN users') ? result([account]) : sql.includes('pg_try_advisory_lock') ? result([{locked:false}]) : result();
    const read = await request(createApp(), '/briefing', {headers:headers(true)});
    assert.equal(read.status,200);
    assert.equal(calls.find(c => c.sql.includes('FROM briefings'))?.values[0],`user:${id}`);
    assert.match(String(calls.find(c => c.sql.includes('FROM briefings'))?.values[1]), /^\d{4}-\d{2}-\d{2}$/);
    const refresh = await request(createApp(), '/briefing/refresh', {method:'POST',headers:headers(true),body:{}});
    assert.equal(refresh.status,503);
    assert.ok(String(calls.find(c => c.sql.includes('pg_try_advisory_lock'))?.values[0]).includes(`user:${id}`));
});
it('scopes past-event history to the account resolved by authentication',async()=>{
 respond=sql=>sql.includes('JOIN users')?result([account]):result();
 const response=await request(createApp(),'/holdings-history?userId=someone-else',{headers:headers(true)});
 assert.equal(response.status,200);assert.deepEqual(calls.find(c=>c.sql.includes('FROM holdings'))?.values,[`user:${id}`]);
});
it('accepts only supported forecast horizons and keeps the default category record at 24 hours',async()=>{
    for(const horizon of [1,24,168,720]) {
        calls.length=0;
        const response=await request(createApp(),`/track-record?horizon=${horizon}`,{headers:headers()});
        assert.equal(response.status,200);
        const history=calls.find(c=>c.sql.includes(horizon===24?'FROM settled_markets s':'FROM forecast_observations'));
        assert.ok(history);
        if(horizon!==24) assert.deepEqual(history.values,[horizon]);
        assert.deepEqual(calls.find(c=>c.sql.includes('FROM backfill_skips'))?.values,[horizon]);
    }
    const defaultResponse=await request(createApp(),'/track-record',{headers:headers()});
    assert.equal(defaultResponse.status,200);
    for(const horizon of ['48','NaN','-24','']) {
        calls.length=0;
        const response=await request(createApp(),`/track-record?horizon=${horizon}`,{headers:headers()});
        assert.equal(response.status,400);
        assert.ok(!calls.some(c=>c.sql.includes('FROM settled_markets')||c.sql.includes('FROM forecast_observations')));
    }
});
