import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KALSHI_ATTEMPTS, kalshi } from './kalshi.ts';

const original = globalThis.fetch;
let statuses: number[], headers: Record<string, string>, calls: number;
beforeEach(() => {
    vi.useFakeTimers(); calls = 0; headers = {};
    globalThis.fetch = (async () => { const status = statuses[Math.min(calls, statuses.length - 1)]; calls++; return new Response(JSON.stringify({ events: [] }), { status, headers }); }) as typeof fetch;
});
afterEach(() => { vi.useRealTimers(); globalThis.fetch = original; });
// Runs a request to its end, letting each wait pass, and says what it came to and how long it waited.
async function settle(request: Promise<unknown>) {
    const outcome = request.then(value => ({ value }), (error: Error) => ({ error: error.message }));
    const started = Date.now();
    await vi.runAllTimersAsync();
    return { ...await outcome, waited: Date.now() - started };
}

it('waits and tries again when Kalshi says too many requests or has a fault of its own', async () => {
    statuses = [429, 503, 200];
    expect(await settle(kalshi('/events'))).toEqual({ value: { events: [] }, waited: 1000 + 2000 });
    expect(calls).toBe(3);
});
it('gives up after five attempts, each wait twice the last', async () => {
    statuses = [429];
    expect(KALSHI_ATTEMPTS).toBe(5);
    expect(await settle(kalshi('/events'))).toEqual({ error: 'Kalshi retry limit', waited: 1000 + 2000 + 4000 + 8000 });
    expect(calls).toBe(5);
});
it('waits as long as Kalshi asks, up to thirty seconds', async () => {
    statuses = [429, 200]; headers = { 'retry-after': '7' };
    expect((await settle(kalshi('/events'))).waited).toBe(7000);
    calls = 0; headers = { 'retry-after': '600' };
    expect((await settle(kalshi('/events'))).waited).toBe(30000);
});
it('does not try again when the request itself is refused', async () => {
    for (const status of [400, 401, 404]) {
        statuses = [status]; calls = 0;
        // The backfill reads "Kalshi HTTP 404" as a market with no archive, so the message is exact.
        expect(await settle(kalshi('/events'))).toEqual({ error: `Kalshi HTTP ${status}`, waited: 0 });
        expect(calls).toBe(1);
    }
});
