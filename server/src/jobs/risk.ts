import { contentHash } from '../services/ai-cache.ts';
import { readFile } from 'node:fs/promises';
import { cortexJson, isObject, snowflakeConfigured } from '../services/snowflake.ts';
import { query } from '../db.ts';
import { seedFile } from '../seed.ts';
import { validTags } from '../services/ai-guard.ts';
// An operator supplies a downloaded public 10-K risk-factor section and its source URL.
export async function riskFactors(symbol: string, path: string, sourceUrl: string) {
    if (!snowflakeConfigured())
        throw new Error('Snowflake Cortex configuration required');
    if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol) || new URL(sourceUrl).protocol !== 'https:')
        throw new Error('Ticker and HTTPS filing source required');
    const text = await readFile(path, 'utf8');
    const allowed = await seedFile<string[]>('tags');
    const hash = contentHash({ symbol, sourceUrl, text, allowed });
    if ((await query('SELECT input_hash FROM risk_factors WHERE symbol=$1', [symbol]))[0]?.input_hash === hash) return;
    const result = await cortexJson(
        'Map the supplied filing risk factors to allowedTags only. Return {tags:[]}.',
        { allowedTags: allowed, symbol, sourceUrl, filing: text.slice(0, 100000) },
        { type: 'object', properties: { tags: { type: 'array', items: { type: 'string', enum: allowed } } }, required: ['tags'], additionalProperties: false }
    );
    if (!isObject(result) || !Array.isArray(result.tags) || result.tags.some(tag => typeof tag !== 'string'))
        throw new Error('Snowflake returned invalid filing tags');
    const tags = validTags(result.tags, allowed);
    for (const tag of tags)
        await query(`INSERT INTO stock_tags VALUES($1,$2,'related') ON CONFLICT DO NOTHING`, [symbol, tag]);
    await query('INSERT INTO risk_factors(symbol,source_url,text,input_hash) VALUES($1,$2,$3,$4) ON CONFLICT(symbol) DO UPDATE SET source_url=excluded.source_url,text=excluded.text,input_hash=excluded.input_hash,processed_at=now()', [symbol, sourceUrl, text, hash]);
}
