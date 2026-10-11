import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), exposure: vi.fn(), moves: vi.fn(), holdings: vi.fn(), convert: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query, pool: {}, aiPool: { connect: mocks.connect } }));
vi.mock('../services/exposure.ts', () => ({ exposure: mocks.exposure }));
vi.mock('../services/moves.ts', () => ({ moves: mocks.moves }));
vi.mock('../services/holdings.ts', async original => ({
    ...await original<typeof import('../services/holdings.ts')>(), getHoldings: mocks.holdings
}));
vi.mock('@elevenlabs/elevenlabs-js', () => ({ ElevenLabsClient: class { textToSpeech = { convertWithTimestamps: mocks.convert }; } }));
import { briefing, briefingResponse, briefings } from './briefing.ts';

const cache = new Map<string, { value: unknown; created_at: Date }>();
const portfolio = () => ({ holdings: [{ symbol: 'AAPL', valueUsd: 100 }], manualHoldings: [{ symbol: 'AAPL', valueUsd: 100 }], brokerageHoldings: [], sandbox: false, asOf: '2026-10-12T12:00:00Z' });
// The voice service's reply: the audio, and each character of the text with when it is spoken (a tenth of a second each).
const spoken = (text: string) => ({ audioBase64: 'AQID', alignment: { characters: [...text], characterStartTimesSeconds: [...text].map((_, i) => i / 10), characterEndTimesSeconds: [...text].map((_, i) => (i + 1) / 10) } });
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
    mocks.convert.mockImplementation(async (_voice: string, request: { text: string }) => spoken(request.text));
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
it('does not generate before 8 a.m., keeps one briefing for the day and makes a new one the next day', async () => {
    vi.setSystemTime(new Date('2026-10-12T11:59:00Z'));
    await briefing('session'); expect(mocks.holdings).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z')); await briefing('session');
    const monday = await briefingResponse('session');
    expect([monday.date, monday.today]).toEqual(['2026-10-12', '2026-10-12']);
    // Later the same day: the stored briefing is the day's, and the voice service is not asked again.
    vi.setSystemTime(new Date('2026-10-12T20:00:00Z')); await briefing('session'); await briefing('session', true);
    expect(mocks.convert).toHaveBeenCalledTimes(1);
    expect(await briefingResponse('session')).toEqual({ ...monday });
    // The next morning, before 8 a.m. New York: still Monday's, and the screen can say so.
    vi.setSystemTime(new Date('2026-10-13T11:00:00Z')); await briefing('session');
    expect(mocks.convert).toHaveBeenCalledTimes(1);
    expect(await briefingResponse('session')).toMatchObject({ date: '2026-10-12', today: '2026-10-13' });
    // After 8 a.m. the day's own briefing replaces it: one request, and still one stored briefing.
    mocks.moves.mockResolvedValue({ date: '2026-10-12', total: -4, fromMarket: -1, beyondMarket: -3, movedEvents: [], unpricedValue: 0, asOf: portfolio().asOf });
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); await briefing('session');
    expect(mocks.convert).toHaveBeenCalledTimes(2);
    const tuesday = await briefingResponse('session');
    expect([tuesday.date, tuesday.today]).toEqual(['2026-10-13', '2026-10-13']);
    expect(tuesday.text).toContain('October 12, 2026 session down 4.00 dollars');
    expect(cache.size).toBe(1);
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
    await briefing('session', true); expect(mocks.convert).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
});
it('rejects empty audio and keeps it out of the cache', async () => {
    mocks.convert.mockResolvedValue({ audioBase64: '' });
    await expect(briefing('session', true)).rejects.toThrow('Voice service returned empty audio');
    expect(cache.size).toBe(0);
});
it('stores each sentence with when it is spoken and the screen that shows its figure', async () => {
    await briefing('session');
    const saved = await briefingResponse('session');
    const parts = saved.parts!;
    expect(parts.map(part => part.text).join(' ')).toBe(saved.text);
    expect(parts[0]).toEqual({ text: 'Good morning.', start: 0, end: 1.3 });
    // A space separates sentences, so the next one starts a character after the last ended.
    expect(parts[1]).toEqual({ text: 'Your portfolio ended the October 9, 2026 session up 10.00 dollars.', start: 1.4, end: 8, source: { label: 'Moves', href: '#moves' } });
    expect(parts[2].source).toEqual({ label: 'Moves', href: '#moves' });
    for (let i = 1; i < parts.length; i++) expect(parts[i].start!).toBeGreaterThan(parts[i - 1].end!);
    // The whole text went to the voice service in one request, and nothing but the text.
    expect(mocks.convert).toHaveBeenCalledWith('voice', { text: saved.text, modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128' }, expect.objectContaining({ maxRetries: 0 }));
});
it('shows the transcript without times when the timings do not match the text', async () => {
    mocks.convert.mockImplementation(async (_voice: string, request: { text: string }) => ({ ...spoken(request.text.replace('Good morning.', 'Good morning!')), audioBase64: 'AQID' }));
    await briefing('session');
    const saved = await briefingResponse('session');
    expect(saved.audioUrl).toContain('/api/briefing/audio?v=');
    expect(saved.parts!.every(part => part.start === null && part.end === null)).toBe(true);
    expect(saved.parts![1].source).toEqual({ label: 'Moves', href: '#moves' });
    // No audio at all (no voice key): the sentences and their sources are still stored.
    vi.stubEnv('ELEVENLABS_API_KEY', ''); cache.clear();
    await briefing('session', true);
    expect(await briefingResponse('session')).toMatchObject({ audioUrl: null, parts: expect.arrayContaining([{ text: 'Good morning.', start: null, end: null }]) });
});
it('makes the morning briefing for accounts, and leaves a guest to ask for one', async () => {
    await briefings();
    const sql = mocks.query.mock.calls.map(([text]) => String(text)).find(text => text.includes('portfolio_holdings'))!;
    expect(sql).toContain("session_id LIKE 'user:%'");
});
