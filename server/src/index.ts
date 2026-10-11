import { createApp } from './app.ts';
import { closePools } from './db.ts';
import { databaseReadOnly, migrate, pendingMigrations } from './migrate.ts';
import { scheduler } from './jobs/scheduler.ts';
const app = createApp();
try {
    if (!process.env.DATABASE_URL)
        throw new Error('DATABASE_URL required');
    let tasks: ReturnType<typeof scheduler> = [];
    // Migrations and scheduled jobs write. A read-only database serves saved data;
    // recovery is explicit, so there is no automatic migration/job retry loop.
    const startWriting = async () => { await migrate(); tasks = scheduler(); };
    if (await databaseReadOnly()) {
        const pending = await pendingMigrations();
        console.warn('Database is read-only. Serving stored data; migrations, scheduled jobs and saving changes are off. Restart the backend after restoring writes.');
        if (pending.length)
            console.warn('Migrations waiting for a writable database:', pending.join(', '));
    }
    else
        await startWriting();
    const server = app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0', () => console.log('Hedgehog API listening'));
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () => { tasks.forEach(t => t.stop()); server.close(() => { void closePools(); }); });
}
catch {
    console.error('Startup failed. Set DATABASE_URL and ensure TimescaleDB is reachable.');
    await closePools();
    process.exitCode = 1;
}
