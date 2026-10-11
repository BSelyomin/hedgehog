import type { EventAnswerResponse } from '../../../shared/types.ts';
import { eventDetail } from './exposure.ts';
import { numbersSupported, numericTokens, spelledFigure } from './ai-guard.ts';
import { CortexError, cortexResult, isObject, searchSources, snowflakeSearchConfigured } from './snowflake.ts';
import type { SourcePassage } from './snowflake.ts';

// A question about one event, answered by Snowflake Cortex from retrieved reporting only.
// Retrieval is Cortex Search over the reporting index; the answer is one structured completion.
// Nothing is shown unless it cites passages that were retrieved and states no figure that is not
// in the market data it was given (AGENTS.md, "Snowflake Cortex"). One attempt, no retry.
export const QUESTION_MIN = 5, QUESTION_MAX = 200;
export const ASK_INSTRUCTIONS = 'Answer the question about this prediction-market event using only the supplied passages and marketData. If they do not answer the question, set answered to false and leave text empty; never use outside knowledge. Do not say that reporting caused an odds move, do not predict the outcome and do not advise a trade. Write no figures unless they appear in marketData, and never spell a figure out in words: for anything else say only what happened and in which direction. Return plain text of at most four sentences without citation markers or URLs, plus sourceIds naming the passages actually used.';

export function validateQuestion(input: unknown): string {
    if (typeof input !== 'string')
        throw new Error('Type a question');
    // One line of ordinary text: control characters are dropped and runs of space made one.
    const question = input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (question.length < QUESTION_MIN || question.length > QUESTION_MAX)
        throw new Error(`Ask a question of ${QUESTION_MIN} to ${QUESTION_MAX} characters`);
    return question;
}

// The answer as it may be shown, or null. URLs come from the retrieved records, never from the text.
export function checkedAnswer(result: unknown, marketData: unknown, passages: SourcePassage[]): { text: string; sources: { title: string; url: string }[] } | null {
    if (!isObject(result) || result.answered !== true || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 1500 ||
        /https?:\/\/|www\./i.test(result.text) || !Array.isArray(result.sourceIds) || !result.sourceIds.length ||
        !result.sourceIds.every(id => typeof id === 'string' && passages.some(p => p.id === id)) || !numbersSupported(result.text, marketData) || spelledFigure(result.text))
        return null;
    const cited = result.sourceIds;
    return { text: result.text.trim(), sources: passages.filter(p => cited.includes(p.id)).map(({ title, url }) => ({ title, url })) };
}
// The model said the sources do not answer the question. That is a result, not a failure.
const declined = (result: unknown) => isObject(result) && result.answered === false;

// Each question can cost a Snowflake request, so a browser gets this many in ten minutes.
export const ASK_LIMIT = 8, ASK_WINDOW_MS = 10 * 60 * 1000;
const asked = new Map<string, number[]>();
export function askAllowed(session: string, now = Date.now()): boolean {
    const recent = (asked.get(session) ?? []).filter(time => now - time < ASK_WINDOW_MS);
    if (recent.length >= ASK_LIMIT) { asked.set(session, recent); return false; }
    asked.set(session, [...recent, now]);
    // Sessions that have gone quiet are dropped so the list cannot grow without end.
    if (asked.size > 5000) for (const [key, times] of asked) if (!times.some(time => now - time < ASK_WINDOW_MS)) asked.delete(key);
    return true;
}
export function resetAskLimits() { asked.clear(); }

export async function askEvent(session: string, ticker: string, question: string): Promise<EventAnswerResponse | null> {
    const detail = await eventDetail(session, ticker);
    if (!detail)
        return null;
    const base = { question, text: null, sources: [], checks: null, generatedAt: null, asOf: detail.asOf };
    if (!snowflakeSearchConfigured())
        return { ...base, status: 'unavailable', reason: 'Sourced answers need the Snowflake reporting index, which is not set up on this server.' };
    try {
        const passages = await searchSources(`${detail.event.title} ${question}`);
        if (!passages.length)
            return { ...base, status: 'no-answer', reason: 'No recent reporting was found for this question, so there is no sourced answer.' };
        const marketData = { event: { ticker: detail.event.ticker, title: detail.event.title },
            markets: detail.event.markets.map(m => ({ outcome: m.subtitle || m.title, yes_percent: m.probability === null ? null : Math.round(m.probability * 100) })) };
        const cached = await cortexResult(ASK_INSTRUCTIONS, { question, marketData, passages },
            { type: 'object', properties: { answered: { type: 'boolean' }, text: { type: 'string' }, sourceIds: { type: 'array', items: { type: 'string', enum: passages.map(p => p.id) } } }, required: ['answered', 'text', 'sourceIds'], additionalProperties: false },
            // The same question over the same passages is answered once. Live odds are left out of
            // the identity; a stored answer is checked against the market data it was written from.
            { event: detail.event.ticker, question: question.toLowerCase(), passages },
            result => declined(result) || checkedAnswer(result, marketData, passages) !== null);
        const original = isObject(cached.value.input) ? cached.value.input.marketData : null;
        const answer = checkedAnswer(cached.value.result, original, passages);
        if (!answer)
            return { ...base, status: 'no-answer', reason: 'The retrieved reporting does not answer this question, so no answer is shown.',
                checks: { sourcesRetrieved: passages.length, sourcesCited: 0, numbersChecked: 0 } };
        return { ...base, status: 'answered', text: answer.text, sources: answer.sources, reason: null, generatedAt: cached.createdAt,
            checks: { sourcesRetrieved: passages.length, sourcesCited: answer.sources.length, numbersChecked: numericTokens(answer.text).length } };
    } catch (error) {
        // Safe messages only: a rejected answer says which kind of check failed, never the text.
        return { ...base, status: 'unavailable', reason: error instanceof CortexError && /validation/.test(error.message)
            ? 'An answer was written but did not pass the source and number checks, so it is not shown.'
            : error instanceof CortexError ? error.message : 'The answer service is unavailable right now.' };
    }
}
