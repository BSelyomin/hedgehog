import { waitUntil } from '@vercel/functions';

/** Retain post-response work for the Vercel invocation; Node/Docker stays alive itself. */
export function keepAlive(task: Promise<unknown>): void {
    if (process.env.VERCEL === '1') waitUntil(task);
}
