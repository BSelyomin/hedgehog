import { trackCompanies } from './track-companies.ts';
import { trackHistory, trackEntities } from './track-history.ts';
import cron from 'node-cron';
import { pool, query } from '../db.ts';
import { poll } from './poll.ts';
import { prices } from './prices.ts';
import { stockTags, tagSeries } from './tagging.ts';
import { measure } from './measure.ts';
import { summaries } from './summaries.ts';
import { briefings } from './briefing.ts';
import { backfill, backfillHorizons } from './backfill.ts';
import { syncBrokerages } from '../brokerages/service.ts';
import { earningsDates } from './earnings-dates.ts';
import { oddsCandles } from './odds-candles.ts';
import { profiles } from './profiles.ts';
const reportDates = () => earningsDates().catch(() => console.warn('Earnings report dates unavailable'));
// A job's lock lives on a database session, so that only one backend sharing the database runs
// the job. If that backend died without closing the session (a laptop going to sleep, a killed
// container behind the database's proxy), the session stayed open and held the lock: on
// 2026-10-10 that stopped every backend polling for an hour. The session now asks the server to
// end it after LOCK_SECONDS without a statement, and the job sends one every HEARTBEAT_MS while
// it runs, so a dead backend's lock is gone within about two minutes.
export const LOCK_SECONDS = 120;
export const HEARTBEAT_MS = 30000;
export async function runJob(name: string, job: () => Promise<void>) {
    const client = await pool.connect();
    let held = false, beat: ReturnType<typeof setInterval> | undefined;
    try {
        await client.query(`SET idle_session_timeout = '${LOCK_SECONDS}s'`);
        held = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [`hedgehog:${name}`])).rows[0].locked;
        if (!held)
            return;
        beat = setInterval(() => { client.query('SELECT 1').catch(() => {}); }, HEARTBEAT_MS);
        beat.unref();
        try {
            await job();
        }
        catch {
            console.warn('Job failed; will retry:', name);
        }
    }
    finally {
        clearInterval(beat);
        try {
            if (held)
                await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`hedgehog:${name}`]);
            // The connection goes back to the pool, where sitting idle is normal.
            await client.query('RESET idle_session_timeout');
            client.release();
        }
        catch {
            // The session is already gone, and its lock with it. Do not reuse the connection.
            client.release(true);
        }
    }
}
export function scheduler() {
    const tasks = [cron.schedule('*/5 * * * *', () => runJob('poll', poll)), cron.schedule('30 22 * * *', () => runJob('nightly', async () => { await stockTags(); await tagSeries(); await backfill(); await backfillHorizons(); await summaries(); await briefings(); }), { timezone: 'America/New_York' }), cron.schedule('0 8 * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }), cron.schedule('0 * * * *', () => runJob('enrich', async () => { await stockTags(); await tagSeries(); await summaries(); await briefings(); }))];
    if(process.env.TRACK_HISTORY_ENABLED==='true')tasks.push(cron.schedule('40 * * * *',()=>runJob('track-history',async()=>{await trackEntities();await trackCompanies();await trackHistory({perSeries:5});})));
    tasks.push(cron.schedule('15 * * * *', () => runJob('session-cleanup', async () => {
        await query('DELETE FROM auth_sessions WHERE expires_at<=now()');
        await query('DELETE FROM auth_rate_limits WHERE resets_at<=now()');
    })));
    tasks.push(cron.schedule('20 * * * *', () => runJob('brokerages', syncBrokerages)));
    tasks.push(cron.schedule('15 * * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }));
    // Kalshi's hourly closes each hour; its daily closes just after its day ends at midnight in New York.
    tasks.push(cron.schedule('5 * * * *', () => runJob('odds-candles', () => oddsCandles(60))));
    tasks.push(cron.schedule('20 0 * * *', () => runJob('odds-candles', () => oddsCandles(1440)), { timezone: 'America/New_York' }));
    // The first poll after an upgrade records each market's listing time, which the candlesticks start from.
    void runJob('poll', poll).then(() => runJob('odds-candles', () => oddsCandles()));
    // Price/measurement availability must not wait for optional AI tagging.
    const priceHistory = async () => {
        await runJob('price-history', async () => { await prices(); await measure(); await profiles(); });
        void runJob('briefings', briefings);
    };
    tasks.push(cron.schedule('10 * * * *', priceHistory));
    void priceHistory();
    tasks.push(cron.schedule('30 22 * * *', () => runJob('earnings-dates', reportDates), { timezone: 'America/New_York' }));
    void runJob('earnings-dates', reportDates);
    void runJob('bootstrap', async () => { await stockTags(); await tagSeries(); });
    return tasks;
}
