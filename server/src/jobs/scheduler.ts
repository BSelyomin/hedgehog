import { trackEntities } from './track-entities.ts';
import cron from 'node-cron';
import type { PoolClient } from 'pg';
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
const reportDates = earningsDates;
const stoppedJobs = new Set<string>();
export const scheduledJobNames = ['poll', 'nightly', 'briefings', 'enrich', 'session-cleanup', 'brokerages', 'price-history', 'earnings-dates', 'bootstrap', 'odds-candles'] as const;
// The lock belongs to a database session. Keep it alive during healthy work, but
// let the database expire an abandoned session so a dead backend cannot hold it.
export const LOCK_SECONDS = 120;
export const HEARTBEAT_MS = 30000;
export async function runJob(name: string, job: () => Promise<void>) {
    if (stoppedJobs.has(name)) return;
    let client: PoolClient | null = null, held = false;
    let beat: ReturnType<typeof setInterval> | undefined;
    try {
        if ((await query('SELECT name FROM job_state WHERE name=$1', [`stopped-job:${name}`])).length) { stoppedJobs.add(name); return; }
        client = await pool.connect();
        await client.query(`SET idle_session_timeout = '${LOCK_SECONDS}s'`);
        held = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [`hedgehog:${name}`])).rows[0].locked;
        if (!held) return;
        beat = setInterval(() => { void client!.query('SELECT 1').catch(() => clearInterval(beat)); }, HEARTBEAT_MS);
        beat.unref();
        await job();
    }
    catch {
        stoppedJobs.add(name);
        try { await query("INSERT INTO job_state(name,cursor) VALUES($1,'failed') ON CONFLICT(name) DO UPDATE SET cursor='failed',updated_at=now()", [`stopped-job:${name}`]); }
        catch { /* Keep stopped in memory when storage is unavailable. */ }
        console.warn('Job stopped after failure; automatic retries disabled:', name);
    }
    finally {
        clearInterval(beat);
        if (client) {
            try {
                if (held) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`hedgehog:${name}`]);
                await client.query('RESET idle_session_timeout');
                client.release();
            } catch {
                // The lock session is already gone; discard it instead of reusing it.
                client.release(true);
            }
        }
    }
}
// The other timeframes of the track record ask Kalshi for up to four quotes a market, one request
// each. Without a limit a night's run would walk every settled market of every reviewed series,
// which is days of requests under the nightly lock. It takes this many markets a night, after the
// summaries and briefings, and carries on from where it stopped the night after.
export const HORIZON_MARKETS = 300;
export function scheduler() {
    const tasks = [cron.schedule('*/5 * * * *', () => runJob('poll', poll)), cron.schedule('30 22 * * *', () => runJob('nightly', async () => { await stockTags(); await tagSeries(); await backfill(); await summaries(); await briefings(); await backfillHorizons({ maxMarkets: HORIZON_MARKETS }); }), { timezone: 'America/New_York' }), cron.schedule('0 8 * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }), cron.schedule('0 * * * *', () => runJob('enrich', async () => { await stockTags(); await tagSeries(); await summaries(); await briefings(); }))];
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
        await runJob('price-history', async () => { await prices(); await measure(); await profiles(); await trackEntities(); });
        void runJob('briefings', briefings);
    };
    tasks.push(cron.schedule('10 * * * *', priceHistory));
    void priceHistory();
    tasks.push(cron.schedule('30 22 * * *', () => runJob('earnings-dates', reportDates), { timezone: 'America/New_York' }));
    void runJob('earnings-dates', reportDates);
    void runJob('bootstrap', async () => { await stockTags(); await tagSeries(); });
    return tasks;
}
