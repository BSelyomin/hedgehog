import cron from 'node-cron';
import type { PoolClient } from 'pg';
import { pool, query } from '../db.ts';
import { poll } from './poll.ts';
import { prices } from './prices.ts';
import { stockTags, tagSeries } from './tagging.ts';
import { measure } from './measure.ts';
import { summaries } from './summaries.ts';
import { briefings } from './briefing.ts';
import { backfill } from './backfill.ts';
import { syncBrokerages } from '../brokerages/service.ts';
import { earningsDates } from './earnings-dates.ts';
const reportDates = earningsDates;
const stoppedJobs = new Set<string>();
export const scheduledJobNames = ['poll', 'nightly', 'briefings', 'enrich', 'session-cleanup', 'brokerages', 'price-history', 'earnings-dates', 'bootstrap'] as const;
export async function runJob(name: string, job: () => Promise<void>) {
    if (stoppedJobs.has(name)) return;
    let client: PoolClient | null = null, locked = false;
    try {
        if ((await query('SELECT name FROM job_state WHERE name=$1', [`stopped-job:${name}`])).length) { stoppedJobs.add(name); return; }
        client = await pool.connect();
        locked = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [`hedgehog:${name}`])).rows[0].locked;
        if (!locked) return;
        await job();
    }
    catch {
        stoppedJobs.add(name);
        try { await query("INSERT INTO job_state(name,cursor) VALUES($1,'failed') ON CONFLICT(name) DO UPDATE SET cursor='failed',updated_at=now()", [`stopped-job:${name}`]); }
        catch { /* Database failure cannot be persisted, but stays stopped in this process. */ }
        console.warn('Job stopped after failure; automatic retries disabled:', name);
    }
    finally {
        try { if (locked) await client!.query('SELECT pg_advisory_unlock(hashtext($1))', [`hedgehog:${name}`]); }
        finally { client?.release(); }
    }
}
export function scheduler() {
    const tasks = [cron.schedule('*/5 * * * *', () => runJob('poll', poll)), cron.schedule('30 22 * * *', () => runJob('nightly', async () => { await stockTags(); await tagSeries(); await backfill(); await summaries(); await briefings(); }), { timezone: 'America/New_York' }), cron.schedule('0 8 * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }), cron.schedule('0 * * * *', () => runJob('enrich', async () => { await stockTags(); await tagSeries(); await summaries(); await briefings(); }))];
    tasks.push(cron.schedule('15 * * * *', () => runJob('session-cleanup', async () => {
        await query('DELETE FROM auth_sessions WHERE expires_at<=now()');
        await query('DELETE FROM auth_rate_limits WHERE resets_at<=now()');
    })));
    tasks.push(cron.schedule('20 * * * *', () => runJob('brokerages', syncBrokerages)));
    tasks.push(cron.schedule('15 * * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }));
    void runJob('poll', poll);
    // Price/measurement availability must not wait for optional AI tagging.
    const priceHistory = async () => {
        await runJob('price-history', async () => { await prices(); await measure(); });
        void runJob('briefings', briefings);
    };
    tasks.push(cron.schedule('10 * * * *', priceHistory));
    void priceHistory();
    tasks.push(cron.schedule('30 22 * * *', () => runJob('earnings-dates', reportDates), { timezone: 'America/New_York' }));
    void runJob('earnings-dates', reportDates);
    void runJob('bootstrap', async () => { await stockTags(); await tagSeries(); });
    return tasks;
}
