import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), client: { query: vi.fn(), release: vi.fn() } }));
vi.mock('../db.ts', () => ({ pool: { connect: async () => mocks.client }, query: mocks.query }));
// The scheduler imports every job; none of them runs here.
vi.mock('node-cron', () => ({ default: { schedule: vi.fn(() => ({ stop: vi.fn() })) } }));
vi.mock('./poll.ts', () => ({ poll: vi.fn() }));
vi.mock('./prices.ts', () => ({ prices: vi.fn() }));
vi.mock('./tagging.ts', () => ({ stockTags: vi.fn(), tagSeries: vi.fn() }));
vi.mock('./measure.ts', () => ({ measure: vi.fn() }));
vi.mock('./summaries.ts', () => ({ summaries: vi.fn() }));
vi.mock('./briefing.ts', () => ({ briefings: vi.fn() }));
vi.mock('./backfill.ts', () => ({ backfill: vi.fn(), backfillTimeframes: vi.fn() }));
vi.mock('./track-entities.ts', () => ({ trackEntities: vi.fn() }));
vi.mock('./earnings-dates.ts', () => ({ earningsDates: vi.fn() }));
vi.mock('./odds-candles.ts', () => ({ oddsCandles: vi.fn() }));
vi.mock('./profiles.ts', () => ({ profiles: vi.fn() }));
vi.mock('../brokerages/service.ts', () => ({ syncBrokerages: vi.fn() }));
import { HEARTBEAT_MS, LATE_TICK_MS, LOCK_SECONDS, RETRYING_JOBS, runJob, scheduler } from './scheduler.ts';
import cron from 'node-cron';
import { backfill, backfillTimeframes } from './backfill.ts';
import { summaries } from './summaries.ts';

const statements = () => mocks.client.query.mock.calls.map(([sql]) => String(sql));
const database = (locked: boolean) => mocks.client.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('pg_try_advisory_lock') ? [{ locked }] : [] }));
beforeEach(() => { mocks.query.mockReset().mockResolvedValue([]); vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocks.client.query.mockReset(); mocks.client.release.mockReset(); });

it('asks the server to end the lock’s session if it goes quiet, and keeps it alive while the job runs', async () => {
    database(true);
    let finish = () => {};
    const running = runJob('poll', () => new Promise<void>(done => { finish = done; }));
    await vi.advanceTimersByTimeAsync(0);
    // The timeout is set before the lock is taken, so there is no moment a dead backend could hold it for long.
    expect(statements()).toEqual([`SET idle_session_timeout = '${LOCK_SECONDS}s'`, 'SELECT pg_try_advisory_lock(hashtext($1)) locked']);
    expect(mocks.client.query.mock.calls[1][1]).toEqual(['hedgehog:poll']);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(statements().filter(sql => sql === 'SELECT 1')).toHaveLength(3);
    // The heartbeat comes round well inside the timeout.
    expect(HEARTBEAT_MS * 3).toBeLessThan(LOCK_SECONDS * 1000);
    finish();
    await running;
    expect(statements().slice(-2)).toEqual(['SELECT pg_advisory_unlock(hashtext($1))', 'RESET idle_session_timeout']);
    expect(mocks.client.release).toHaveBeenCalledExactlyOnceWith();
    // No heartbeat is left running once the job is done.
    const sent = statements().length;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 4);
    expect(statements()).toHaveLength(sent);
});
it('does not run a job another backend holds, and still hands back a clean connection', async () => {
    database(false);
    const job = vi.fn();
    await runJob('poll', job);
    expect(job).not.toHaveBeenCalled();
    expect(statements()).toEqual([`SET idle_session_timeout = '${LOCK_SECONDS}s'`, 'SELECT pg_try_advisory_lock(hashtext($1)) locked', 'RESET idle_session_timeout']);
    expect(mocks.client.release).toHaveBeenCalledExactlyOnceWith();
});
it('releases the lock when the job fails', async () => {
    database(true);
    await runJob('measure', async () => { throw new Error('boom'); });
    expect(console.warn).toHaveBeenCalledWith('Job stopped after failure; automatic retries disabled:', 'measure');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO job_state'), ['stopped-job:measure']);
    expect(statements()).toContain('SELECT pg_advisory_unlock(hashtext($1))');
    expect(mocks.client.release).toHaveBeenCalledExactlyOnceWith();
    const retry = vi.fn();
    await runJob('measure', retry);
    expect(retry).not.toHaveBeenCalled();
});
it('discards the connection, without throwing, when the server has already ended the session', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
        if (sql.includes('pg_advisory_unlock')) throw new Error('terminating connection due to idle-session timeout');
        return { rows: [{ locked: true }] };
    });
    await expect(runJob('poll', async () => {})).resolves.toBeUndefined();
    expect(mocks.client.release).toHaveBeenCalledExactlyOnceWith(true);
});

it('runs a Kalshi data job again after it fails, and does not obey a stop marker left for it', async () => {
    expect([...RETRYING_JOBS].sort()).toEqual(['odds-candles', 'poll', 'track-record']);
    database(true);
    for (const name of RETRYING_JOBS) {
        let attempts = 0;
        const failing = async () => { attempts++; throw new Error('Kalshi retry limit'); };
        await runJob(name, failing);
        await runJob(name, failing);
        expect([name, attempts]).toEqual([name, 2]);
        expect(console.warn).toHaveBeenCalledWith('Job failed; it runs again at its next schedule:', name);
    }
    // Nothing was stored to stop them, and the marker was never asked for.
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('job_state'))).toBe(false);
    // A marker written by a backend on older code changes nothing.
    mocks.query.mockResolvedValue([{ name: 'stopped-job:poll' }]);
    const job = vi.fn();
    await runJob('poll', job);
    expect(job).toHaveBeenCalledTimes(1);
});
it('still stops a job that calls AI, voice or a brokerage after one failure', async () => {
    database(true);
    // The nightly AI work is one of them; it is left running here for the test of the schedules below.
    expect(['nightly', 'enrich', 'briefings', 'brokerages', 'price-history', 'bootstrap'].some(name => RETRYING_JOBS.has(name))).toBe(false);
    for (const name of ['enrich', 'briefings', 'brokerages']) {
        let attempts = 0;
        const failing = async () => { attempts++; throw new Error('provider'); };
        await runJob(name, failing);
        await runJob(name, failing);
        expect([name, attempts]).toEqual([name, 1]);
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO job_state'), [`stopped-job:${name}`]);
    }
});
it('runs a tick that fires late, and keeps the track record apart from the nightly AI work', async () => {
    database(true);
    const schedule = vi.mocked(cron.schedule);
    schedule.mockClear();
    scheduler();
    await vi.advanceTimersByTimeAsync(0);
    // Every schedule tolerates a late timer; the library's own limit is one second.
    expect(schedule.mock.calls.length).toBeGreaterThanOrEqual(10);
    for (const [expression, , options] of schedule.mock.calls)
        expect([expression, options?.missedExecutionTolerance]).toEqual([expression, LATE_TICK_MS]);
    expect(LATE_TICK_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(schedule.mock.calls.filter(([, , options]) => options?.timezone === 'America/New_York').map(([expression]) => expression).sort()).toEqual(['0 8 * * *', '15 * * * *', '20 0 * * *', '30 22 * * *', '30 22 * * *', '45 22 * * *']);
    // 10:45 pm runs the backfill and then the other timeframes, under the retrying job; 10:30 pm runs the AI work without them.
    vi.mocked(backfill).mockClear(); vi.mocked(backfillTimeframes).mockClear(); vi.mocked(summaries).mockClear();
    const at = (expression: string) => schedule.mock.calls.filter(([e]) => e === expression).map(([, task]) => task as () => Promise<void>);
    await at('45 22 * * *')[0]();
    expect(backfill).toHaveBeenCalledTimes(1);
    // The timeframes ask only about what is unanswered, so they need no nightly limit.
    expect(backfillTimeframes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(backfill).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(backfillTimeframes).mock.invocationCallOrder[0]);
    expect(summaries).not.toHaveBeenCalled();
    vi.mocked(backfill).mockClear();
    for (const task of at('30 22 * * *')) await task();
    expect(summaries).toHaveBeenCalledTimes(1);
    expect(backfill).not.toHaveBeenCalled();
});
