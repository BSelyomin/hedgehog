import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), exposure: vi.fn(), moves: vi.fn(), holdings: vi.fn(), convert: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query, pool: {}, aiPool: { connect: mocks.connect } }));
vi.mock('../services/exposure.ts', () => ({ exposure: mocks.exposure }));
vi.mock('../services/moves.ts', () => ({ moves: mocks.moves }));
vi.mock('../services/holdings.ts', async original => ({
    ...await original<typeof import('../services/holdings.ts')>(), getHoldings: mocks.holdings
}));
vi.mock('@elevenlabs/elevenlabs-js', () => ({ ElevenLabsClient: class { textToSpeech = { convert: mocks.convert }; } }));
import { briefing, briefingResponse } from './briefing.ts';

const cache = new Map<string, { value: unknown; created_at: Date }>();
const portfolio = () => ({ holdings: [{ symbol: 'AAPL', valueUsd: 100 }], manualHoldings: [{ symbol: 'AAPL', valueUsd: 100 }], brokerageHoldings: [], sandbox: false, asOf: '2026-10-12T12:00:00Z' });
beforeEach(() => {
    vi.resetAllMocks(); cache.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    vi.stubEnv('ELEVENLABS_API_KEY', 'test'); vi.stubEnv('ELEVENLABS_VOICE_ID', 'voice');
    mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
    mocks.query.mockImplementation(async (sql: string, values: unknown[]) => sql.includes('FROM ai_cache') ? [cache.get(String(values[1]))].filter(Boolean) : []);
    mocks.clientQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
        if (sql.includes('FROM ai_cache')) return { rows: [cache.get(String(values[1]))].filter(Boolean) };
        if (sql.includes('INSERT INTO ai_cache')) {
            const row = { value: JSON.parse(String(values[2])), created_at: new Date() };
            cache.set(String(values[1]), row); return { rows: [row] };
        }
        return { rows: [] };
    });
    mocks.holdings.mockResolvedValue(portfolio());
    mocks.exposure.mockResolvedValue({ holdings: portfolio().holdings, events: [], asOf: portfolio().asOf });
    mocks.moves.mockResolvedValue({ date: '2026-10-09', total: 10, fromMarket: 5, beyondMarket: 5, movedEvents: [], unpricedValue: 0, asOf: portfolio().asOf });
    mocks.convert.mockResolvedValue((async function* () { yield new Uint8Array([1, 2, 3]); })());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('uses the completed session resolver on Monday and stores source date plus audio once', async () => {
    await briefing('session');
    expect(mocks.moves).toHaveBeenCalledWith('session', undefined, expect.objectContaining({ holdings: portfolio().holdings }));
    const saved = await briefingResponse('session');
    expect(saved.date).toBe('2026-10-12');
    expect(saved.text).toContain('October 9, 2026');
    expect(saved.audioUrl).toContain('/api/briefing/audio?v=');
    expect(mocks.release).toHaveBeenCalled();
});
it('does not generate before 8 a.m. and reuses cached audio on later days', async () => {
    vi.setSystemTime(new Date('2026-10-12T11:59:00Z'));
    await briefing('session'); expect(mocks.holdings).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z')); await briefing('session');
    const saved = await briefingResponse('session');
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); await briefing('session');
    expect(mocks.convert).toHaveBeenCalledTimes(1);
    expect(await briefingResponse('session')).toEqual(saved);
});
it('coalesces concurrent generators through the cache and releases its database client', async () => {
    await Promise.all([briefing('session', true), briefing('session', true)]);
    expect(mocks.convert).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), expect.any(Array));
    expect(mocks.release).toHaveBeenCalledTimes(1);
});
it('rolls back after a voice failure, releases the lock and allows retry', async () => {
    mocks.convert.mockRejectedValueOnce(new Error('Voice unavailable'));
    await expect(briefing('session', true)).rejects.toThrow('Voice unavailable');
    expect(cache.size).toBe(0);
    expect(mocks.clientQuery).toHaveBeenCalledWith('ROLLBACK'); expect(mocks.release).toHaveBeenCalled();
    await briefing('session', true);
    expect((await briefingResponse('session')).audioUrl).toContain('/api/briefing/audio?v=');
});
it('explicit refresh prepares a missing snapshot before the cutoff and preserves saved audio for unchanged holdings', async () => {
    vi.setSystemTime(new Date('2026-10-12T11:00:00Z'));
    await briefing('session', true);
    const saved = await briefingResponse('session');
    mocks.convert.mockRejectedValue(new Error('Voice unavailable'));
    await briefing('session', true);
    expect(mocks.convert).toHaveBeenCalledTimes(1);
    expect(await briefingResponse('session')).toEqual(saved);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('DELETE'))).toBe(false);
});
it('market changes reuse audio while changed holding terms generate a new snapshot', async () => {
    await briefing('session', true);
    mocks.moves.mockResolvedValue({ date: '2026-10-09', total: 20, fromMarket: 10, beyondMarket: 10, movedEvents: [], unpricedValue: 0, asOf: portfolio().asOf });
    await briefing('session', true); expect(mocks.convert).toHaveBeenCalledTimes(1);
    const changed = portfolio(); changed.holdings[0].valueUsd = 200; changed.manualHoldings[0].valueUsd = 200;
    mocks.holdings.mockResolvedValue(changed);
    mocks.exposure.mockResolvedValue({ holdings: changed.holdings, events: [], asOf: changed.asOf });
    // Every conversion gets its own stream; a previously consumed stream is not reusable.
    mocks.convert.mockImplementation(async () => (async function* () { yield new Uint8Array([1, 2, 3]); })());
    await briefing('session', true); expect(mocks.convert).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
});
it('rejects empty audio and keeps it out of the cache', async () => {
    mocks.convert.mockResolvedValue((async function* () {})());
    await expect(briefing('session', true)).rejects.toThrow('Voice service returned empty audio');
    expect(cache.size).toBe(0);
});
