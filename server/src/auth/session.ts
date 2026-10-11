import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import type { AccountUser, SessionResponse } from '../../../shared/types.ts';
import { query } from '../db.ts';
import { timed } from '../services/request-timing.ts';

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface AuthState {
    user: AccountUser | null;
    tokenHash: string | null;
    sessionKey: string;
    expiresAt: string | null;
    guest: string;
    invalid: boolean;
}
export function state(res: Response): AuthState { return res.locals.auth as AuthState; }
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: process.env.COOKIE_SECURE === 'true', path: '/' });
export function guestCookie(res: Response): string {
    const guest = randomUUID();
    res.cookie('hedgehog_session', guest, { ...cookieOptions(), maxAge: 365 * 24 * 60 * 60 * 1000 });
    return guest;
}
export function setAuthCookie(res: Response, token: string) {
    res.cookie('hedgehog_auth', token, { ...cookieOptions(), maxAge: SESSION_MS });
}
export function clearAuthCookie(res: Response) { res.clearCookie('hedgehog_auth', cookieOptions()); }
export function sessionResponse(auth: AuthState): SessionResponse {
    return { user: auth.user, sessionKey: auth.sessionKey, expiresAt: auth.expiresAt, asOf: new Date().toISOString() };
}
export function resetGuest(res: Response): AuthState {
    clearAuthCookie(res);
    const guest = guestCookie(res);
    const auth = { guest, user: null, tokenHash: null, sessionKey: digest(guest), expiresAt: null, invalid: false };
    res.locals.auth = auth;
    res.locals.session = guest;
    return auth;
}
export async function newSession(client: PoolClient, userId: string) {
    const token = randomBytes(32).toString('hex');
    const tokenHash = digest(token);
    const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
    await client.query('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [tokenHash, userId, expiresAt]);
    return { token, tokenHash, expiresAt };
}

export async function loadSession(req: Request, res: Response, next: NextFunction) {
    res.set('Cache-Control', 'no-store');
    const cookies = req.headers.cookie ?? '';
    const guest = cookies.match(/(?:^|;\s*)hedgehog_session=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:;|$)/)?.[1] ?? guestCookie(res);
    const auth: AuthState = { guest, user: null, tokenHash: null, sessionKey: digest(guest), expiresAt: null, invalid: false };
    const rawToken = cookies.match(/(?:^|;\s*)hedgehog_auth=([^;]*)(?:;|$)/)?.[1];
    if (rawToken !== undefined) {
        auth.invalid = true;
        if (/^[a-f0-9]{64}$/.test(rawToken)) {
            const rows = await timed('session', () => query<{ id: string; email: string; name: string; created_at: Date; expires_at: Date }>(
                `SELECT u.id,u.email,u.name,u.created_at,s.expires_at FROM auth_sessions s
                 JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(rawToken)], 'session'));
            if (rows[0]) {
                const row = rows[0];
                auth.user = { id: row.id, email: row.email, name: row.name, createdAt: row.created_at.toISOString() };
                auth.tokenHash = digest(rawToken);
                auth.sessionKey = auth.tokenHash;
                auth.expiresAt = row.expires_at.toISOString();
                auth.invalid = false;
            }
        }
    }
    res.locals.auth = auth;
    // A client-supplied guest UUID can never address an account portfolio.
    res.locals.session = auth.user ? `user:${auth.user.id}` : guest;
    if (auth.invalid && req.path !== '/auth/session') {
        res.status(401).json({ error: 'Your session expired. Please sign in again.', asOf: null });
        return;
    }
    if (req.path !== '/auth/session' && req.get('X-Hedgehog-Session') && req.get('X-Hedgehog-Session') !== auth.sessionKey) {
        res.status(409).json({ error: 'Your session changed. Reload before making changes.', asOf: null });
        return;
    }
    next();
}

export function protectWrites(req: Request, res: Response, next: NextFunction) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    // No CORS is enabled: a foreign origin cannot send these headers through a browser.
    if (req.get('X-Hedgehog-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site' || !req.is('application/json')) {
        res.status(403).json({ error: 'Request must come from the Hedgehog application.', asOf: null });
        return;
    }
    if (req.get('X-Hedgehog-Session') !== state(res).sessionKey) {
        res.status(409).json({ error: 'Your session changed. Reload before making changes.', asOf: null });
        return;
    }
    next();
}
