import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { query } from '../db.ts';
import { calendar, exposure } from '../services/exposure.ts';
import { moves } from '../services/moves.ts';
import { numbersSupported } from '../services/ai-guard.ts';
export async function briefing(session: string) {
    const date = new Date().toISOString().slice(0, 10);
    const cached = await query<{
        audio: Buffer | null;
    }>('SELECT audio FROM briefings WHERE session_id=$1 AND day=$2', [session, date]);
    if (cached[0]?.audio)
        return;
    const [events, move, portfolio] = await Promise.all([calendar(session, 7), moves(session, date), exposure(session)]);
    if (!portfolio.holdings.length || !portfolio.asOf)
        return;
    const top = [...events.events].sort((a, b) => b.share - a.share).slice(0, 3);
    const facts = { events: top.map(e => ({ title: e.title, share: Math.round(e.share * 100) })), total: move.total === null ? null : move.total.toFixed(2), fromMarket: move.fromMarket === null ? null : move.fromMarket.toFixed(2), beyondMarket: move.beyondMarket === null ? null : move.beyondMarket.toFixed(2), biggest: move.oddsMoves[0] ? { title: move.oddsMoves[0].title, change: move.oddsMoves[0].changePoints.toFixed(1) } : null };
    const text = `Your Hedgehog briefing. ${facts.events.length ? facts.events.map(e => `${e.title} reaches ${e.share} percent of your portfolio.`).join(' ') : 'No linked events resolve this week.'} ${facts.total !== null ? `The daily dollar move is ${facts.total}.` : 'The daily move is not available yet.'} ${facts.fromMarket !== null ? `The estimated market component is ${facts.fromMarket} dollars and the remainder is ${facts.beyondMarket} dollars.` : ''} ${facts.biggest ? `${facts.biggest.title} moved ${facts.biggest.change} points on the same day.` : ''} Reach measures linked holdings, not predicted losses. Not financial advice. Odds from Kalshi.`;
    if (!numbersSupported(text, facts))
        throw new Error('Briefing number check failed');
    let audio: Buffer | null = null;
    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
        const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
        const stream = await client.textToSpeech.convert(process.env.ELEVENLABS_VOICE_ID, { text, modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128' });
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream)
            chunks.push(chunk);
        audio = Buffer.concat(chunks);
    }
    await query(`INSERT INTO briefings(session_id,day,text,audio,as_of) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,day) DO UPDATE SET text=excluded.text,audio=excluded.audio,as_of=excluded.as_of`, [session, date, text, audio, portfolio.asOf]);
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
