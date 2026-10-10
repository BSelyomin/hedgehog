import { Router } from 'express';
import { state } from '../auth/session.ts';
import { BrokerageError } from './client.ts';
import { query } from '../db.ts';
import { digest } from '../auth/session.ts';
import { brokerageStatus, connect, disconnect, selectAccount, sync, accountActivities } from './service.ts';
export const brokerageRouter = Router();
brokerageRouter.use((_req, res, next) => {
    if (!state(res).user) { res.status(401).json({ error: 'Sign in to connect brokerage accounts.', asOf: null }); return; }
    next();
});
brokerageRouter.get('/', async (_req, res) => { res.json(await brokerageStatus(state(res).user!.id)); });
brokerageRouter.get('/accounts/:id/activities', async (req, res) => {
    const offset = Number(req.query.offset ?? 0), limit = Number(req.query.limit ?? 100);
    if (Object.keys(req.query).some(key => !['offset', 'limit'].includes(key)) ||
        typeof req.query.offset === 'object' || typeof req.query.limit === 'object' ||
        !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        res.status(400).json({ error: 'Use a nonnegative offset and a limit between 1 and 1000.', asOf: null }); return;
    }
    res.json(await accountActivities(state(res).user!.id, req.params.id, offset, limit));
});
brokerageRouter.use(async (req, res, next) => {
    if (req.method !== 'POST' || !['/connect', '/sync'].includes(req.path)) { next(); return; }
    const rows = await query<{ attempts: number; retry: number }>(
        `INSERT INTO auth_rate_limits(key,attempts,resets_at) VALUES($1,1,now()+interval '15 minutes')
         ON CONFLICT(key) DO UPDATE SET
         attempts=CASE WHEN auth_rate_limits.resets_at<=now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
         resets_at=CASE WHEN auth_rate_limits.resets_at<=now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.resets_at END
         RETURNING attempts,ceil(extract(epoch FROM resets_at-now()))::integer AS retry`, [digest(`snaptrade:${state(res).user!.id}:${req.path}`)]);
    if (rows[0].attempts > 12) {
        res.set('Retry-After', String(rows[0].retry));
        res.status(429).json({ error: 'Too many brokerage requests. Try again in 15 minutes.', asOf: null });
        return;
    }
    next();
});
brokerageRouter.post('/connect', async (req, res) => {
    const reconnect = req.body?.reconnect;
    if (reconnect !== undefined && typeof reconnect !== 'string') { res.status(400).json({ error: 'Invalid reconnect identifier', asOf: null }); return; }
    res.json(await connect(state(res).user!.id, reconnect));
});
brokerageRouter.post('/sync', async (_req, res) => { res.json(await sync(state(res).user!.id)); });
brokerageRouter.post('/accounts/:id', async (req, res) => {
    if (typeof req.body?.included !== 'boolean') { res.status(400).json({ error: 'included must be a boolean', asOf: null }); return; }
    res.json(await selectAccount(state(res).user!.id, req.params.id, req.body.included));
});
brokerageRouter.post('/connections/:id/disconnect', async (req, res) => { res.json(await disconnect(state(res).user!.id, req.params.id)); });
brokerageRouter.use((error: unknown, _req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (!(error instanceof BrokerageError)) { next(error); return; }
    res.status(error.status).json({ error: error.message, asOf: null });
});
