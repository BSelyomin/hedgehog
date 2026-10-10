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
export async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> { return (await timedQuery(() => pool.query<T>(sql, values))).rows; }
export const iso = (value: Date | string | null | undefined): string | null => value ? new Date(value).toISOString() : null;
