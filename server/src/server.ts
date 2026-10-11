import express from 'express';
import { attachDatabasePool, waitUntil } from '@vercel/functions';
import { createApp } from './app.ts';
import { pool, aiPool } from './db.ts';
import { databaseReadOnly, migrate, pendingMigrations } from './migrate.ts';
import { jobActions, jobLockName, resumeScheduledJob, runJob, type JobAction } from './jobs/scheduler.ts';
import { operationalRequest } from './deployment/operations.ts';

// Vercel imports an Express app; it never executes persistent startup's listen,
// migrations or node-cron timers. Deployment maintenance is an authenticated request.
const app = express();
app.disable('x-powered-by');
attachDatabasePool(pool);
attachDatabasePool(aiPool);
app.use('/internal', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        const result = await operationalRequest({
            method: req.method, path: req.path, authorization: req.get('Authorization'),
            secret: process.env.CRON_SECRET, force: req.query.force === '1',
        }, {
            jobs: Object.keys(jobActions),
            run: name => runJob(jobLockName(name as JobAction), jobActions[name as JobAction]),
            resume: name => resumeScheduledJob(name as JobAction),
            migrate,
            status: async () => ({ pendingMigrations: await pendingMigrations(), readOnly: await databaseReadOnly() }),
            background: waitUntil,
        });
        if (result.allow) res.set('Allow', result.allow);
        res.status(result.status).json(result.body);
    } catch {
        res.status(503).json({ error: 'Deployment maintenance unavailable; check database configuration.', asOf: null });
    }
});
app.use(createApp());
export default app;
