import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { query, pool } from '../db.ts';
import { exposure } from '../services/exposure.ts';
import { moves } from '../services/moves.ts';
import { briefingDay, buildBriefing, morningReady } from '../services/briefing-content.ts';
export async function briefing(session: string, refresh = false) {
    const now = new Date();
    if (!refresh && !morningReady(now)) return;
    const date = briefingDay(now);
    const client = await pool.connect();
    const lock = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [`briefing:${session}:${date}`])).rows[0].locked;
    if (!lock) { client.release(); if (refresh) throw new Error('Briefing already generating'); return; }
    try {
        const cached = await query<{ audio: Buffer | null; text: string }>(
            'SELECT audio,text FROM briefings WHERE session_id=$1 AND day=$2', [session, date]);
        if (cached[0]?.audio && !refresh) return;
        const portfolio = await exposure(session);
        if (!portfolio.holdings.length) return;
        // Yahoo daily candles can include the current, still-open session. Only use
        // observed SPY sessions before today's New York date; weekends/holidays need no guessing.
        const latest = await query<{ date: string }>(
            "SELECT to_char(max(ts),'YYYY-MM-DD') date FROM prices WHERE symbol='SPY' AND ts::date<$1::date", [date]);
        const move = latest[0]?.date ? await moves(session, latest[0].date) : null;
        const text = buildBriefing(portfolio, move, now);
        let audio: Buffer | null = null;
        if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
            const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
            const stream = await client.textToSpeech.convert(process.env.ELEVENLABS_VOICE_ID, { text, modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128' });
            const chunks: Uint8Array[] = [];
            for await (const chunk of stream)
                chunks.push(chunk);
            audio = Buffer.concat(chunks);
            if (!audio.length) throw new Error('Voice service returned empty audio');
        }
        await query(`INSERT INTO briefings(session_id,day,text,audio,as_of) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,day) DO UPDATE SET text=excluded.text,audio=excluded.audio,as_of=excluded.as_of`, [session, date, text, audio, portfolio.asOf ?? move?.asOf ?? null]);
    } finally {
        try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`briefing:${session}:${date}`]); }
        finally { client.release(); }
    }
}
export async function briefings() { const sessions = await query<{
    session_id: string;
}>('SELECT DISTINCT session_id FROM holdings'); for (const s of sessions)
    try {
        await briefing(s.session_id);
    }
    catch {
        console.warn('Briefing unavailable for one session');
    } }
