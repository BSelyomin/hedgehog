import cron from 'node-cron';
import { pool } from '../db.ts';
import { poll } from './poll.ts';
import { prices } from './prices.ts';
import { stockTags, tagSeries } from './tagging.ts';
import { measure } from './measure.ts';
import { summaries } from './summaries.ts';
import { briefings } from './briefing.ts';
import { backfill } from './backfill.ts';
export async function runJob(name: string, job: () => Promise<void>) {
    const client = await pool.connect();
    const lock = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [`hedgehog:${name}`])).rows[0].locked;
    if (!lock) {
        client.release();
        return;
    }
    try {
        await job();
    }
    catch {
        console.warn('Job failed; will retry:', name);
    }
    finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`hedgehog:${name}`]);
        client.release();
    }
}
export function scheduler() {
    const tasks = [cron.schedule('*/5 * * * *', () => runJob('poll', poll)), cron.schedule('30 22 * * *', () => runJob('nightly', async () => { await prices(); await stockTags(); await tagSeries(); await measure(); await backfill(); await summaries(); }), { timezone: 'America/New_York' }), cron.schedule('0 8 * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }), cron.schedule('15 * * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }), cron.schedule('0 * * * *', () => runJob('enrich', async () => { await stockTags(); await tagSeries(); await summaries(); }))];
    void runJob('poll', poll);
    void runJob('bootstrap', async () => { await prices(); await measure(); await runJob('briefings', briefings); await stockTags(); await tagSeries(); });
    return tasks;
}
