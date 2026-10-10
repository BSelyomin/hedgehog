import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: { query: vi.fn(), release: vi.fn() } }));
vi.mock('../db.ts', () => ({ pool: { connect: async () => mocks.client }, query: vi.fn() }));
// The scheduler imports every job; none of them runs here.
vi.mock('./poll.ts', () => ({ poll: vi.fn() }));
vi.mock('./prices.ts', () => ({ prices: vi.fn() }));
vi.mock('./tagging.ts', () => ({ stockTags: vi.fn(), tagSeries: vi.fn() }));
vi.mock('./measure.ts', () => ({ measure: vi.fn() }));
vi.mock('./summaries.ts', () => ({ summaries: vi.fn() }));
vi.mock('./briefing.ts', () => ({ briefings: vi.fn() }));
vi.mock('./backfill.ts', () => ({ backfill: vi.fn() }));
vi.mock('./earnings-dates.ts', () => ({ earningsDates: vi.fn() }));
vi.mock('./odds-candles.ts', () => ({ oddsCandles: vi.fn() }));
vi.mock('./profiles.ts', () => ({ profiles: vi.fn() }));
vi.mock('../brokerages/service.ts', () => ({ syncBrokerages: vi.fn() }));
import { HEARTBEAT_MS, LOCK_SECONDS, runJob } from './scheduler.ts';

const statements = () => mocks.client.query.mock.calls.map(([sql]) => String(sql));
const database = (locked: boolean) => mocks.client.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('pg_try_advisory_lock') ? [{ locked }] : [] }));
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
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
    expect(console.warn).toHaveBeenCalledWith('Job failed; will retry:', 'measure');
    expect(statements()).toContain('SELECT pg_advisory_unlock(hashtext($1))');
    expect(mocks.client.release).toHaveBeenCalledExactlyOnceWith();
});
it('discards the connection, without throwing, when the server has already ended the session', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
        if (sql.includes('pg_advisory_unlock')) throw new Error('terminating connection due to idle-session timeout');
        return { rows: [{ locked: true }] };
    });
    await expect(runJob('poll', async () => {})).resolves.toBeUndefined();
    expect(mocks.client.release).toHaveBeenCalledExactlyOnceWith(true);
});
