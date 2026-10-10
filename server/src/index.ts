import { createApp } from './app.ts';
import { closePools } from './db.ts';
import { migrate } from './migrate.ts';
import { scheduler } from './jobs/scheduler.ts';
const app = createApp();
try {
    if (!process.env.DATABASE_URL)
        throw new Error('DATABASE_URL required');
    await migrate();
    const tasks = scheduler();
    const server = app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0', () => console.log('Hedgehog API listening'));
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () => { tasks.forEach(t => t.stop()); server.close(() => { void closePools(); }); });
}
catch {
    console.error('Startup failed. Set DATABASE_URL and ensure TimescaleDB is reachable.');
    await closePools();
    process.exitCode = 1;
}
