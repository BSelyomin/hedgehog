import { briefing, briefingResponse, savedBriefing } from './jobs/briefing.ts';
import { summaries } from './jobs/summaries.ts';
import express from 'express';
import { movesTiming } from './services/request-timing.ts';
import { authRouter } from './auth/routes.ts';
import { brokerageRouter } from './brokerages/routes.ts';
import { loadSession, protectWrites } from './auth/session.ts';
import { query } from './db.ts';
import { getHoldings, saveHoldings, validateHoldings } from './services/holdings.ts';
import { exposure, calendar, eventDetail } from './services/exposure.ts';
import { moves } from './services/moves.ts';
import { earnings, earningsList } from './services/earnings.ts';
import { trackRecord } from './services/track-record.ts';
import { forecasts, forecastMarkets, scenarioForecast, eventForecast, validateEventForecast } from './services/forecasts.ts';
import { validateScenario } from './services/forecast-model.ts';
import { rankedForecasts, forecastResult } from './services/ranked-forecasts.ts';
import { forecastAssessment, forecastAssessments, retryForecastAssessment } from './services/forecast-assessment.ts';
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
app.use(movesTiming);
app.use(loadSession);
app.use(protectWrites);
app.use('/auth', authRouter);
app.use('/brokerages', brokerageRouter);
app.get('/holdings', async (_req, res) => { res.json(await getHoldings(res.locals.session)); });
app.post('/holdings', async (req, res) => { let holdings; try {
    holdings = validateHoldings(req.body?.holdings);
}
catch (error) {
    res.status(400).json({ error: (error as Error).message, asOf: null });
    return;
} res.json(await saveHoldings(res.locals.session, holdings)); });
app.get('/exposure', async (_req, res) => { res.json(await exposure(res.locals.session)); });
app.get('/forecasts', async (_req, res) => { res.json(await forecasts(res.locals.session)); });
app.get('/forecasts/events', async (_req, res) => { res.json(await forecastMarkets(res.locals.session)); });
app.get('/forecasts/ranked-events', async (_req, res) => { res.json(await rankedForecasts(res.locals.session)); });
app.get('/forecasts/assessments', async (_req, res) => { res.json(await forecastAssessments(res.locals.session)); });
app.get('/forecasts/assessment/:ticker', async (req, res) => {
    const result = await forecastAssessment(res.locals.session, req.params.ticker);
    if (!result) { res.status(404).json({ error: 'No linked forecast group found', asOf: null }); return; }
    res.json(result);
});
app.post('/forecasts/assessment/:ticker', async (req, res) => {
    const result = await retryForecastAssessment(res.locals.session, req.params.ticker);
    if (!result) { res.status(404).json({ error: 'No linked forecast group found', asOf: null }); return; }
    res.json(result);
});
app.get('/forecasts/result/:ticker', async (req, res) => {
    const result = await forecastResult(res.locals.session, req.params.ticker);
    if (!result) { res.status(404).json({ error: 'No linked open market found', asOf: null }); return; }
    res.json(result);
});
app.post('/forecasts/result/:ticker', async (req, res) => {
    let input;
    try { input = validateScenario(req.body); }
    catch (error) { res.status(400).json({ error: (error as Error).message, asOf: null }); return; }
    const result = await forecastResult(res.locals.session, req.params.ticker, input);
    if (!result) { res.status(404).json({ error: 'No linked open market found', asOf: null }); return; }
    res.json(result);
});
app.post('/forecasts/scenario', async (req, res) => {
    let input;
    try { input = validateScenario(req.body); }
    catch (error) { res.status(400).json({ error: (error as Error).message, asOf: null }); return; }
    res.json(await scenarioForecast(res.locals.session, input));
});
app.post('/forecasts/event', async (req, res) => {
    let input;
    try { input = validateEventForecast(req.body); }
    catch (error) { res.status(400).json({ error: (error as Error).message, asOf: null }); return; }
    const result = await eventForecast(res.locals.session, input);
    if (!result) { res.status(404).json({ error: 'No linked open market found', asOf: null }); return; }
    res.json(result);
});
app.get('/calendar', async (req, res) => { const days = Number(req.query.days ?? 14); if (!Number.isInteger(days) || days < 1 || days > 90) {
    res.status(400).json({ error: 'days must be 1–90', asOf: null });
    return;
} res.json(await calendar(res.locals.session, days)); });
app.get('/event/:ticker', async (req, res) => { const result = await eventDetail(res.locals.session, req.params.ticker); if (!result) {
    res.status(404).json({ error: 'No linked event found', asOf: null });
    return;
} res.json(result); });
app.get('/moves', async (req, res) => { const input = req.query.date ?? req.query.day; const date = input === undefined ? undefined : String(input); if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    res.status(400).json({ error: 'Use a valid YYYY-MM-DD date', asOf: null });
    return;
} res.json(await moves(res.locals.session, date)); });
app.get('/earnings', async (_req, res) => { res.json(await earningsList(res.locals.session)); });
app.get('/earnings/:symbol', async (req, res) => { res.json(await earnings(res.locals.session, req.params.symbol.toUpperCase())); });
app.get('/track-record', async (_req, res) => { res.json(await trackRecord(res.locals.session)); });
app.get('/briefing', async (_req, res) => { res.json(await briefingResponse(res.locals.session)); });
app.post(['/briefing/reload', '/briefing/refresh'], async (_req, res) => {
    await briefing(res.locals.session, true);
    res.json(await briefingResponse(res.locals.session));
});
app.get('/briefing/audio', async (req, res) => {
    const saved = await savedBriefing(res.locals.session);
    if (!saved?.value.audio) {
        res.status(404).json({ error: 'Briefing audio not ready', asOf: null });
        return;
    }
    if (req.query.v && req.query.v !== saved.createdAt) {
        res.status(404).json({ error: 'Briefing snapshot changed; reload the page.', asOf: null });
        return;
    }
    res.set('Cache-Control', 'private, no-store');
    if (saved.value.asOf) res.set('X-Data-As-Of', saved.value.asOf);
    res.type('audio/mpeg').send(Buffer.from(saved.value.audio, 'base64'));
});
app.post('/event/:ticker/reload', async (req, res) => {
    const event = await eventDetail(res.locals.session, req.params.ticker);
    if (!event) {
        res.status(404).json({ error: 'No linked event found', asOf: null });
        return;
    }
    await summaries(event.event.ticker, true);
    res.json(await eventDetail(res.locals.session, event.event.ticker));
});
app.use((_req, res) => { res.status(404).json({ error: 'Endpoint not found', asOf: null }); });
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const bad = error instanceof SyntaxError;
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
    // Log only the route template and error classification, never query values,
    // URLs with secrets, provider bodies, or raw database connection errors.
    console.warn('API request failed', { method: req.method, route: req.route?.path ?? 'middleware',
        code: /^[A-Z0-9_]{5,24}$/.test(code) ? code : bad ? 'INVALID_JSON' : 'UNAVAILABLE' });
    res.status(bad ? 400 : 503).json({ error: bad ? 'Invalid JSON' :
        code === '25006' ? errorResponse(error).error :
        code === '42P01' || code === '42703' ? 'Database schema is out of date. Restart the backend to apply migrations.' :
        code === '57014' ? 'Database request timed out. Try Reload; check backend database performance if it continues.' :
        'Data unavailable. Try Reload; check the backend connection and server logs if it continues.', asOf: null });
});
return app;
}
