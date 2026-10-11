import pg from 'pg';
import { timedQuery } from './services/request-timing.ts';
const connection = { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000,
    statement_timeout: 20000, query_timeout: 25000 };
export const pool = new pg.Pool({ ...connection, max: 10 });
// External AI calls can take a minute. Their transaction locks must not consume
// the connections needed to read exposure, moves, or an existing cached result.
export const aiPool = new pg.Pool({ ...connection, max: 2, allowExitOnIdle: true });
for (const db of [pool, aiPool]) db.on('error', () => console.warn('Idle database connection failed; reconnecting on the next request'));
export async function closePools() { await Promise.all([pool.end(), aiPool.end()]); }
type QueryOperation = 'query' | 'session' | 'holdings' | 'brokerage_holdings' | 'exposure_quotes'
    | 'forecast_candidates' | 'forecast_quotes' | 'prices' | 'track_record';
export async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = [], operation: QueryOperation = 'query'): Promise<T[]> {
    const started = performance.now();
    try { return (await timedQuery(() => pool.query<T>(sql, values))).rows; }
    catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        // Identify the failing work and pool pressure without logging SQL, parameters,
        // connection strings, provider payloads or personal portfolio information.
        console.warn('[Database] query_failed', { operation,
            code: typeof code === 'string' && /^[A-Z0-9_]{5,24}$/.test(code) ? code : 'UNAVAILABLE',
            elapsedMs: Math.round(performance.now() - started),
            totalConnections: pool.totalCount, idleConnections: pool.idleCount, waitingRequests: pool.waitingCount });
        throw error;
    }
}
export const iso = (value: Date | string | null | undefined): string | null => value ? new Date(value).toISOString() : null;
