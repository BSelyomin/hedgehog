import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
// The server can drop an idle connection (a restart, a failover, a settings change). The pool
// replaces it; without a listener Node treats the event as fatal and the whole API exits.
pool.on('error', () => console.warn('A database connection was dropped; the pool will reconnect'));
export async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> { return (await pool.query<T>(sql, values)).rows; }
export const iso = (value: Date | string | null | undefined): string | null => value ? new Date(value).toISOString() : null;
