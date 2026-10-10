import { cachedAI, readAI } from '../services/ai-cache.ts';
import type { BriefingResponse } from '../../../shared/types.ts';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { query } from '../db.ts';
import { exposure } from '../services/exposure.ts';
import { moves } from '../services/moves.ts';
import { getHoldings, portfolioRevision } from '../services/holdings.ts';
import { numbersSupported } from '../services/ai-guard.ts';
export async function briefing(session: string) {
    const date = new Date().toISOString().slice(0, 10);
    const sourcePortfolio = await getHoldings(session);
    const identity = briefingIdentity(session, sourcePortfolio);
    if (await readAI<BriefingSnapshot>('briefing-v1', identity)) return;
    const portfolio = await exposure(session);
    const move = await moves(session, undefined, portfolio);
    const events = { events: portfolio.events.filter(e => Date.parse(e.closeTime) <= Date.now() + 7 * 86400000) };
    const snapshotAsOf = portfolio.asOf ?? move.asOf ?? sourcePortfolio.asOf;
    if (!portfolio.holdings.length || !snapshotAsOf)
        return;
    // Do not attach a snapshot to an older portfolio if a save/sync raced the reads.
    if (portfolioRevision(await getHoldings(session)) !== portfolioRevision(sourcePortfolio) ||
        JSON.stringify(portfolio.holdings) !== JSON.stringify(sourcePortfolio.holdings)) return;
    const top = [...events.events].sort((a, b) => b.share - a.share).slice(0, 3);
    const facts = { events: top.map(e => ({ title: e.title, share: Math.round(e.share * 100) })), priceDate: move.date, total: move.total === null ? null : move.total.toFixed(2), fromMarket: move.fromMarket === null ? null : move.fromMarket.toFixed(2), beyondMarket: move.beyondMarket === null ? null : move.beyondMarket.toFixed(2), biggest: move.oddsMoves[0] ? { title: move.oddsMoves[0].title, change: move.oddsMoves[0].changePoints.toFixed(1) } : null };
    const text = `Your Hedgehog briefing. ${sourcePortfolio.sandbox ? 'This portfolio includes simulated SnapTrade sandbox holdings. ' : ''}${facts.events.length ? facts.events.map(e => `${e.title} reaches ${e.share} percent of your portfolio.`).join(' ') : 'No linked events resolve this week.'} ${facts.total !== null ? `The dollar move for ${facts.priceDate} is ${facts.total}.` : 'The daily move is not available yet.'} ${facts.fromMarket !== null ? `The estimated market component is ${facts.fromMarket} dollars and the remainder is ${facts.beyondMarket} dollars.` : ''} ${facts.biggest ? `${facts.biggest.title} moved ${facts.biggest.change} points on the same day.` : ''} Reach measures linked holdings, not predicted losses. Not financial advice. Odds from Kalshi.`;
    if (!numbersSupported(text, facts))
        throw new Error('Briefing number check failed');
    await cachedAI<BriefingSnapshot>('briefing-v1', identity, async () => {
        let audio: Buffer | null = null;
        if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
            const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
            const stream = await client.textToSpeech.convert(process.env.ELEVENLABS_VOICE_ID, { text, modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128' }, { timeoutInSeconds: 60, maxRetries: 0, abortSignal: AbortSignal.timeout(60000) });
            const chunks: Uint8Array[] = [];
            for await (const chunk of stream)
                chunks.push(chunk);
            audio = Buffer.concat(chunks);
        }
        return { date, text, audio: audio?.toString('base64') ?? null, asOf: snapshotAsOf };
    });
}
export async function briefings() { const sessions = await query<{
    session_id: string;
}>('SELECT DISTINCT session_id FROM portfolio_holdings'); for (const s of sessions)
    try {
        await briefing(s.session_id);
    }
    catch {
        console.warn('Briefing unavailable for one session');
    } }

interface BriefingSnapshot { date: string; text: string; audio: string | null; asOf: string | null }

function briefingIdentity(session: string, portfolio: Awaited<ReturnType<typeof getHoldings>>) {
    return { session, portfolio: portfolioRevision(portfolio), voice: process.env.ELEVENLABS_VOICE_ID ?? '',
        enabled: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID), model: 'eleven_multilingual_v2' };
}

export async function savedBriefing(session: string) {
    return readAI<BriefingSnapshot>('briefing-v1', briefingIdentity(session, await getHoldings(session)));
}

export async function briefingResponse(session: string): Promise<BriefingResponse> {
    const saved = await savedBriefing(session), row = saved?.value;
    return { date: row?.date ?? new Date().toISOString().slice(0, 10), text: row?.text ?? null,
        audioUrl: row?.audio ? `/api/briefing/audio?v=${encodeURIComponent(saved!.createdAt)}` : null,
        asOf: row?.asOf ?? null, generatedAt: saved?.createdAt ?? null };
}
