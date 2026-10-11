import { query } from '../db.ts';

const stopped = new Set<string>();
const pending = new Map<string, Promise<unknown>>();

/** Background work gets one attempt per supplied data identity. Failures remain
 * stopped across schedules/restarts; explicit CLI runs can clear these markers.
 */
export async function runWithoutRetry<T>(task: string, produce: () => Promise<T>): Promise<T | undefined> {
    const key = `stopped-task:${task}`;
    if (stopped.has(key)) return undefined;
    const running = pending.get(key);
    if (running) return running as Promise<T | undefined>;
    const work = (async () => {
        if ((await query('SELECT name FROM job_state WHERE name=$1', [key])).length) { stopped.add(key); return undefined; }
        try { return await produce(); }
        catch (error) {
            stopped.add(key);
            try { await query("INSERT INTO job_state(name,cursor) VALUES($1,'failed') ON CONFLICT DO NOTHING", [key]); }
            catch { /* Keep stopped in memory when storage is unavailable. */ }
            throw error;
        }
    })();
    pending.set(key, work);
    try { return await work; }
    finally { pending.delete(key); }
}
