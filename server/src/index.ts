import { createApp } from './app.ts';
import { pool } from './db.ts';
import { databaseReadOnly, migrate, pendingMigrations } from './migrate.ts';
import { scheduler } from './jobs/scheduler.ts';
const app = createApp();
try {
    if (!process.env.DATABASE_URL)
        throw new Error('DATABASE_URL required');
    let tasks: ReturnType<typeof scheduler> = [];
    let recheck: ReturnType<typeof setInterval> | undefined;
    // Migrations and scheduled jobs write. They start as soon as the database accepts writes.
    const startWriting = async () => { await migrate(); tasks = scheduler(); };
    if (await databaseReadOnly()) {
        const pending = await pendingMigrations();
        console.warn('Database is read-only. Serving stored data; migrations, scheduled jobs and saving changes are off until it accepts writes.');
        if (pending.length)
            console.warn('Migrations waiting for a writable database:', pending.join(', '));
        let starting = false;
        recheck = setInterval(() => {
            if (starting)
                return;
            starting = true;
            void (async () => {
                if (await databaseReadOnly())
                    return;
                await startWriting();
                clearInterval(recheck);
                console.log('Database accepts writes again; migrations applied and jobs started');
            })().catch(() => console.warn('Could not start jobs yet; trying again in a minute')).finally(() => { starting = false; });
        }, 60000);
    }
    else
        await startWriting();
    const server = app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0', () => console.log('Hedgehog API listening'));
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () => { clearInterval(recheck); tasks.forEach(t => t.stop()); server.close(() => { void pool.end(); }); });
}
catch {
    console.error('Startup failed. Set DATABASE_URL and ensure TimescaleDB is reachable.');
    await pool.end();
    process.exitCode = 1;
}
