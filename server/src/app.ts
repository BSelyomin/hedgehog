import express from 'express';
import { authRouter } from './auth/routes.ts';
import { loadSession, protectWrites } from './auth/session.ts';
import { query, iso } from './db.ts';
import { getHoldings, saveHoldings, validateHoldings } from './services/holdings.ts';
import { exposure, calendar, eventDetail } from './services/exposure.ts';
import { latestSession, moves } from './services/moves.ts';
import { earnings, earningsList } from './services/earnings.ts';
import { holdingsHistory } from './services/holdings-history.ts';
import { HISTORY_SUBJECTS } from './services/history-subjects.ts';
import { trackRecord } from './services/track-record.ts';
import { briefing } from './jobs/briefing.ts';
import { briefingDay } from './services/briefing-content.ts';
import type { BriefingResponse } from '../../shared/types.ts';
// What a failed request tells the browser. Postgres reports 25006 when a write reaches a
// database that is accepting reads only, for example because its storage is full.
export function errorResponse(error: unknown): { status: number; error: string } {
    if (error instanceof SyntaxError)
        return { status: 400, error: 'Invalid JSON' };
    if ((error as { code?: unknown } | null)?.code === '25006')
        return { status: 503, error: 'The database is read-only right now, so changes cannot be saved. Viewing still works' };
    return { status: 503, error: 'Data unavailable; check backend configuration' };
}
export function createApp() {
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '32kb' }));
app.get('/health', async (_req, res) => { try {
    const mode = await query<{ transaction_read_only: string }>('SHOW transaction_read_only');
    res.json({ status: 'ok', readOnly: mode[0]?.transaction_read_only === 'on', asOf: new Date().toISOString() });
}
catch {
    res.status(503).json({ error: 'Database unavailable', asOf: null });
} });
app.use(loadSession);
app.use(protectWrites);
app.use('/auth', authRouter);
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
// With no date, show the latest completed session rather than a day whose close is not in yet.
app.get('/moves', async (req, res) => { const date = String(req.query.date ?? req.query.day ?? await latestSession() ?? new Date().toISOString().slice(0, 10)); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    res.status(400).json({ error: 'Use a valid YYYY-MM-DD date', asOf: null });
    return;
} res.json(await moves(res.locals.session, date)); });
app.get('/earnings', async (_req, res) => { res.json(await earningsList(res.locals.session)); });
app.get('/earnings/:symbol', async (req, res) => { res.json(await earnings(res.locals.session, req.params.symbol.toUpperCase())); });
app.get('/holdings-history', async (req,res) => {
    const subject=String(req.query.subject??'all'),symbol=req.query.symbol===undefined?undefined:String(req.query.symbol).trim().toUpperCase();
    if(subject!=='all'&&!HISTORY_SUBJECTS.some(s=>s.id===subject) || symbol!==undefined&&!/^[A-Z][A-Z0-9.\-^=]{0,14}$/.test(symbol)) {res.status(400).json({error:'Choose a supported subject and ticker',asOf:null});return;}
    res.json(await holdingsHistory(res.locals.session,subject,symbol));
});
app.get('/track-record', async (_req, res) => { res.json(await trackRecord(res.locals.session)); });
async function readBriefing(session: string): Promise<BriefingResponse> {
    const date = briefingDay();
    const rows = await query<{text: string; audio: Buffer | null; as_of: Date | null}>(
        'SELECT * FROM briefings WHERE session_id=$1 AND day=$2', [session, date]);
    const row = rows[0];
    return {date, text: row?.text ?? null, audioUrl: row?.audio ? '/api/briefing/audio' : null, asOf: iso(row?.as_of)};
}
app.get('/briefing', async (_req, res) => { res.json(await readBriefing(res.locals.session)); });
app.post('/briefing/refresh', async (req, res) => {
    if (!req.is('application/json')) { res.status(415).json({error: 'Use application/json', asOf: null}); return; }
    try { await briefing(res.locals.session, true); }
    catch { res.status(503).json({error: 'Could not refresh briefing. Your saved briefing is still available; try again shortly.', asOf: null}); return; }
    res.json(await readBriefing(res.locals.session));
});
app.get('/briefing/audio', async (_req, res) => { const rows = await query<{
    audio: Buffer;
    as_of: Date;
}>('SELECT audio,as_of FROM briefings WHERE session_id=$1 AND day=$2 AND audio IS NOT NULL', [res.locals.session, briefingDay()]); if (!rows.length) {
    res.status(404).json({ error: 'Briefing audio not ready', asOf: null });
    return;
} res.set('Cache-Control', 'private, no-store'); res.set('X-Data-As-Of', iso(rows[0].as_of)!); res.type('audio/mpeg').send(rows[0].audio); });
app.use((_req, res) => { res.status(404).json({ error: 'Endpoint not found', asOf: null }); });
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { const response = errorResponse(error); res.status(response.status).json({ error: response.error, asOf: null }); });
return app;
}
