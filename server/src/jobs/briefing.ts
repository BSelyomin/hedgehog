import { cachedAI, readAI } from '../services/ai-cache.ts';
import type { BriefingResponse } from '../../../shared/types.ts';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { query } from '../db.ts';
import { exposure } from '../services/exposure.ts';
import { moves } from '../services/moves.ts';
import { getHoldings, portfolioRevision } from '../services/holdings.ts';
import { briefingDay, buildBriefing, morningReady } from '../services/briefing-content.ts';
import { contentHash } from '../services/ai-cache.ts';
import { runWithoutRetry } from '../services/no-retry.ts';

interface BriefingSnapshot { date: string; text: string; audio: string | null; asOf: string | null }

export function briefingIdentity(session: string, portfolio: Awaited<ReturnType<typeof getHoldings>>) {
    return { session, portfolio: portfolioRevision(portfolio), voice: process.env.ELEVENLABS_VOICE_ID ?? '',
        enabled: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID), model: 'eleven_multilingual_v2' };
}

// Explicit reload may prepare a missing snapshot before the scheduled morning run.
// It still reuses unchanged holdings; dates and market quotes never invalidate AI/audio.
export async function briefing(session: string, requested = false) {
    const now = new Date();
    if (!requested && !morningReady(now)) return;
    const date = briefingDay(now);
    const sourcePortfolio = await getHoldings(session);
    const identity = briefingIdentity(session, sourcePortfolio);
    if (await readAI<BriefingSnapshot>('briefing-v1', identity)) return;
    const portfolio = await exposure(session);
    if (!portfolio.holdings.length) return;
    const move = await moves(session, undefined, portfolio);
    // Do not attach a snapshot to an older portfolio if a save/sync raced these reads.
    if (portfolioRevision(await getHoldings(session)) !== portfolioRevision(sourcePortfolio) ||
        JSON.stringify(portfolio.holdings) !== JSON.stringify(sourcePortfolio.holdings)) return;
    const snapshotAsOf = portfolio.asOf ?? move.asOf ?? sourcePortfolio.asOf;
    const text = `${sourcePortfolio.sandbox ? 'This portfolio includes simulated SnapTrade sandbox holdings. ' : ''}${buildBriefing(portfolio, move, now)}`;
    const produce = () => cachedAI<BriefingSnapshot>('briefing-v1', identity, async () => {
        let audio: Buffer | null = null;
        if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
            const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
            const stream = await client.textToSpeech.convert(process.env.ELEVENLABS_VOICE_ID, {
                text, modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128'
            }, { timeoutInSeconds: 60, maxRetries: 0, abortSignal: AbortSignal.timeout(60000) });
            const chunks: Uint8Array[] = [];
            for await (const chunk of stream) chunks.push(chunk);
            audio = Buffer.concat(chunks);
            if (!audio.length) throw new Error('Voice service returned empty audio');
        }
        return { date, text, audio: audio?.toString('base64') ?? null, asOf: snapshotAsOf };
    });
    if (requested) await produce(); // One explicit user attempt; the SDK still has maxRetries: 0.
    else await runWithoutRetry(`briefings:${contentHash(identity)}`, produce);
}

export async function savedBriefing(session: string, portfolio?: Awaited<ReturnType<typeof getHoldings>>) {
    return readAI<BriefingSnapshot>('briefing-v1', briefingIdentity(session, portfolio ?? await getHoldings(session)));
}

export async function briefingResponse(session: string, portfolio?: Awaited<ReturnType<typeof getHoldings>>): Promise<BriefingResponse> {
    const saved = await savedBriefing(session, portfolio), row = saved?.value;
    return { date: row?.date ?? briefingDay(), text: row?.text ?? null,
        audioUrl: row?.audio ? `/api/briefing/audio?v=${encodeURIComponent(saved!.createdAt)}` : null,
        asOf: row?.asOf ?? null, generatedAt: saved?.createdAt ?? null };
}

export async function briefings() {
    const sessions = await query<{ session_id: string }>('SELECT DISTINCT session_id FROM portfolio_holdings');
    for (const s of sessions) {
        try { await briefing(s.session_id); }
        catch { console.warn('Briefing unavailable for one session'); }
    }
}
