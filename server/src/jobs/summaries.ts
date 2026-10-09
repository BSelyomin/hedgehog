import { query } from '../db.ts';
import { numbersSupported } from '../services/ai-guard.ts';
import { cortexJson, isObject, searchSources, snowflakeSearchConfigured } from '../services/snowflake.ts';
import type { SourcePassage } from '../services/snowflake.ts';
import type { Summary } from '../../../shared/types.ts';

export function checkedSummary(result: unknown, input: unknown, passages: SourcePassage[]): Summary | null {
    if (!isObject(result) || typeof result.text !== 'string' || !result.text.trim() ||
        !Array.isArray(result.sourceIds) || !result.sourceIds.length ||
        !result.sourceIds.every(id => typeof id === 'string' && passages.some(p => p.id === id)) ||
        !numbersSupported(result.text, input))
        return null;
    // URLs come from retrieved records, never from generated text.
    const sourceIds = result.sourceIds;
    const sources = passages.filter(p => sourceIds.includes(p.id)).map(({ title, url }) => ({ title, url }));
    return { text: result.text.trim(), sources };
}

export async function summaries() {
    if (!snowflakeSearchConfigured())
        return;
    const events = await query<{
        ticker: string;
        title: string;
    }>(`SELECT DISTINCT e.ticker,e.title FROM events e JOIN series_tags t ON t.series_ticker=e.series_ticker AND t.reviewed=true JOIN stock_tags st ON st.tag=t.tag JOIN holdings h ON h.symbol=st.symbol WHERE NOT EXISTS(SELECT 1 FROM summaries s WHERE s.event_ticker=e.ticker AND s.updated_at>now()-interval '12 hours') LIMIT 10`);
    for (const e of events) {
        try {
            const passages = await searchSources(e.title);
            if (!passages.length)
                continue;
            const markets = await query(`SELECT m.ticker,m.title,s.mid*100 AS probability_points,s.ts FROM markets m JOIN LATERAL(SELECT mid,ts FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)s ON true WHERE m.event_ticker=$1`, [e.ticker]);
            const input = { event: e, markets };
            const result = await cortexJson(
                'Write brief, cautious context for this event using only relevant passages. Do not claim that reporting caused an odds move. Every number in text must appear in marketData, even if a different number appears in a passage. Return plain text without citation markers or URLs, plus sourceIds referencing the passages actually used. If there is no relevant reporting, return empty text and sourceIds.',
                { marketData: input, passages },
                { type: 'object', properties: { text: { type: 'string' }, sourceIds: { type: 'array', items: { type: 'string', enum: passages.map(p => p.id) } } }, required: ['text', 'sourceIds'], additionalProperties: false }
            );
            const summary = checkedSummary(result, input, passages);
            if (!summary)
                continue;
            await query(`INSERT INTO summaries(event_ticker,text,sources,input_data) VALUES($1,$2,$3,$4) ON CONFLICT(event_ticker) DO UPDATE SET text=excluded.text,sources=excluded.sources,input_data=excluded.input_data,updated_at=now()`, [e.ticker, summary.text, JSON.stringify(summary.sources), JSON.stringify(input)]);
        } catch {
            console.warn('Snowflake summary unavailable for one event; will retry');
        }
    }
}
