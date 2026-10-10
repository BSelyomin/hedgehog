import { cortexJson, isObject, snowflakeConfigured } from '../services/snowflake.ts';
import { query } from '../db.ts';
import { seedFile } from '../seed.ts';
import { validTags } from '../services/ai-guard.ts';
import { yahoo } from './prices.ts';
export async function stockTags() {
    const symbols = new Set([...(await seedFile<string[]>('demo_symbols')), ...(await query<{
            symbol: string;
        }>('SELECT DISTINCT symbol FROM portfolio_holdings')).map(r => r.symbol)]);
    const allowed = await seedFile<string[]>('tags');
    for (const symbol of symbols) {
        if (allowed.includes(symbol))
            await query(`INSERT INTO stock_tags VALUES($1,$1,'direct') ON CONFLICT DO NOTHING`, [symbol]);
        try {
            const info = await yahoo.quoteSummary(symbol, { modules: ['assetProfile'] });
            const sector = info.assetProfile?.sector;
            if (!sector)
                continue;
            await query(`INSERT INTO stock_tags(symbol,tag,link_type) SELECT $1,tag,'related' FROM sector_tags WHERE sector=$2 ON CONFLICT DO NOTHING`, [symbol, sector]);
        }
        catch {
            console.warn('Sector lookup unavailable', symbol);
        }
    }
}
export async function tagSeries() {
    if (!snowflakeConfigured())
        return;
    const allowed = await seedFile<string[]>('tags');
    const series = await query<{
        series_ticker: string;
        title: string;
        description: string;
    }>(`SELECT DISTINCT ON(e.series_ticker) e.series_ticker,e.title,e.description FROM events e WHERE EXISTS (SELECT 1 FROM markets m WHERE m.event_ticker=e.ticker AND m.status='active') AND NOT EXISTS(SELECT 1 FROM series_tags t WHERE t.series_ticker=e.series_ticker) ORDER BY e.series_ticker,e.updated_at DESC`);
    for (let i = 0; i < series.length; i += 20) {
        const batch = series.slice(i, i + 20);
        let result: unknown;
        try {
            result = await cortexJson(
                'Tag each supplied series using only allowedTags. Do not infer a company tag without an explicit company name. Return {series:[{series_ticker,tags}]}.',
                { allowedTags: allowed, series: batch },
                { type: 'object', properties: { series: { type: 'array', items: {
                    type: 'object', properties: { series_ticker: { type: 'string' }, tags: { type: 'array', items: { type: 'string', enum: allowed } } },
                    required: ['series_ticker', 'tags'], additionalProperties: false
                } } }, required: ['series'], additionalProperties: false }
            );
        }
        catch {
            console.warn('Snowflake series tagging failed for one batch; will retry');
            continue;
        }
        if (!isObject(result) || !Array.isArray(result.series))
            continue;
        for (const row of result.series)
            if (isObject(row) && typeof row.series_ticker === 'string' && batch.some(s => s.series_ticker === row.series_ticker))
                for (const tag of validTags(row.tags, allowed))
                    await query(`INSERT INTO series_tags VALUES($1,$2,'snowflake',false) ON CONFLICT DO NOTHING`, [row.series_ticker, tag]);
    }
}
export async function reviewTags() {
    const symbols = await seedFile<string[]>('demo_symbols');
    console.table(await query(`SELECT DISTINCT st.series_ticker,e.title,st.tag,st.source,st.reviewed FROM series_tags st JOIN events e ON e.series_ticker=st.series_ticker WHERE st.tag=ANY($1) OR st.tag IN(SELECT tag FROM stock_tags WHERE symbol=ANY($1)) ORDER BY st.series_ticker,st.tag`, [symbols]));
}
