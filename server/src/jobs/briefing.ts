import { cachedAI, readAI } from '../services/ai-cache.ts';
import type { BriefingResponse } from '../../../shared/types.ts';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { query } from '../db.ts';
import { exposure } from '../services/exposure.ts';
import { moves } from '../services/moves.ts';
import { getHoldings, portfolioRevision } from '../services/holdings.ts';
import { briefingDay, briefingSentences, morningReady, sentenceTimes } from '../services/briefing-content.ts';
import type { BriefingPart } from '../../../shared/types.ts';
import { contentHash } from '../services/ai-cache.ts';
import { runWithoutRetry } from '../services/no-retry.ts';

interface BriefingSnapshot { date: string; text: string; audio: string | null; asOf: string | null; parts?: BriefingPart[] }

export function briefingIdentity(session: string, portfolio: Awaited<ReturnType<typeof getHoldings>>) {
    return { session, portfolio: portfolioRevision(portfolio), voice: process.env.ELEVENLABS_VOICE_ID ?? '',
        enabled: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID), model: 'eleven_multilingual_v2' };
}

// One briefing a day for each portfolio (AGENTS.md, "Voice briefing"). The stored one is kept
// for its New York day and replaced by the next day's, so the store never grows by a day's audio.
// An explicit reload may make today's before the scheduled morning run; it does not make a second.
export async function briefing(session: string, requested = false) {
    const now = new Date();
    if (!requested && !morningReady(now)) return;
    const date = briefingDay(now);
    const sourcePortfolio = await getHoldings(session);
    const identity = briefingIdentity(session, sourcePortfolio);
    if ((await readAI<BriefingSnapshot>('briefing-v1', identity))?.value.date === date) return;
    const portfolio = await exposure(session);
    if (!portfolio.holdings.length) return;
    const move = await moves(session, undefined, portfolio);
    // Do not attach a snapshot to an older portfolio if a save/sync raced these reads.
    if (portfolioRevision(await getHoldings(session)) !== portfolioRevision(sourcePortfolio) ||
        JSON.stringify(portfolio.holdings) !== JSON.stringify(sourcePortfolio.holdings)) return;
    const snapshotAsOf = portfolio.asOf ?? move.asOf ?? sourcePortfolio.asOf;
    const sentences = [...(sourcePortfolio.sandbox ? [{ text: 'This portfolio includes simulated SnapTrade sandbox holdings.' }] : []), ...briefingSentences(portfolio, move, now)];
    const text = sentences.map(sentence => sentence.text).join(' ');
    const produce = () => cachedAI<BriefingSnapshot>('briefing-v1', identity, async () => {
        let audio: string | null = null, times: ReturnType<typeof sentenceTimes> = null;
        if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
            const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
            // The same speech as before, returned with the time each character is spoken, so the
            // transcript can follow the voice. One request; nothing else is sent than the text.
            const spoken = await client.textToSpeech.convertWithTimestamps(process.env.ELEVENLABS_VOICE_ID, {
                text, modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128'
            }, { timeoutInSeconds: 60, maxRetries: 0, abortSignal: AbortSignal.timeout(60000) });
            if (!spoken.audioBase64) throw new Error('Voice service returned empty audio');
            audio = spoken.audioBase64;
            times = sentenceTimes(sentences.map(sentence => sentence.text), spoken.alignment);
        }
        const parts = sentences.map((sentence, i): BriefingPart => ({ ...sentence, start: times?.[i].start ?? null, end: times?.[i].end ?? null }));
        return { date, text, audio, asOf: snapshotAsOf, parts };
    }, stored => stored.date !== date);
    if (requested) await produce(); // One explicit user attempt; the SDK still has maxRetries: 0.
    else await runWithoutRetry(`briefings:${contentHash(identity)}`, produce);
}

export async function savedBriefing(session: string, portfolio?: Awaited<ReturnType<typeof getHoldings>>) {
    return readAI<BriefingSnapshot>('briefing-v1', briefingIdentity(session, portfolio ?? await getHoldings(session)));
}

export async function briefingResponse(session: string, portfolio?: Awaited<ReturnType<typeof getHoldings>>): Promise<BriefingResponse> {
    const saved = await savedBriefing(session, portfolio), row = saved?.value;
    const today = briefingDay(new Date(Date.now()));
    return { date: row?.date ?? today, today, text: row?.text ?? null, parts: row?.parts ?? null,
        audioUrl: row?.audio ? `/api/briefing/audio?v=${encodeURIComponent(saved!.createdAt)}` : null,
        asOf: row?.asOf ?? null, generatedAt: saved?.createdAt ?? null };
}

// The morning run makes a briefing for each account. A guest's is made when the guest asks for
// one, so that browsers which only ever tried the app do not each cost a voice request a day.
export async function briefings() {
    const sessions = await query<{ session_id: string }>(`SELECT DISTINCT session_id FROM portfolio_holdings WHERE session_id LIKE 'user:%'`);
    for (const s of sessions) {
        try { await briefing(s.session_id); }
        catch { console.warn('Briefing unavailable for one session'); }
    }
}
