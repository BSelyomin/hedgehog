import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

interface Timing { started: number; stages: Map<string, number>; queries: number; sqlMs: number }
const context = new AsyncLocalStorage<Timing>();

// Only timings and counts are exposed: never SQL, symbols, credentials or user IDs.
export const movesTiming: RequestHandler = (req, res, next) => {
    if (req.path !== '/moves') { next(); return; }
    const timing: Timing = { started: performance.now(), stages: new Map(), queries: 0, sqlMs: 0 };
    const json = res.json;
    res.json = function (body) {
        const entries = [`backend;dur=${(performance.now() - timing.started).toFixed(1)}`,
            ...[...timing.stages].map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`),
            `sql_total;dur=${timing.sqlMs.toFixed(1)};desc="Cumulative query time, including waits"`,
            `sql_count;desc="${timing.queries} queries"`];
        res.set('Server-Timing', entries.join(', '));
        return json.call(this, body);
    };
    context.run(timing, next);
};

export async function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
    const timing = context.getStore(), start = performance.now();
    try { return await run(); }
    finally { if (timing) timing.stages.set(name, (timing.stages.get(name) ?? 0) + performance.now() - start); }
}

export async function timedQuery<T>(run: () => Promise<T>): Promise<T> {
    const timing = context.getStore(), start = performance.now();
    try { return await run(); }
    finally { if (timing) { timing.queries++; timing.sqlMs += performance.now() - start; } }
}
