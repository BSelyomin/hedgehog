import { readdir, readFile } from 'node:fs/promises';
import { pool } from './db.ts';
import { seed } from './seed.ts';
export async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock(724981)');
        await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
        const directory = new URL('../migrations/', import.meta.url);
        for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
            if ((await client.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rowCount)
                continue;
            await client.query('BEGIN');
            try {
                await client.query(await readFile(new URL(name, directory), 'utf8'));
                await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
                await client.query('COMMIT');
            }
            catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
    }
    finally {
        await client.query('SELECT pg_advisory_unlock(724981)');
        client.release();
    }
    await seed();
}
if (process.argv[1]?.endsWith('/migrate.ts')) {
    try {
        await migrate();
        console.log('Migrations applied');
    }
    catch {
        console.error('Migration failed; check database connectivity and TimescaleDB permissions');
        process.exitCode = 1;
    }
    finally {
        await pool.end();
    }
}
