import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> { return (await pool.query<T>(sql, values)).rows; }
export const iso = (value: Date | string | null | undefined): string | null => value ? new Date(value).toISOString() : null;
