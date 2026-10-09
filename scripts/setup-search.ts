import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { isObject } from '../server/src/services/snowflake.ts';
import { searchIdentifier, validateSearchDocuments } from '../server/src/services/search-setup.ts';

// Run with Node 24. SQL API credentials come only from the environment.
// The admin grant script is snowflake/search-admin.sql; this script never escalates roles.
async function main() {
    const path = process.argv[2];
    if (!path) throw new Error('Usage: node --env-file=.env scripts/setup-search.ts source-documents.json');
    const documents = validateSearchDocuments(JSON.parse(await readFile(path, 'utf8')));
    const url = new URL(process.env.SNOWFLAKE_ACCOUNT_URL ?? '');
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.snowflakecomputing.com') ||
        url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash)
        throw new Error('Use an HTTPS Snowflake account origin');
    const token = process.env.SNOWFLAKE_PAT?.trim();
    if (!token) throw new Error('SNOWFLAKE_PAT is required');
    const database = searchIdentifier(process.env.SNOWFLAKE_SEARCH_DATABASE || 'HEDGEHOG');
    const schema = searchIdentifier(process.env.SNOWFLAKE_SEARCH_SCHEMA || 'REPORTING');
    const service = searchIdentifier(process.env.SNOWFLAKE_SEARCH_SERVICE || 'EVENT_SOURCES');
    const warehouse = searchIdentifier(process.env.SNOWFLAKE_SEARCH_WAREHOUSE || 'HEDGEHOG_SEARCH_WH');
    const table = `${database}.${schema}.SOURCE_DOCUMENTS`;
    const search = `${database}.${schema}.${service}`;
    const headers = { Authorization: `Bearer ${token}`, 'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
        'Content-Type': 'application/json', Accept: 'application/json' };

    async function sql(statement: string, values: string[] = []) {
        const body = { statement, warehouse, timeout: 300,
            bindings: Object.fromEntries(values.map((value, i) => [String(i + 1), { type: 'TEXT', value }])) };
        let response = await fetch(`${url.origin}/api/v2/statements`, { method: 'POST', headers,
            body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000) });
        let data: unknown = await response.json();
        const start = Date.now();
        while (response.status === 202) {
            if (!isObject(data) || typeof data.statementHandle !== 'string') throw new Error('Missing SQL statement handle');
            if (Date.now() - start > 300000) throw new Error('SQL still running; check query history before rerunning setup');
            await delay(3000);
            response = await fetch(`${url.origin}/api/v2/statements/${encodeURIComponent(data.statementHandle)}`, {
                headers, redirect: 'error', signal: AbortSignal.timeout(45000) });
            data = await response.json();
        }
        if (!response.ok) {
            // Codes aid diagnosis without logging SQL source text, credentials or provider bodies.
            const code = isObject(data) && typeof data.code === 'string' ? data.code : 'unknown';
            throw new Error(`Snowflake SQL failed (HTTP ${response.status}, code ${code}); check query history and search-admin.sql grants`);
        }
        return data;
    }

    console.log(`Preparing ${table}`);
    await sql(`CREATE TABLE IF NOT EXISTS ${table} (
        ID VARCHAR NOT NULL, TITLE VARCHAR NOT NULL, URL VARCHAR NOT NULL, TEXT VARCHAR NOT NULL,
        PUBLISHED_AT TIMESTAMP_TZ NOT NULL, FEED_URL VARCHAR NOT NULL,
        INGESTED_AT TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP()
    ) CHANGE_TRACKING = TRUE DATA_RETENTION_TIME_IN_DAYS = 1`);
    await sql(`MERGE INTO ${table} target USING (
        SELECT value:id::VARCHAR AS ID, value:title::VARCHAR AS TITLE,
            value:url::VARCHAR AS URL, value:text::VARCHAR AS TEXT,
            TO_TIMESTAMP_TZ(value:publishedAt::VARCHAR) AS PUBLISHED_AT,
            value:feedUrl::VARCHAR AS FEED_URL
        FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?)))
    ) source ON target.ID = source.ID
    WHEN MATCHED AND (target.TEXT <> source.TEXT OR target.TITLE <> source.TITLE OR target.PUBLISHED_AT <> source.PUBLISHED_AT)
      THEN UPDATE SET TITLE=source.TITLE, TEXT=source.TEXT, PUBLISHED_AT=source.PUBLISHED_AT,
        FEED_URL=source.FEED_URL, INGESTED_AT=CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT (ID,TITLE,URL,TEXT,PUBLISHED_AT,FEED_URL)
      VALUES (source.ID,source.TITLE,source.URL,source.TEXT,source.PUBLISHED_AT,source.FEED_URL)`, [JSON.stringify(documents)]);
    // Prune only this dedicated source cache, never application/portfolio data.
    await sql(`DELETE FROM ${table} WHERE PUBLISHED_AT < DATEADD(day, -90, CURRENT_TIMESTAMP())`);
    console.log(`Imported ${documents.length} verified-format source excerpts. Creating search index; this may take a few minutes.`);
    await sql(`CREATE CORTEX SEARCH SERVICE IF NOT EXISTS ${search}
        ON TEXT PRIMARY KEY (ID) ATTRIBUTES PUBLISHED_AT
        WAREHOUSE = ${warehouse} TARGET_LAG = '1 hour'
        INITIALIZE = ON_CREATE AUTO_SUSPEND = 1800
        AS SELECT ID,TITLE,URL,TEXT,PUBLISHED_AT FROM ${table}`);
    console.log(`Search ready: ${search}. Existing indexes pick up changed sources within the 1-hour target lag.`);
}

main().catch(error => {
    const message = error instanceof Error ? error.message : 'Unknown setup error';
    const token = process.env.SNOWFLAKE_PAT;
    console.error(token ? message.replaceAll(token, '[redacted]') : message);
    process.exitCode = 1;
});
