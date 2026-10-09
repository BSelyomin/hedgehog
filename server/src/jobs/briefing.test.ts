import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), exposure: vi.fn(), moves: vi.fn(), convert: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query, pool: { connect: mocks.connect } }));
vi.mock('../services/exposure.ts', () => ({ exposure: mocks.exposure }));
vi.mock('../services/moves.ts', () => ({ moves: mocks.moves }));
vi.mock('@elevenlabs/elevenlabs-js', () => ({ ElevenLabsClient: class {textToSpeech = {convert: mocks.convert};} }));
import { briefing } from './briefing.ts';
beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    vi.stubEnv('ELEVENLABS_API_KEY','test'); vi.stubEnv('ELEVENLABS_VOICE_ID','voice');
    mocks.connect.mockResolvedValue({query:mocks.clientQuery,release:mocks.release});
    mocks.clientQuery.mockResolvedValue({rows:[{locked:true}]});
    mocks.query.mockImplementation(async (sql: string) => sql.includes('max(ts)') ? [{date:'2026-10-09'}] : []);
    mocks.exposure.mockResolvedValue({holdings:[{symbol:'AAPL',valueUsd:100}],events:[],asOf:null});
    mocks.moves.mockResolvedValue({date:'2026-10-09',total:null,fromMarket:null,beyondMarket:null,oddsMoves:[],asOf:null});
    mocks.convert.mockResolvedValue((async function*(){yield new Uint8Array([1,2,3]);})());
});
afterEach(() => {vi.useRealTimers();vi.unstubAllEnvs();});
it('uses Friday prices for Monday morning and stores one local-day MP3', async () => {
    await briefing('session');
    expect(mocks.moves).toHaveBeenCalledWith('session','2026-10-09');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('ts::date<$1::date'),['2026-10-12']);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO briefings'),expect.arrayContaining(['session','2026-10-12',expect.any(Buffer)]));
    expect(mocks.release).toHaveBeenCalled();
});
it('does not generate before 8 a.m. or regenerate cached audio', async () => {
    vi.setSystemTime(new Date('2026-10-12T11:59:00Z'));await briefing('session');expect(mocks.connect).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));mocks.query.mockResolvedValue([{audio:Buffer.from('cached'),text:'Existing briefing'}]);
    await briefing('session');expect(mocks.convert).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalled();
});
it('skips a concurrent generator', async () => {
    mocks.clientQuery.mockResolvedValue({rows:[{locked:false}]});await briefing('session');expect(mocks.convert).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalled();
});
it('releases the lock after a voice failure and leaves the cache eligible for retry', async () => {
    mocks.convert.mockRejectedValue(new Error('Voice unavailable'));await expect(briefing('session')).rejects.toThrow('Voice unavailable');
    expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO briefings'))).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'),expect.any(Array));expect(mocks.release).toHaveBeenCalled();
});
