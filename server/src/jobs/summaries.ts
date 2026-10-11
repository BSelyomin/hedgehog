import { query } from '../db.ts';
import { numbersSupported, spelledFigure } from '../services/ai-guard.ts';
import { cortexResult, isObject, searchSources, snowflakeSearchConfigured } from '../services/snowflake.ts';
import type { SourcePassage } from '../services/snowflake.ts';
import type { Summary } from '../../../shared/types.ts';
import { runWithoutRetry } from '../services/no-retry.ts';

export function checkedSummary(result: unknown, input: unknown, passages: SourcePassage[]): Summary | null {
    if (!isObject(result) || typeof result.text !== 'string' || !result.text.trim() ||
        !Array.isArray(result.sourceIds) || !result.sourceIds.length ||
        !result.sourceIds.every(id => typeof id === 'string' && passages.some(p => p.id === id)) ||
        !numbersSupported(result.text, input) || spelledFigure(result.text))
        return null;
    // URLs come from retrieved records, never from generated text.
    const sourceIds = result.sourceIds;
    const sources = passages.filter(p => sourceIds.includes(p.id)).map(({ title, url }) => ({ title, url }));
    return { text: result.text.trim(), sources };
}

// Reporting is full of figures (prices, percentages, dates), and a summary that repeats one that
// is not in the market data fails the number check and is never shown: on 2026-10-10 that stopped
// 49 of 104 events. The text is asked for without figures, neither in digits nor spelled out, and
// both are checked: it says what happened and in which direction, and the sources carry the figures.
export const SUMMARY_INSTRUCTIONS = 'Write brief, cautious context for this event using only relevant passages. Do not claim that reporting caused an odds move. State no figures of any kind, neither in digits nor spelled out in words: no prices, amounts, percentages, dates or years. Say only what happened and in which direction, for example that prices rose, fell or reached a record, and leave the figures to the sources. Return plain text without citation markers or URLs, plus sourceIds referencing the passages actually used. If there is no relevant reporting, return empty text and sourceIds.';
export async function summaries(ticker?: string, refreshSources = false) {
    if (!snowflakeSearchConfigured())
        return;
    const events = await query<{
        ticker: string;
        title: string;
    }>(`SELECT DISTINCT e.ticker,e.title FROM events e JOIN series_tags t ON t.series_ticker=e.series_ticker AND t.reviewed=true JOIN stock_tags st ON st.tag=t.tag JOIN portfolio_holdings h ON h.symbol=st.symbol AND h.asset_type='security' WHERE ($1::text IS NULL OR e.ticker=$1) ORDER BY e.ticker`, [ticker ?? null]);
    for (const e of events) {
        try {
            const passages = await runWithoutRetry(`summaries:search:${e.ticker}`, () => searchSources(e.title, refreshSources));
            if (!passages) continue;
            if (!passages.length) {
                if (refreshSources) await query('DELETE FROM summaries WHERE event_ticker=$1', [e.ticker]);
                continue;
            }
            const markets = await query(`SELECT m.ticker,m.title,s.mid*100 AS probability_points,s.ts FROM markets m JOIN LATERAL(SELECT mid,ts,yes_bid,yes_ask FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)s ON NOT (s.yes_bid<=0 AND s.yes_ask>=1) WHERE m.event_ticker=$1`, [e.ticker]);
            const input = { event: e, markets };
            // A stop left under an earlier wording ("summaries:completion") is for a different request and is not obeyed here.
            const cached = await runWithoutRetry(`summaries:plain:${e.ticker}`, () => cortexResult(
                SUMMARY_INSTRUCTIONS,
                { marketData: input, passages },
                { type: 'object', properties: { text: { type: 'string' }, sourceIds: { type: 'array', items: { type: 'string', enum: passages.map(p => p.id) } } }, required: ['text', 'sourceIds'], additionalProperties: false },
                { event: e, passages },
                result => checkedSummary(result, input, passages) !== null ||
                    (isObject(result) && result.text === '' && Array.isArray(result.sourceIds) && !result.sourceIds.length)
            ));
            if (!cached) continue;
            const original = isObject(cached.value.input) ? cached.value.input.marketData : null;
            const summary = checkedSummary(cached.value.result, original, passages);
            if (!summary) {
                await query('DELETE FROM summaries WHERE event_ticker=$1', [e.ticker]);
                continue;
            }
            await query(`INSERT INTO summaries(event_ticker,text,sources,input_data,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_ticker) DO UPDATE SET text=excluded.text,sources=excluded.sources,input_data=excluded.input_data,updated_at=excluded.updated_at`, [e.ticker, summary.text, JSON.stringify(summary.sources), JSON.stringify(original), cached.createdAt]);
        } catch (error) {
            if (ticker) throw error;
            console.warn('Snowflake summary stopped for a failed event; automatic retries disabled');
        }
    }
}
