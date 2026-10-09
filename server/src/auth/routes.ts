import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import type { AccountUser } from '../../../shared/types.ts';
import { pool, query } from '../db.ts';
import { hashPassword, verifyPassword, validatePassword, PasswordBusyError } from './passwords.ts';
import { digest, guestCookie, newSession, resetGuest, sessionResponse, setAuthCookie, state } from './session.ts';

export const authRouter = Router();
function fail(res: Response, status: number, error: string) { res.status(status).json({ error, asOf: null }); }
export function normalizeEmail(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Enter a valid email address.');
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    return email;
}
function credentials(body: unknown): { email: string; password: string } {
    const input = body as Record<string, unknown> | undefined;
    return { email: normalizeEmail(input?.email), password: validatePassword(input?.password) };
}

async function throttle(email: string, res: Response): Promise<boolean> {
    // Database-backed limits survive restarts and apply across server instances.
    // Only hashed identifiers are retained, including for nonexistent accounts.
    const key = digest(email);
    const rows = await query<{ attempts: number; retry: number }>(
        `INSERT INTO auth_rate_limits(key,attempts,resets_at) VALUES($1,1,now()+interval '15 minutes')
         ON CONFLICT(key) DO UPDATE SET
           attempts=CASE WHEN auth_rate_limits.resets_at<=now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
           resets_at=CASE WHEN auth_rate_limits.resets_at<=now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.resets_at END
         RETURNING attempts,ceil(extract(epoch FROM resets_at-now()))::integer AS retry`, [key]);
    if (rows[0].attempts <= 10) return true;
    res.set('Retry-After', String(rows[0].retry));
    fail(res, 429, 'Too many attempts. Try again in 15 minutes.');
    return false;
}
function signedIn(res: Response): AccountUser | null {
    const user = state(res).user;
    if (!user) fail(res, 401, 'Sign in to manage your account.');
    return user;
}
function finish(res: Response, user: AccountUser, session: Awaited<ReturnType<typeof newSession>>, status = 200) {
    setAuthCookie(res, session.token);
    const guest = guestCookie(res);
    res.status(status).json(sessionResponse({ guest, user, tokenHash: session.tokenHash, sessionKey: session.tokenHash, expiresAt: session.expiresAt, invalid: false }));
}

authRouter.get('/session', (_req, res) => {
    const auth = state(res);
    res.json(sessionResponse(auth.invalid ? resetGuest(res) : auth));
});

authRouter.post('/signup', async (req, res) => {
    if (state(res).user) { fail(res, 409, 'Sign out before creating another account.'); return; }
    let email: string, password: string, name: string;
    try {
        ({ email, password } = credentials(req.body));
        if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 80)
            throw new Error('Enter a name between 1 and 80 characters.');
        if (typeof req.body.saveGuestHoldings !== 'boolean') throw new Error('Choose whether to save your guest portfolio.');
        name = req.body.name.trim();
    } catch (error) { fail(res, 400, (error as Error).message); return; }
    if (!await throttle(email, res)) return;
    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const id = randomUUID();
        const result = await client.query<{ created_at: Date }>(
            'INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING created_at', [id, email, name, passwordHash]);
        if (!result.rowCount) {
            await client.query('ROLLBACK');
            fail(res, 409, 'Unable to create an account with this email. Try signing in.');
            return;
        }
        if (req.body.saveGuestHoldings) {
            const guest = state(res).guest;
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [guest]);
            await client.query('UPDATE holdings SET session_id=$1 WHERE session_id=$2', [`user:${id}`, guest]);
            await client.query('DELETE FROM briefings WHERE session_id=$1', [guest]);
        }
        const session = await newSession(client, id);
        await client.query('COMMIT');
        finish(res, { id, email, name, createdAt: result.rows[0].created_at.toISOString() }, session, 201);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
});

authRouter.post('/signin', async (req, res) => {
    if (state(res).user) { fail(res, 409, 'Sign out before switching accounts.'); return; }
    let email: string, password: string;
    try { ({ email, password } = credentials(req.body)); }
    catch (error) { fail(res, 400, (error as Error).message); return; }
    if (!await throttle(email, res)) return;
    const rows = await query<{ id: string; email: string; name: string; created_at: Date; password_hash: string }>('SELECT * FROM users WHERE email=$1', [email]);
    const user = rows[0];
    if (!await verifyPassword(password, user?.password_hash ?? null) || !user) {
        fail(res, 401, 'Email or password is incorrect.'); return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const locked = await client.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [user.id]);
        if (locked.rows[0]?.password_hash !== user.password_hash) {
            await client.query('ROLLBACK'); fail(res, 401, 'Email or password is incorrect.'); return;
        }
        const session = await newSession(client, user.id);
        await client.query('COMMIT');
        finish(res, { id: user.id, email: user.email, name: user.name, createdAt: user.created_at.toISOString() }, session);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
});

authRouter.post('/signout', async (_req, res) => {
    if (state(res).tokenHash) await query('DELETE FROM auth_sessions WHERE token_hash=$1', [state(res).tokenHash]);
    res.json(sessionResponse(resetGuest(res)));
});

authRouter.post('/password', async (req, res) => {
    const user = signedIn(res);
    if (!user) return;
    let currentPassword: string, newPassword: string;
    try {
        currentPassword = validatePassword(req.body?.currentPassword);
        newPassword = validatePassword(req.body?.newPassword);
        if (currentPassword === newPassword) throw new Error('Choose a different new password.');
    } catch (error) { fail(res, 400, (error as Error).message); return; }
    if (!await throttle(user.email, res)) return;
    const rows = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [user.id]);
    if (!await verifyPassword(currentPassword, rows[0]?.password_hash ?? null)) {
        fail(res, 400, 'Current password is incorrect.'); return;
    }
    const passwordHash = await hashPassword(newPassword);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const locked = await client.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [user.id]);
        if (locked.rows[0]?.password_hash !== rows[0].password_hash) {
            await client.query('ROLLBACK'); fail(res, 409, 'Password changed in another session. Sign in again.'); return;
        }
        if (!(await client.query('SELECT 1 FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()', [state(res).tokenHash])).rowCount) {
            await client.query('ROLLBACK'); fail(res, 401, 'Your session expired. Please sign in again.'); return;
        }
        await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, user.id]);
        await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [user.id]);
        const session = await newSession(client, user.id);
        await client.query('COMMIT');
        finish(res, user, session);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
});

authRouter.post('/signout-others', async (_req, res) => {
    const user = signedIn(res);
    if (!user) return;
    // Serialize with sign-in and password changes for this account.
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
        if (!(await client.query('SELECT 1 FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()', [state(res).tokenHash])).rowCount) {
            await client.query('ROLLBACK'); fail(res, 401, 'Your session expired. Please sign in again.'); return;
        }
        await client.query('DELETE FROM auth_sessions WHERE user_id=$1 AND token_hash<>$2', [user.id, state(res).tokenHash]);
        await client.query('COMMIT');
        res.json(sessionResponse(state(res)));
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
});

authRouter.use((error: unknown, _req: import('express').Request, res: Response, next: import('express').NextFunction) => {
    if (error instanceof PasswordBusyError) { res.set('Retry-After', '2'); fail(res, 429, error.message); }
    else next(error);
});
