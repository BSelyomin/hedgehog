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
import { backfill, backfillTimeframes } from './backfill.ts';
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
// What a scheduled job does after it fails. Kalshi's data jobs run again at their next schedule:
// AGENTS.md has the poller back off and carry on, and a poller stopped by a single refusal left
// every backend sharing the database without odds within hours of the stop rule arriving
// (2026-10-10). The other jobs call AI, voice, a brokerage or another provider and keep that
// rule: one failure stops them until `npm run job -- resume-job <name>`.
export const RETRYING_JOBS: ReadonlySet<string> = new Set(['poll', 'odds-candles', 'track-record']);
export async function runJob(name: string, job: () => Promise<void>) {
    const retries = RETRYING_JOBS.has(name);
    if (!retries && stoppedJobs.has(name)) return;
    let client: PoolClient | null = null, held = false;
    let beat: ReturnType<typeof setInterval> | undefined;
    try {
        // A stop marker left for a retrying job, by a backend on older code, is not obeyed.
        if (!retries && (await query('SELECT name FROM job_state WHERE name=$1', [`stopped-job:${name}`])).length) { stoppedJobs.add(name); return; }
        client = await pool.connect();
        await client.query(`SET idle_session_timeout = '${LOCK_SECONDS}s'`);
        held = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [`hedgehog:${name}`])).rows[0].locked;
        if (!held) return;
        beat = setInterval(() => { void client!.query('SELECT 1').catch(() => clearInterval(beat)); }, HEARTBEAT_MS);
        beat.unref();
        await job();
    }
    catch {
        if (retries)
            console.warn('Job failed; it runs again at its next schedule:', name);
        else {
            stoppedJobs.add(name);
            try { await query("INSERT INTO job_state(name,cursor) VALUES($1,'failed') ON CONFLICT(name) DO UPDATE SET cursor='failed',updated_at=now()", [`stopped-job:${name}`]); }
            catch { /* Keep stopped in memory when storage is unavailable. */ }
            console.warn('Job stopped after failure; automatic retries disabled:', name);
        }
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
// A tick that fires late still runs. The scheduling library drops one that is more than a second
// late, and in a virtual machine whose clock is corrected in steps (Docker Desktop on a laptop)
// every five-minute timer fired 20 to 30 seconds late: on 2026-10-10 no scheduled job ran on that
// backend for over an hour. A late run is wanted as long as the next one is not yet due, which
// the library checks for itself.
export const LATE_TICK_MS = 15 * 60 * 1000;
const every = (expression: string, task: () => unknown, options: { timezone?: string } = {}) => cron.schedule(expression, task, { missedExecutionTolerance: LATE_TICK_MS, ...options });
export function scheduler() {
    // The track record is Kalshi's data and retries; the nightly job is AI work and stops on a
    // failure. They are separate jobs so that neither rule reaches the other.
    const tasks = [every('*/5 * * * *', () => runJob('poll', poll)), every('30 22 * * *', () => runJob('nightly', async () => { await stockTags(); await tagSeries(); await summaries(); await briefings(); }), { timezone: 'America/New_York' }),
        every('45 22 * * *', () => runJob('track-record', async () => { await backfill(); await backfillTimeframes(); }), { timezone: 'America/New_York' }), every('0 8 * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }), every('0 * * * *', () => runJob('enrich', async () => { await stockTags(); await tagSeries(); await summaries(); await briefings(); }))];
    tasks.push(every('15 * * * *', () => runJob('session-cleanup', async () => {
        await query('DELETE FROM auth_sessions WHERE expires_at<=now()');
        await query('DELETE FROM auth_rate_limits WHERE resets_at<=now()');
    })));
    tasks.push(every('20 * * * *', () => runJob('brokerages', syncBrokerages)));
    tasks.push(every('15 * * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }));
    // Kalshi's hourly closes each hour; its daily closes just after its day ends at midnight in New York.
    tasks.push(every('5 * * * *', () => runJob('odds-candles', () => oddsCandles(60))));
    tasks.push(every('20 0 * * *', () => runJob('odds-candles', () => oddsCandles(1440)), { timezone: 'America/New_York' }));
    // The first poll after an upgrade records each market's listing time, which the candlesticks start from.
    void runJob('poll', poll).then(() => runJob('odds-candles', () => oddsCandles()));
    // Price/measurement availability must not wait for optional AI tagging.
    const priceHistory = async () => {
        await runJob('price-history', async () => { await prices(); await measure(); await profiles(); await trackEntities(); });
        void runJob('briefings', briefings);
    };
    tasks.push(every('10 * * * *', priceHistory));
    void priceHistory();
    tasks.push(every('30 22 * * *', () => runJob('earnings-dates', reportDates), { timezone: 'America/New_York' }));
    void runJob('earnings-dates', reportDates);
    void runJob('bootstrap', async () => { await stockTags(); await tagSeries(); });
    return tasks;
}
