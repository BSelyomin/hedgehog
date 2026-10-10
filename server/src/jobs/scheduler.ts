import cron from 'node-cron';
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
import { oddsCandles } from './odds-candles.ts';
const reportDates = () => earningsDates().catch(() => console.warn('Earnings report dates unavailable'));
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
    const tasks = [cron.schedule('*/5 * * * *', () => runJob('poll', poll)), cron.schedule('30 22 * * *', () => runJob('nightly', async () => { await stockTags(); await tagSeries(); await backfill(); await summaries(); await briefings(); }), { timezone: 'America/New_York' }), cron.schedule('0 8 * * *', () => runJob('briefings', briefings), { timezone: 'America/New_York' }), cron.schedule('0 * * * *', () => runJob('enrich', async () => { await stockTags(); await tagSeries(); await summaries(); await briefings(); }))];
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
