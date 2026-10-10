import { createHash } from 'node:crypto';
import { aiPool, query } from '../db.ts';

/** Canonical object keys; callers sort arrays whose order is not meaningful. */
export function contentHash(input: unknown): string {
    const canonical = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            if (value instanceof Date) return value.toISOString();
            return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, canonical(item)]));
        }
        return value;
    };
    return createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}

export interface CachedAI<T> { value: T; createdAt: string }
type Row<T> = { value: T; created_at: Date | string };
const entry = <T>(row: Row<T>): CachedAI<T> => ({ value: row.value, createdAt: new Date(row.created_at).toISOString() });

export async function readAI<T>(namespace: string, input: unknown): Promise<CachedAI<T> | null> {
    const rows = await query<Row<T>>('SELECT value,created_at FROM ai_cache WHERE namespace=$1 AND input_hash=$2', [namespace, contentHash(input)]);
    return rows[0] ? entry(rows[0]) : null;
}

const pending = new Map<string, Promise<CachedAI<unknown>>>();

/** Producers perform provider I/O only: do not nest caches or acquire DB clients.
 * Failed calls are never cached. The DB lock also coalesces separate server workers.
 * refresh is for explicit source retrieval, never for bypassing completion/audio caches.
 */
export async function cachedAI<T>(namespace: string, input: unknown, produce: () => Promise<T>, refresh = false): Promise<CachedAI<T>> {
    const hash = contentHash(input), key = `${namespace}:${hash}`;
    const running = pending.get(key);
    if (running) return running as Promise<CachedAI<T>>;
    const task = (async () => {
        const client = await aiPool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
            const { rows } = await client.query<Row<T>>('SELECT value,created_at FROM ai_cache WHERE namespace=$1 AND input_hash=$2', [namespace, hash]);
            if (rows[0] && !refresh) {
                await client.query('COMMIT');
                return entry(rows[0]);
            }
            const value = await produce();
            // Preserve the original timestamp when explicit retrieval returns identical data.
            const saved = await client.query<Row<T>>(`INSERT INTO ai_cache(namespace,input_hash,value) VALUES($1,$2,$3)
                ON CONFLICT(namespace,input_hash) DO UPDATE SET value=excluded.value,created_at=clock_timestamp()
                WHERE ai_cache.value IS DISTINCT FROM excluded.value RETURNING value,created_at`, [namespace, hash, JSON.stringify(value)]);
            await client.query('COMMIT');
            return entry(saved.rows[0] ?? rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    })();
    pending.set(key, task);
    try { return await task; }
    finally { pending.delete(key); }
}
