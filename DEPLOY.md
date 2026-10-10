# Portable deployment

The local Docker stack provides Node 24 frontend/backend images, a TimescaleDB service, database health checks, automatic migrations and a persistent database volume. It has been built and run on Windows with Docker Desktop's Linux engine. Private Snowflake, Tiger Cloud, FRED and ElevenLabs integrations require your own credentials; local Docker success does not verify those services.

## Run on another machine

1. Install Docker Engine with Compose (or enable Docker Desktop's WSL integration).
2. Copy this repository, including `compose.yaml`, `Dockerfile`, `/web`, `/server`, `/shared` and the root configuration files.
3. Copy `.env.example` to `.env`. Set API keys privately. Leave DATABASE_URL empty for local TimescaleDB, or set a Tiger Data connection string with its required TLS parameters.
4. Run `docker compose up --build -d`. Open http://localhost:3000.
5. Inspect `docker compose logs backend` for poll completion. Load a portfolio in the browser. Stock histories and tags are collected on startup and by scheduled jobs.
6. Configure Snowflake as below, then run `docker compose exec backend npm run job -- tag-series` after markets have loaded. Run `docker compose exec backend npm run job -- review-tags`. Review company and macro tags against the real series. Approve individual pairs with `docker compose exec backend npm run job -- approve-tag SERIES TAG`.
7. Finalize `server/seed/sector_tags.json` yourself; rebuild to seed it. Allowed company tickers must first be explicitly added to `server/seed/tags.json`, then rebuild/reseed. Run stock-tags and tag-series jobs as needed.
8. Run `docker compose exec backend npm run job -- backfill`, then measure, summaries and briefings. Run sample-markets and sample-links to obtain values for manual review.

The web app proxies `/api` to the private backend. The browser never calls Kalshi. The backend migrates before it listens and runs the poller every five minutes. AI and voice features stay absent when their credentials or supported source data are unavailable. Price-loading errors do not fabricate histories.

## Tiger Data database

Create a Tiger Cloud service with TimescaleDB enabled and copy its PostgreSQL connection URI to `DATABASE_URL` in the root `.env`, including the TLS options supplied by Tiger Data. The backend uses `pg` for queries and applies migrations automatically. A Tiger Cloud management API key is not needed for database access. See [Tiger Data service setup](https://www.tigerdata.com/docs/get-started/quickstart/create-service).

Leaving `DATABASE_URL` empty uses the bundled local database. Setting it to Tiger Data changes which database the backend uses; it does not transfer your existing local data. The local Compose database is still started as a dependency and its volume is retained.

## Snowflake AI configuration

Set these in the root `.env` (all are backend-only):

| Variable | Value |
| --- | --- |
| `SNOWFLAKE_ACCOUNT_URL` | Your account origin, such as `https://ORG-ACCOUNT.snowflakecomputing.com`; not a Snowsight `app.snowflake.com` URL |
| `SNOWFLAKE_PAT` | A Snowflake programmatic access token with Cortex access |
| `SNOWFLAKE_CORTEX_MODEL` | An available Cortex model supporting Chat Completions JSON-schema output, for example `claude-sonnet-4-5` if enabled in your account/region |

Use Snowflake's [PAT setup](https://docs.snowflake.com/en/user-guide/programmatic-access-tokens) and [Cortex REST prerequisites/model availability](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api). The token's role must have the necessary Cortex privileges (such as `SNOWFLAKE.CORTEX_USER`), access to the selected model, and comply with your account's authentication/network policies. No Snowflake password, SQL warehouse connection or Google API key is used by the completion client. PAT expiry/rotation is managed in Snowflake; update `.env` after rotating it.

After changing `.env`, run `docker compose up -d` to recreate the backend with the new environment. After a code update, use `docker compose up --build -d`. Existing series tags and review states survive migration `002_snowflake_tags.sql`; new AI tags are stored as `snowflake` and need human approval.

### Optional source-backed event summaries

Set `SNOWFLAKE_SEARCH_DATABASE`, `SNOWFLAKE_SEARCH_SCHEMA` and `SNOWFLAKE_SEARCH_SERVICE` to a Cortex Search service in the same account. Use the exact database/schema/service identifiers. Its source query must expose these uppercase string columns:

| Column | Contents |
| --- | --- |
| `TITLE` | The source article's title |
| `URL` | Its original HTTPS source URL |
| `TEXT` | A relevant passage from that reporting, indexed for search |
| `PUBLISHED_AT` | A timestamp attribute used to exclude future sources and sources older than 90 days |

Follow [Create a Cortex Search service](https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search) and [query/access requirements](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service). The setup below provisions a dedicated index of public government release excerpts. The index is optional; tagging and filing analysis work without it.

1. In the same Snowflake account used by `.env`, run **all** statements in `snowflake/search-admin.sql` as ACCOUNTADMIN. This grants `HEDGEHOG_AI` access to `HEDGEHOG.REPORTING` and a dedicated X-Small warehouse, `HEDGEHOG_SEARCH_WH`.
2. From the repository root in Windows PowerShell, collect sources and create/update the index:

```powershell
docker compose build backend
.\scripts\collect-search-sources.ps1
docker compose run --rm -T --no-deps --volume "${PWD}/scripts:/app/scripts:ro" --volume "${PWD}/.cache/search-sources.json:/app/search-sources.json:ro" backend node --experimental-strip-types scripts/setup-search.ts /app/search-sources.json
```

The collector reads the Federal Reserve monetary-policy, EIA Today in Energy, and BLS latest-release RSS feeds, taking up to 15 dated excerpts per feed from the last 90 days. It skips unavailable feeds and ambiguous publication dates. These are original feed excerpts, not full articles or fabricated news. If no feed works, it stops without modifying the index. The local cache is ignored by Git. Coverage is limited to available feeds; this is not company news or an open-web news search.

The setup script validates the documents, upserts by source URL into `HEDGEHOG.REPORTING.SOURCE_DOCUMENTS`, removes expired rows from that dedicated cache, and creates `HEDGEHOG.REPORTING.EVENT_SOURCES`. Existing source text is updated only when it changes. It uses parameter-bound data, leaves existing services in place, and polls long-running Snowflake SQL statements. The initial index is built synchronously; later table changes are indexed within the one-hour target lag. You can also supply a JSON array of licensed source documents with `title`, `url`, `text`, `publishedAt` (ISO timestamp) and `feedUrl` provenance fields. No article contents come from an LLM.

3. Set these values in `.env` after the setup succeeds:

```dotenv
SNOWFLAKE_SEARCH_DATABASE=HEDGEHOG
SNOWFLAKE_SEARCH_SCHEMA=REPORTING
SNOWFLAKE_SEARCH_SERVICE=EVENT_SOURCES
```

4. Run `docker compose up -d --no-deps --wait backend` to load the settings and rebuilt code. After importing holdings and reviewing relevant series tags, run `docker compose exec backend npm run job -- summaries`. The normal scheduler also runs summaries hourly.

To refresh the source collection, repeat the collector and setup commands in step 2 (a rebuild is only needed after code changes). Collection is an explicit maintenance command, not a scheduled feed ingestion job. The backend filters out sources older than 90 days even if collection has not run. The existing number and source checks can still hide summaries when the available reporting cannot support them.

**Costs:** the refresh warehouse auto-suspends after 60 seconds idle, while the search service auto-suspends serving after 30 minutes without queries and resumes on a query. These are separate resources: indexing, embeddings, storage and serving can incur Snowflake charges. To stop the index while retaining its source table, use `DROP CORTEX SEARCH SERVICE HEDGEHOG.REPORTING.EVENT_SOURCES;` as the owner role and clear the three search variables in `.env`, then recreate the backend. Running setup again recreates the index from the table.

The summaries job retrieves at most five passages, then generates context with selected source IDs. URLs are taken only from retrieved rows. Unsupported numbers, invalid source IDs, missing sources, failed requests and incomplete model output prevent a new summary from being saved. The event endpoint rechecks cached summaries before showing them. This is retrieval from your index, not automatic Google/open-web search.

### Fictional portfolio for testing

Open Add holdings at http://localhost:3000 and import `examples/fake-portfolio.csv`, then select **Map my exposure**. It contains five fictional position values totaling $100,000, using the existing demo tickers. Values are total dollars per position, not shares or current prices. See `examples/README.md`. Importing holdings does not populate market history or approve AI tags.

`FRED_API_KEY`, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` retain their existing roles. Without Snowflake configuration, AI jobs skip generation while the rest of the application can run. No credentials belong in Git or browser environment variables.

## Validation on a networked machine

```
npm ci
npm run lint
npm test
npm run build
docker compose config
docker compose up --build -d
```

The committed lockfile is used by Docker through `npm ci`. Node and TimescaleDB image tags still move; pin validated image digests if you need bit-for-bit reproducibility. On native Windows, start the two workspaces separately with `npm run dev -w server` and `npm run dev -w web`; the root combined launcher does not support Windows.

## Back up and transfer the database

```
docker compose exec -T database pg_dump -U hedgehog -Fc hedgehog > hedgehog.dump
```

Restore into a compatible TimescaleDB installation using Timescale's documented pre/post restore procedures. Copying the repository alone does not copy price history, holdings or audio. Protect database dumps as user data. `docker compose down` keeps the volume; `down -v` deletes it.

For public hosting, configure your chosen host, HTTPS reverse proxy and secret store. Set COOKIE_SECURE=true behind HTTPS. No domain registration, cloud resources, public publication or external account creation has occurred. Cloud provider details remain in questions.txt.

## AI caching and reload

The server applies `005_ai_cache.sql` on startup (or run `npm run migrate`). Restart
with `docker compose up -d --build` after pulling this change. No new keys or
packages are required. Existing AI snapshots enter the new cache on their next
successful generation.

Snowflake completions, Cortex Search results, and ElevenLabs audio are cached in
Postgres. Keys use input content plus the relevant model/service configuration;
secrets are excluded. Concurrent identical generations share a result, including
across server workers through a PostgreSQL advisory transaction lock. Errors and
invalid completions are not cached. Cache storage survives server restarts and is
included in database backups.

- Briefings belong to one session/account and a particular holdings snapshot.
  Holdings amounts, symbols, manual versus brokerage sources, and sandbox status
  affect the key. Unchanged saves/syncs, timestamps, the date, and Kalshi updates
  do not. Returning to a previously used portfolio can reuse its prior briefing.
- Event summaries are shared reporting context, without private portfolio data.
  Their keys include event identity/title and retrieved passages, excluding live
  market quotes. Saved numeric inputs remain attached to the prose, and every
  read still checks numbers and citations. The page labels the original snapshot
  time separately from current quotes.
- Tagging requests are cached by their supplied series/filing content and allowed
  tags. The risk-factor job reads the supplied file to detect changed filings.
  Existing human-reviewed tags are preserved.
- Search retrieval has no timed expiry. Event **Reload reporting** explicitly checks the
  configured reporting index. Unchanged retrieved passages reuse the completion;
  changed passages generate new context. Missing sources hide the summary.

**Reload** is available on Overview, Calendar, Event, Earnings, Moves, and Track
record. It preserves page selections and reports loading/errors. Overview reads the saved briefing independently of exposure, with a separate
**Reload briefing** button to prepare a missing snapshot. Event pages similarly
separate **Reload reporting** from their regular market-data reload. An AI failure
does not block page refresh. Reload never
forces regeneration of unchanged completion/audio inputs. It reads market data
from Postgres; only the existing poller/backfill contact Kalshi. Brokerage sync
remains the separate control on Brokerages.

To check it:

1. Open Overview and select Reload briefing. With data and ElevenLabs configured, read/play
   the saved briefing and note its timestamp.
2. Reload again, save the same holdings, or let Kalshi polling run. The briefing
   timestamp/audio stay the same, while live page figures can update.
3. Change a holding's amount (manual, CSV, or imported positions), then select Reload briefing
   on Overview. A briefing is generated for the new portfolio.
4. Open an event and use Reload for current odds or Reload reporting to check
   sources. Current odds refresh independently of the saved
   AI summary. Updated reporting can replace that summary; unchanged reporting
   cannot. Summaries require a configured Cortex Search index and valid sources.
5. Switch accounts: a private briefing/audio must never appear for another user.

A saved briefing can be older than today. Its references to the daily move/week
refer to its original snapshot date. This follows content-based invalidation;
there is no automatic daily regeneration or force-clear button.


### Requests that remain pending

Page reads and AI generations now use separate database connection pools. Database
connections time out after 5 seconds, SQL statements after 20 seconds, and query
reads after 25 seconds. Browser reads stop after 30 seconds and display a retryable
error; AI reloads have a 90-second browser limit. Exposure reads only markets linked
to reviewed portfolio tags; moves batches price, sensitivity, and odds history reads.

If an existing deployment still has requests pending, rebuild/restart both services
to release old connections and load these changes:

```sh
docker compose up -d --build backend frontend
docker compose logs --tail=80 backend frontend
```

Backend failures now log the HTTP method, route template, and sanitized error code.
A missing table/column produces a migration message; a database statement timeout
produces a timeout message. Do not share `.env`, credentials, or unredacted third-party
logs when reporting a failure. Cached AI content still needs a reachable Postgres
instance; it is not an offline browser copy of the portfolio.

### Moves session and price history

Moves opens with `GET /moves`, selecting the latest stored completed SPY session
(or latest holding session if SPY history is absent). The UI shows the actual date
and each holding's source close dates. Choosing a date calls `GET /moves?date=YYYY-MM-DD`
and never substitutes another date. Use **Latest trading session** to return to the
automatic view; Reload reads the newest stored results.

Price loading and measurement now run on startup and hourly, independently of AI
jobs. SPY loads first, established histories refresh the recent week, and new
symbols load their measurement history. Today's Yahoo candle is excluded until
17:00 America/New_York so an intraday quote is not treated as a daily close.
Migration `006_measurement_price_date.sql` records the last aligned source-price
date in `measured_links`; a calculation performed after midnight can therefore be
used for the preceding session. Future-source measurements remain excluded from
historical requests. Insufficient/unreliable betas still have no numeric split.

Rebuild to apply migrations and start the price loader:

```sh
docker compose up -d --build backend frontend
```

If price history failed to load, check the backend logs for `Price load failed for
symbol`. You can retry just the data jobs after addressing provider connectivity:

```sh
docker compose exec backend npm run job -- prices
docker compose exec backend npm run job -- measure
```

The top portfolio/sandbox banner has been removed. Sandbox/source information is
still available on Holdings and Brokerages; removing the banner does not change
SnapTrade mode or convert simulated positions into live accounts.

### Timing a slow Moves request in your browser

Moves now has a dedicated query path: it reads the holdings, two relevant closes
per symbol, stored sensitivities, reviewed tags, and only markets with a supported
3+ point odds move. It no longer builds the exposure map, calculates trust scores,
reads all settled markets, or scans the entire prices table for freshness. On the
profiled signed-in account, SQL calls fell from 13 to 7. Independent holding reads
and price/measurement/tag reads run concurrently; the default session and its
closing prices are resolved in one query.

Rebuild both services to load the backend changes and forward the new headers:

```sh
docker compose up -d --build backend frontend
```

In your browser, open Developer Tools → Network, open Moves or select Reload,
and select the `/api/moves` request. Under Response Headers, inspect `Server-Timing`:

- `backend`: elapsed backend time through response preparation, including authentication.
- `session`: account lookup time, including database/pool waits (for signed-in users).
- `holdings`: manual and brokerage holdings reads, performed concurrently.
- `prices`: default-date selection and recent closing-price reads.
- `measurements` / `tags`: sensitivity and stock-tag reads, concurrent with prices.
- `odds`: finding linked markets with supported 24-hour odds changes.
- `sql_count`: number of database queries; `sql_total` is cumulative query time,
  including waits. Parallel queries overlap, so do not add the durations together
  or compare `sql_total` to wall-clock request time as if they were equivalent.

A large stage duration identifies which database operation to inspect next. If
browser time is much larger than `backend`, inspect request queueing, the frontend
proxy, and network time as well. Timings and counts contain no SQL, holdings,
credentials, or user IDs. These headers measure your actual deployment; earlier
embedded-database benchmarks did not include your network or pool contention.
