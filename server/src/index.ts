import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool, query, iso } from './db.ts';
import { migrate } from './migrate.ts';
import { getHoldings, saveHoldings, validateHoldings } from './services/holdings.ts';
import { exposure, calendar, eventDetail } from './services/exposure.ts';
import { moves } from './services/moves.ts';
import { earnings } from './services/earnings.ts';
import { trackRecord } from './services/track-record.ts';
import { scheduler } from './jobs/scheduler.ts';
import { briefingDay } from './services/briefing-content.ts';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => { const cookies = req.headers.cookie ?? ''; let session = cookies.match(/(?:^|;\s*)hedgehog_session=([a-f0-9-]{36})(?:;|$)/)?.[1]; if (!session) {
    session = randomUUID();
    res.cookie('hedgehog_session', session, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 31536000000, path: '/' });
} res.locals.session = session; next(); });
app.get('/health', async (_req, res) => { try {
    await query('SELECT 1');
    res.json({ status: 'ok', asOf: new Date().toISOString() });
}
catch {
    res.status(503).json({ error: 'Database unavailable', asOf: null });
} });
app.get('/holdings', async (_req, res) => { res.json(await getHoldings(res.locals.session)); });
app.post('/holdings', async (req, res) => { let holdings; try {
    holdings = validateHoldings(req.body?.holdings);
}
catch (error) {
    res.status(400).json({ error: (error as Error).message, asOf: null });
    return;
} await query('DELETE FROM briefings WHERE session_id=$1', [res.locals.session]); res.json(await saveHoldings(res.locals.session, holdings)); });
app.get('/exposure', async (_req, res) => { res.json(await exposure(res.locals.session)); });
app.get('/calendar', async (req, res) => { const days = Number(req.query.days ?? 14); if (!Number.isInteger(days) || days < 1 || days > 90) {
    res.status(400).json({ error: 'days must be 1–90', asOf: null });
    return;
} res.json(await calendar(res.locals.session, days)); });
app.get('/event/:ticker', async (req, res) => { const result = await eventDetail(res.locals.session, req.params.ticker); if (!result) {
    res.status(404).json({ error: 'No linked event found', asOf: null });
    return;
} res.json(result); });
app.get('/moves', async (req, res) => { const date = String(req.query.date ?? req.query.day ?? new Date().toISOString().slice(0, 10)); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    res.status(400).json({ error: 'Use a valid YYYY-MM-DD date', asOf: null });
    return;
} res.json(await moves(res.locals.session, date)); });
app.get('/earnings/:symbol', async (req, res) => { res.json(await earnings(res.locals.session, req.params.symbol.toUpperCase())); });
app.get('/track-record', async (_req, res) => { res.json(await trackRecord()); });
app.get('/briefing', async (_req, res) => { const date = briefingDay(); const rows = await query<{
    text: string;
    audio: Buffer | null;
    as_of: Date | null;
}>('SELECT * FROM briefings WHERE session_id=$1 AND day=$2', [res.locals.session, date]); const row = rows[0]; res.json({ date, text: row?.text ?? null, audioUrl: row?.audio ? '/api/briefing/audio' : null, asOf: iso(row?.as_of) }); });
app.get('/briefing/audio', async (_req, res) => { const rows = await query<{
    audio: Buffer;
    as_of: Date;
}>('SELECT audio,as_of FROM briefings WHERE session_id=$1 AND day=$2 AND audio IS NOT NULL', [res.locals.session, briefingDay()]); if (!rows.length) {
    res.status(404).json({ error: 'Briefing audio not ready', asOf: null });
    return;
} res.set('Cache-Control', 'private, max-age=3600'); res.set('X-Data-As-Of', iso(rows[0].as_of)!); res.type('audio/mpeg').send(rows[0].audio); });
app.use((_req, res) => { res.status(404).json({ error: 'Endpoint not found', asOf: null }); });
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { const bad = error instanceof SyntaxError; res.status(bad ? 400 : 503).json({ error: bad ? 'Invalid JSON' : 'Data unavailable; check backend configuration', asOf: null }); });
try {
    if (!process.env.DATABASE_URL)
        throw new Error('DATABASE_URL required');
    await migrate();
    const tasks = scheduler();
    const server = app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0', () => console.log('Hedgehog API listening'));
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () => { tasks.forEach(t => t.stop()); server.close(() => { void pool.end(); }); });
}
catch {
    console.error('Startup failed. Set DATABASE_URL and ensure TimescaleDB is reachable.');
    await pool.end();
    process.exitCode = 1;
}
