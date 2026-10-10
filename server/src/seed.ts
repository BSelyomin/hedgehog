import { readFile } from 'node:fs/promises';
import { query } from './db.ts';
export async function seedFile<T>(name: string): Promise<T> { return JSON.parse(await readFile(new URL(`../seed/${name}.json`, import.meta.url), 'utf8')) as T; }
export async function seed() {
    for (const release of await seedFile<{eventTicker:string;title:string;releasedAt:string;sourceUrl:string}[]>('event_releases'))
        await query(`INSERT INTO event_releases(event_ticker,title,released_at,source_url) VALUES($1,$2,$3,$4)
            ON CONFLICT(event_ticker) DO NOTHING`,[release.eventTicker,release.title,release.releasedAt,release.sourceUrl]);
    for (const tag of await seedFile<string[]>('tags'))
        await query('INSERT INTO allowed_tags VALUES ($1) ON CONFLICT DO NOTHING', [tag]);
    const sectors = await seedFile<Record<string, string[]>>('sector_tags');
    for (const [sector, tags] of Object.entries(sectors))
        for (const tag of tags)
            await query('INSERT INTO sector_tags VALUES ($1,$2) ON CONFLICT DO NOTHING', [sector, tag]);
}
