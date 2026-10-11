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

## Vercel services

The root `vercel.json` deploys **web** (Next.js) and **server** (Express) as services in
one Vercel project. The web service owns all public paths, including `/api/*`. Its
Node route handler calls the internal server using the `HEDGEHOG_SERVER_URL` binding,
stripping only the public `/api/` prefix. Express still sees `/exposure`, `/auth/session`,
etc. The server has no public rewrite. There is no third root/container application:
the root Dockerfile builds these same applications for local Compose.

### Project setup

1. Import this repository with **Root Directory .**, **Node.js 24.x** and **Fluid compute**
   enabled. Keep the repository workspace/shared files available. Build, install and framework
   settings are defined separately on each service. Remove the previous frontend-only Root
   Directory `web` setting and any manually configured `API_INTERNAL_URL` in Vercel.
   Both services use the configured `npm ci` install and `npm run build` commands
   in their own directory. Their package manifests explicitly declare the development
   dependencies needed there: TypeScript, Vitest and Node typings. Vitest is required
   because strict TypeScript checks include the test files. Root-only development
   dependencies are not automatically included by a service-only workspace install.
   Keep development dependencies enabled for builds. Do not use workspace selectors
   such as `npm run build -w server` inside a standalone service build context.
   If a log says "This is not the tsc command you are looking for", `npx` fetched
   the unrelated `tsc` package because the real compiler was absent. Install the declared
   TypeScript dependency; installing the package named `tsc` does not fix it.
   Next.js uses `web/tsconfig.build.json` to check the frontend application and shared
   types during production builds. Frontend integration tests import backend helpers,
   so they remain in the full monorepo `npm run lint` and `npm test` checks using
   `web/tsconfig.json`; a web-only deployment does not need PostgreSQL or AI dependencies
   to type-check those tests. Strict application checking remains enabled.
2. These cron intervals and the server's 800-second duration require **Pro or Enterprise**.
   Hobby accepts only daily cron schedules and cannot deploy this configuration unchanged.
   The web proxy retains its 120-second function limit and existing request deadlines.
3. Set the root `.env.example` variables in Vercel's project environments: a reachable Tiger
   Data/TimescaleDB `DATABASE_URL`, provider credentials as needed, `APP_URL` equal to the
   production frontend origin, and `COOKIE_SECURE=true`. Preserve the SnapTrade encryption
   key for existing accounts. Shared project variables remain server-side; never use
   `NEXT_PUBLIC_` for credentials. Preview deployments should use their own database and
   callback origin if they are intended to save/import data.
4. Set `CRON_SECRET` to a random secret of at least 16 characters. Vercel sends it as
   `Authorization: Bearer <secret>` on Cron requests. Both manual and scheduled operational
   calls require it. Cookies and the fact that a service is internal do not authorize these
   calls. The web proxy forwards Authorization only under `/api/internal/`.
5. **Do not set `HEDGEHOG_SERVER_URL` yourself.** Vercel generates the URL for the calling
   web service at function runtime. It is not used during builds or in middleware.

### Migrations and first import

The Vercel entry point is `server/src/server.ts`. It exports Express without listening on
an application port, starting node-cron or running migrations during every cold start.
Database pools attach to Vercel's function lifecycle. After a deployment with schema changes,
send an authenticated **POST /api/internal/migrate**, then poll authenticated
**GET /api/internal/status** until `pendingMigrations` is empty and `readOnly` is false.
Migrations run on Vercel, use the existing database advisory lock, and include seed data.
A 202 response acknowledges background work; it does not report that the operation succeeded.
Check function logs if status does not become ready. No migration runs during the build.

For a fresh database, explicitly request **GET /api/internal/jobs/poll**,
**GET /api/internal/jobs/price-history**, **GET /api/internal/jobs/earnings-dates** and
**GET /api/internal/jobs/bootstrap** with that same bearer token after migrations finish.
Run these initial imports separately and inspect their logs before requesting large optional
backfills. The poller saves completed page cursors and yields after five minutes; a later cron
continues the import. Other jobs retain their existing per-series, per-item or candle progress
where implemented. Large initial tagging/backfills remain subject to the 800-second function
limit and must be monitored; completion of a 202 invocation is not guaranteed by HTTP status.

### Scheduled work and recovery

Twelve Vercel Cron rules replace the persistent process's schedules, including the five-minute
poller, hourly prices/enrichment/brokerage/briefing work, nightly history and daily report-date
work. UTC rules for New York daily jobs cover both possible UTC hours; the handler skips the
one outside the intended Eastern hour. Cron runs on the production deployment, not previews.
An authenticated manual request can add `?force=1` to bypass this time-of-day check.

The existing `runJob` database lock and heartbeat protect concurrent requests and preserve
failure policies: Kalshi data jobs resume on their next schedule; other failed schedules stay
stopped. **POST /api/internal/resume/<job>** acknowledges a stopped schedule, then its next
invocation can run. This does not clear individual provider-task stop markers. For those, use
an explicit CLI job from a configured local checkout (`npm run job -- <job>`), as before.
Forecast AI and operational work register with `waitUntil` so sending a response does not
immediately freeze them. Durable AI caches, validation, user authentication and portfolio
response caches are preserved. In-memory caches are per warm function instance and can be
lost on scaling or cold starts; they are not a shared distributed response cache.

Do not leave the home-server backend scheduling against the same production database if
Vercel owns the schedules. Existing database locks prevent overlapping runs, but do not
prevent a second scheduler from starting another run after the first has finished. Local
Docker deployment remains supported: it still starts `server/src/index.ts` with its original
scheduler, uses Compose's `API_INTERNAL_URL=http://backend:4000` and a local database when
`DATABASE_URL` is empty. No Tailscale/public backend URL is needed for Vercel service calls.

### Local and deployment checks

Use a recent Vercel CLI with Services support. From the repository root run:

```bash
vercel dev
```

After changing build dependencies, redeploy once without reusing the old build cache:

```bash
npx vercel deploy --prod --force
```

If a build still exits with 127, inspect the failing service's full build log for
`tsc: not found` or `next: not found`. Confirm the service's install command ran for that
service and that the project Root Directory is `.`. The final exit-code line alone
does not identify which executable was missing.

For a compiler exit 1, retrieve the deployment's build output instead of the client
debug stack (replace the example URL with the failed deployment URL):

```bash
npx vercel inspect https://your-failed-deployment.vercel.app --logs
```

Find the first `error TS...` diagnostic. The server command prints compiler
diagnostics and keeps strict checking of application and test files enabled. A local
comparison is `npm --prefix server --workspaces=false run build` from the repository
root. CLI build-log reference: https://vercel.com/docs/cli/inspect.

The SWC lockfile warning means optional compiler packages for other platforms are
missing from the lockfile. To let Next.js repair it on a machine with npm-registry
access, run `npm run build -w web` locally from the repository root, inspect the
resulting package-lock.json changes and include them in the next deployment.

For local development, `vercel dev` runs both services and injects the binding. `vercel dev -L` selects local-only
operation. Configure database/provider variables and `CRON_SECRET` for the local environment
as well. Cron timers do not run automatically locally: call the authenticated endpoints
manually. With no secret, maintenance fails closed. With no runtime binding on Vercel, the
proxy returns JSON 503 instead of trying localhost.

After migration, check `/api/auth/session`, sign in, read your portfolio, use Reload, and
play an existing briefing. Unauthenticated `/api/internal/jobs/poll` must return 401; an
unauthenticated request when CRON_SECRET is not configured returns 503. Root paths like
`/auth/session` do not expose the Express service. Check Vercel's Cron/function logs for
accepted, skipped, stopped and completed work. Secrets are never included in logs.

See [Services](https://vercel.com/docs/services),
[bindings](https://vercel.com/docs/services/bindings),
[routing](https://vercel.com/docs/services/routing),
[Cron authentication and execution](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[Cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and
[function duration limits](https://vercel.com/docs/functions/configuring-functions/duration).

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

## Page cache lifetime and database timeouts

Private browser page responses and the backend snapshots for Overview/exposure, Calendar,
Earnings, Moves, Forecasts and briefing metadata have a maximum lifetime of **15 minutes**,
defined once in `shared/cache.ts`. Browser F5 clears browser memory but can reuse a warm
backend instance's snapshot. Navigation reuses browser responses. Backend snapshots remain
local to each process/Vercel instance; a restart, cold start or another instance can require
a new build. Reload bypasses page snapshots. Successful AI estimates keep their existing
input-based durable cache; page expiry does not rerun unchanged AI or clear stopped failures.

Backend reads still authenticate and check current manual/imported holdings before reusing a
snapshot. Holdings changes, completed-price/date boundaries, and Forecasts' contract-close
and quote-freshness limits can expire data sooner. Increasing the lifetime reduces repeated
expensive reads, but cannot serve authenticated data during a database connection failure.
The original `asOf` is preserved, so a cache hit does not make an old quote look new.

“Database request timed out” is returned for PostgreSQL code `57014` (query cancelled).
The backend sets a 20-second statement limit and a 25-second client query limit. It is a
query failure, not proof of a database outage or read-only storage. Heavy quote/history
queries and lock waits are possible causes; production logs are needed to identify which.
The 20-second limit remains in place so slow work does not tie up the database indefinitely.

Failed page queries now log `[Database] query_failed` with a static operation label, error
code, elapsed milliseconds, and pool connection/waiter counts. They omit SQL, parameters,
credentials and portfolio data. For example, `exposure_quotes` identifies the linked-market
quote lookup, while `forecast_candidates`, `forecast_quotes`, `track_record`, `prices`,
`session`, `holdings` and `brokerage_holdings` identify other reads. Pair this with the existing
`API request failed` route and the response's `Server-Timing` header. No automatic retry is added.

For a timeout, run these read-only checks in your database SQL console while it is happening:

```sql
SELECT current_setting('transaction_read_only') AS read_only,
       current_setting('max_connections')::int AS connection_limit,
       (SELECT count(*) FROM pg_stat_activity) AS connections,
       pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT pid, state, now() - query_start AS query_age,
       wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY query_start;
```

`wait_event_type = 'Lock'` points to blocking work; long active queries without blockers point
to query execution/resource pressure. The page pool allows 10 connections and the AI pool 2
per backend instance, so deployments running concurrently can multiply database demand.
Vercel's `attachDatabasePool` lifecycle integration is already present. Do not raise timeout
or pool limits without identifying the failed query and checking database capacity first.

To test the longer cache, load a page, wait more than five but less than fifteen minutes,
then F5. A reused backend snapshot shows `exposure_cache_hit`, `earnings_cache_hit`,
`moves_cache_hit`, `forecasts_cache_hit` or `briefing_cache_hit` in `Server-Timing` and keeps
its original source times. At fifteen minutes, or on Reload, the relevant build/read runs
again. Saving changed holdings must update the next response immediately. A forecast may
expire earlier when a contract closes or its quote exceeds the existing freshness limit.

## Database storage and read-only mode

Kalshi lists about 145,000 open markets. Storing a five-minute odds row for each wrote roughly
500 MB an hour and filled a Tiger Data service in 17 hours, after which the service turned
read-only. Migration `010_odds_storage.sql` keeps odds history only for series a holding could
link to (about 7,000 markets), in daily chunks that are compressed after a day and dropped after
eight. A trigger on `odds_snapshots` applies the same rule to any backend writing to the
database, including one running older code.

The event chart's longer ranges and the Moves screen read `odds_candles`: Kalshi's hourly closes
for the past twelve days and its daily closes since each market was listed, one midpoint and
its bid–ask spread per period, for the same linkable markets while they are open. A backend
running code from before 2026-10-10 stores candlesticks without the spread and drops hourly
ones after eight days; the current job fetches a market again when it finds readings without a
spread, but the pruned days come back only as time passes. The candlestick job fills it after the first poll at
startup, then hourly and after midnight New York. To run it by hand:

```powershell
docker compose exec backend npm run job -- odds-candles
```

Asset classes come from `security_profiles`, one small row per held ticker from Yahoo. The
profiles job runs with the hourly price job and looks a ticker up when it is first held and
again after thirty days. To classify newly added tickers at once:

```powershell
docker compose exec backend npm run job -- profiles
```

### If odds stop updating

Each scheduled job runs under a database lock so that only one backend sharing the database
runs it. A backend running code from before 2026-10-10 that dies mid-job can leave its session
open, and the lock with it, for about an hour; current code ends such a session within two
minutes. To see who holds a job and when it last did anything:

```sql
SELECT a.pid, a.state, a.backend_start, a.state_change, left(a.query, 60)
FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory';
```

A holder whose `state_change` is minutes old while nothing is being stored is dead;
`SELECT pg_terminate_backend(<pid>);` frees the job.

When the database is read-only the backend still starts. It serves stored data, skips migrations
and scheduled jobs, reports `readOnly: true` from `/health` (the app shows a notice), and answers
any attempt to save with a plain message. It checks every minute and applies migrations and starts
the jobs by itself once writes are accepted again.

To get a full service writable again, either raise its storage in the Tiger Data console or free
space. Odds history is the only large table and it is rebuilt by the poller:

```sql
SET default_transaction_read_only = off;
TRUNCATE odds_snapshots;
```

That removes the stored five-minute odds history (the detail in the one-day chart and
day-over-day odds moves start again; Kalshi's hourly and daily closes in `odds_candles` remain); current odds return with the next poll. Holdings, accounts, tags, prices, measurements
and the track record are not touched.

## Asset types and drivers

Migration `008_asset_classes.sql` adds the holding type and its terms, and a typical effect to
every measurement. After upgrading, load the new yield series and re-measure so drivers can be
ranked:

```powershell
docker compose exec backend npm run job -- prices
docker compose exec backend npm run job -- measure
```

`prices` loads `DGS2`, `DGS10` and `MORTGAGE30US` from FRED and needs `FRED_API_KEY`. Both jobs
also run hourly and at startup, independently of optional AI jobs. Only listed securities are priced and measured; cash,
Treasuries, bonds and property are entered with their terms on the Add holdings screen and need
no job. The CSV import takes symbol,valueUsd for securities and optional columns for the other types; `examples/feature-tour.csv` uses them and `examples/README.md` says what each row shows. FRED publishes yields a day late,
so Moves names the yield drivers it could not yet compare for the latest session.

## Past earnings-report dates (SEC EDGAR)

Set `SEC_USER_AGENT` in the root `.env` to a string that identifies you, for example
`Hedgehog you@example.com`. SEC's fair-access policy requires a contact in the User-Agent;
without it the job sends no request and the Earnings screen says report dates are unavailable.
Then recreate the backend and load the dates:

```powershell
docker compose up -d
docker compose exec backend npm run job -- earnings-dates
```

The job looks up each held symbol in EDGAR's ticker file, reads its filing list and stores the
filing dates of 8-K filings carrying Item 2.02. It also runs nightly and at startup, independently of the price loader. Funds such as SPY and TLT file no such reports and show none. A move needs a close on
both sides of the filing date, so run `prices` first for newly added holdings.

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
and never substitutes another date. `range=day|week|month|quarter` sets how far back the
window opens: on the last session at or before that date. A close more than 30 days older
than the date wanted is not used. Use **Latest trading session** to return to the
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

Moves now has a dedicated query path: it reads the holdings, the closes at the two
ends of the window per symbol, stored sensitivities, reviewed tags, markets with a
supported 3+ point odds move, and the markets that settled inside the window. It does
not build the exposure map, calculate trust scores, read settled markets outside the
window, or scan the entire prices table for freshness. On the
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
- `odds`: finding linked markets whose odds moved between the window's two closes.
- `settled`: reading the linked markets that settled inside the window.
- `sql_count`: number of database queries; `sql_total` is cumulative query time,
  including waits. Parallel queries overlap, so do not add the durations together
  or compare `sql_total` to wall-clock request time as if they were equivalent.

A large stage duration identifies which database operation to inspect next. If
browser time is much larger than `backend`, inspect request queueing, the frontend
proxy, and network time as well. Timings and counts contain no SQL, holdings,
credentials, or user IDs. These headers measure your actual deployment; earlier
embedded-database benchmarks did not include your network or pool contention.

## Request failures and manual recovery

SnapTrade performs one HTTP attempt per request. Cortex has no provider retry loop, and
ElevenLabs uses `maxRetries: 0`. Kalshi is the exception: its market-data requests wait and try
again when Kalshi answers 429 or 5xx (up to five attempts, waiting 1, 2, 4 and 8 seconds or
as long as Kalshi asks, never over 30), and the jobs that read Kalshi (`poll`, `odds-candles`
and `track-record`) run again at their next schedule after a failure. They are never stopped,
and a stop marker left for one of them by a backend on older code is ignored. Failed forecasts persist a stopped status in
PostgreSQL; ordinary reloads, quote changes and backend restarts do not retry them. Pending
forecast polling only checks work already started. Click **Retry estimate** for one explicit
attempt after correcting the problem. Rebuild both services to apply these changes:

```sh
docker compose up -d --build backend frontend
```

`unsupported_summary_number` means AI explanation text contains a numeric token absent
from the supplied facts and accepted assumptions. Rounded figures or unit conversions can
also cause this strict check to fail. The explanation stays hidden, but independently
validated driver estimates and effects calculated from reliable measurements remain available.
This does not make AI assumptions measured facts or confidence a calibrated probability.

Individual forecast results have their own cache, independent of a combined family forecast.
The family completion still bounds its individual outputs to eight representative contracts;
click **View results** to load stock effects for all of that family's missing result estimates.
Cached results appear immediately, and a browser queue runs at most two requests at a time.
Each row shows queued/loading status followed by measured dollar effects, stock directions
and self-rated AI confidence. **View stock effects** selects a row and opens its existing
calculation; it does not start inference. Selected effects can be minimized and expanded
without discarding their data or manual inputs. Closing/reopening a family reuses saved work.

`GET /forecasts/result/:ticker/assessment` reads saved status without starting AI work.
`POST` to the same path authorizes one attempt, and `POST` to its `/retry` path explicitly
clears that result's stopped failure. These routes use the same session ownership and CSRF
checks as the existing forecast routes. Completed estimates use the existing PostgreSQL
`ai_cache` table; no migration or new environment variable is required. Updated holdings,
usable measured coefficients or contract definitions change the cache identity; changes to
live odds and sibling contracts do not. Current stock effects are calculated from the cached
assumption and the current model snapshot. Requesting one estimate preserves other page caches.

An unavailable measurement remains without a dollar estimate. Rejected explanation text is
hidden independently of a validated numeric assumption, and unsuccessful requests do not
automatically retry. Browser transport failures also stay stopped across page-cache expiry
until an explicit retry or portfolio/session change. If other AI work occupies the available
slots, a first attempt waits up to 45 seconds without holding a database connection; if
capacity stays busy, the selected result offers **Estimate this result** for a later explicit
attempt. Result estimate POSTs have a 145-second proxy deadline and a 150-second browser
deadline, within the API route's 180-second function limit; ordinary read/write proxy
deadlines remain unchanged. Unknown directions are shown as loading while work is queued,
not as “Unmeasured”; missing reliable history still produces an explicit reason with no
invented direction or value. Backend logs use
`[Forecast result AI] response_validated`, `assessment_failed` and `cache_hit`; they do not print
credentials, portfolio values or rejected provider text. Deploy both updated services; existing
Vercel install/build commands are unchanged.

Background failures are retained in `job_state`; later cron runs skip them. Successful
scheduled refreshes still run. After fixing a failed source, explicitly run its data job;
this clears the job's per-item failure markers. For a stopped aggregate schedule, acknowledge
its marker separately, then restart the backend. For example:

```sh
docker compose exec backend npm run job -- prices
docker compose exec backend npm run job -- measure
docker compose exec backend npm run job -- resume-job price-history
docker compose restart backend
```

Other schedule names that can stop include `nightly`, `enrich`, `bootstrap`, `briefings`,
`brokerages`, `earnings-dates` and `session-cleanup`. The track-record backfill runs as its own
job, `track-record`, at 10:45 pm New York, apart from the AI work in `nightly` at 10:30 pm, so
that a failed summary cannot stop the backfill and a Kalshi outage cannot stop the summaries. A manual brokerage Sync is one attempt;
the automatic account sync remains stopped until its job is explicitly acknowledged.
Read-only database mode no longer polls for recovery: restore database writes, then restart
the backend. Compose uses `restart: "no"`; restart stopped containers explicitly.

## Morning briefing

Scheduled briefings run from 8 a.m. America/New_York, with checks at :15 and after price loading for new snapshots. Failed automatic work stays stopped; those checks do not retry it. Explicit Reload briefing permits one manual attempt and can prepare a missing snapshot before 8 a.m. Content-based cache locks coalesce concurrent voice requests per session and holdings snapshot using the separate AI connection pool. Successful audio is reused across dates and market changes. The snapshot records its original New York date and the audio endpoint checks its cache version.

The move uses the latest stored completed SPY session (or a holding session if SPY is missing); it never treats an intraday candle as a completed session. Its date is spoken explicitly, and missing holding prices or beta estimates remain unavailable. The main linked event closing this week is selected by portfolio reach. If none close this week, the nearest upcoming event is included instead. Single-outcome bid–ask midpoint probabilities are spoken only with quotes at most 15 minutes old. Multi-outcome events keep their distributions on the event page. Historical odds changes are explicitly dated and do not imply causation.

To generate after 8 a.m.: `docker compose exec backend npm run job -- briefings`. Open the overview to play audio or read the transcript. An existing MP3 for unchanged holdings is retained after a code update; the new wording starts with the next uncached holdings snapshot. Docker and the host must remain running. No email delivery or notification is implemented.

Briefing wording follows a conversational sequence: the last completed session, available market context, then a holding-specific event watchlist. Directions are spoken as up/down with absolute dollar amounts, dates use month names, and quote times use New York time. The deterministic template still passes the numeric guard before speech; it does not add AI explanations or unsupported causes.

Use **Reload briefing** on the overview to prepare text and MP3 for a changed holdings snapshot, including before the automatic morning run. POST `/briefing/reload` and its compatibility alias `/briefing/refresh` use the current guest or authenticated account session. Both reuse saved audio for unchanged holdings. Failed requests leave successful cached snapshots intact. Audio responses disable browser caching and check the snapshot version.
# Coverage and portfolio review

Overview includes linked events at all future dates. Calendar includes only those whose event
date falls in the next 14 days. The event date is Kalshi's occurrence time, strike date or
expected expiration, whichever is first still in the future, and otherwise the market close.
These fields fill in as markets are next polled after migration `006_event_times.sql`.
Company choices in Earnings require reviewed direct links; they are not a list of every stock in the portfolio or a complete earnings calendar.

The fixed company catalog includes all 25 tickers in `examples/fake-portfolio-large.csv`.
Other symbols can be imported and measured when Yahoo has sufficient history, but company
tags must be explicitly added to `server/seed/tags.json` and seeded before classification.
No finite catalog or AI tagging pass guarantees a relevant Kalshi market for every holding.

Market polling writes validated pages in batches so long-dated events do not prevent later
pages of near-term events from loading. `tag-series` classifies the loaded open series in
bounded batches, including empty classifications. Successful results are cached by input
and tag-list hash in `job_state`; changed inputs or an expanded catalog are classified again.
New AI tags always remain unreviewed, and existing approvals are preserved.

`measure` derives stock driver tags only from regressions that pass the reliability check.
It removes its own tags when measurements fail and preserves independent sector/filing tags.
This supplies Measured links without inventing a human-authored sector mapping. Market series
still require review. DGS2 measurements describe historical Treasury yield associations;
they do not estimate the effect of a particular event outcome.

For newly saved holdings, refresh their data and review proposed tags from the repository root:

```powershell
docker compose exec backend npm run job -- prices
docker compose exec backend npm run job -- stock-tags
docker compose exec backend npm run job -- measure
docker compose exec backend npm run job -- tag-series
docker compose exec backend npm run job -- review-tags
```

`review-tags` covers all saved symbols, including their macro tags. See `REVIEW-TAGS.md` for
the six macro series approved during setup. Run `approve-tag SERIES_TICKER TAG` only after
reviewing the specific proposed pair, then run `backfill` to build category track records.
Backfill reads both live and archived markets, normalizes their distinct candlestick fields,
and reads the quote standing at the 24-hour cutoff: the last hourly close at or before it, at
most seven days old.
Unavailable or unsupported history is omitted rather than replaced with last-trade prices.

## Track-record evidence and portfolio CSV

Track record reads verified settled Kalshi observations, not holdings CSV rows. It shows category sample sizes, close-date coverage, calibration groups, trust eligibility and up to twelve recent market observations with the exact stored quote/close times. Portfolio relevance uses reviewed series tags shared with the current guest or account holdings. This filter selects whole categories; it does not restrict the historical sample to individual stocks. The overview's global category trust calculations are unchanged.

`examples/fake-portfolio-large.csv` supplies 25 allowed demo tickers at $10,000 each ($250,000 total). Import it to exercise broader portfolio matching. It replaces the current holdings when saved and contains invented portfolio allocations only; it does not populate historical market outcomes. Reviewed tags and verified historical bid–ask quotes are still required.

The track-record main view explains the sample and compares around-70% quotes with observed outcomes. It keeps small-group warnings beside that comparison and links current events to the selected category. Technical charts and scores are under **Explore the details**. The category-linked filter says when all loaded categories are relevant, so identical views are expected rather than unexplained.

## Subject-level forecasting evidence

The track-record selector offers All history, Inflation, Interest rates, Company events and Stock market. Subject samples use exact series identities and reviewed tags; unknown or unclassified observations remain in All history. The original category aggregation and trust-score formula are unchanged. Subjects use the same calibration/Brier functions over their own matching observations. A focused current event explains the recorded Direct/Measured/Related holding evidence and opens the existing event page.

Migration 004 adds nullable series/event/title identity to settled observations. It recovers known local catalog metadata without altering quotes or outcomes. New backfill rows retain those identifiers. Run `docker compose exec backend npm run job -- history-metadata` to recover missing identity from public live/archive market responses and their event metadata. Unavailable identities remain explicit; no ticker parsing or guessed subject labels are used. Distinct-event counts describe identified events, not statistically independent observations.

## Past events linked to current holdings

Track record retains **Forecast accuracy** and adds **Past events linked to my holdings**. The second tab uses the authenticated/guest portfolio and current reviewed Direct/Measured/Related links to find settled events, grouped by Kalshi event ID. It shows at most twelve recent events, supports subject and holding filters, and retains each contract's earlier bid–ask midpoint, quote time and final Yes/No outcome. An event-page link opens this tab directly. It does not reconstruct historical holdings or use current dollar values to report historical profit/loss.

Migration 005 stores verified event release times separately from market close times. `server/seed/event_releases.json` starts with eight observed CPI/core/YoY event identifiers covering the June, July and August 2026 reports. Dates/times come from the official BLS archive release headers, linked in each record. Seed insertion is idempotent and preserves existing release records. Expand this catalog only with independently verified event identity, actual publication time and original source URL.

Price comparisons currently support the 25 sample U.S. securities in `price_window_symbols.json`, with verified pre-open releases. They compare the previous weekday's close with the release day's close, aligned to SPY. Both benchmark closes and both stock closes must exist. Weekend gaps are handled; exchange holidays, intraday/after-hours releases, missing closes and same-day incomplete candles are omitted pending a verified exchange calendar. Unsupported symbols show no move. These are raw daily closing-price changes from Yahoo, not total returns or causally attributed event effects. Multiple Kalshi events may describe the same release.

GET `/holdings-history?subject=inflation&symbol=TLT` accepts only supported subject IDs and an optional ticker, and resolves ownership exclusively from session middleware. A quote after the verified release is marked as not a prior forecast. Missing release times never fall back to Kalshi close times. The underlying forecast-accuracy calculations and trust scores are unchanged.

## Track Record themes and forecast horizons

By Market and By Holding group reviewed series into Company markets, Oil, Fed rates, Inflation, Treasury yields, Stock market, Mortgage rates and Credit. Portfolio relevance filters which whole theme records appear, using the current holdings matcher, including asset-specific rules. It does not score stock returns or reconstruct historical ownership. The main view prioritizes themes with actual records. Reviewed themes without records are collapsed; themes without reviewed series or scored observations are not promoted as working coverage. By Holding filters current stocks, ETFs and funds without changing the whole-theme statistics.

The horizon selector accepts 1, 24, 168 or 720 hours before trading close (`GET /track-record?horizon=168`). Migration `013_one_hour_forecasts.sql` adds the one-hour horizon. Migration `012_forecast_horizons.sql` stores independent bid/ask observations for each horizon and makes missing-quote exclusions horizon-specific. It does not copy legacy probabilities into longer horizons. Quotes must end at or before the target and no more than 60 seconds before its whole-second timestamp. A known official release time takes precedence over Kalshi occurrence metadata when excluding already-known outcomes. Missing release timing remains explicit.

After migrations, run `docker compose exec backend npm run job -- backfill-horizons KXCPI KXCPIYOY KXCPICORE` for a scoped inflation backfill, or omit the series arguments to process every reviewed series. The job also runs nightly. It requests history separately for each horizon, retains a failed page for retry, and does not classify API outages as missing quotes. Large catalogs can take a long time; no historical probability is interpolated or borrowed from another horizon.

The existing category-based trust score and optional holdings price comparisons continue to use the legacy 24-hour record. Theme/horizon selection changes the displayed evaluation only. Contract counts and Kalshi event IDs are shown separately from sourced release counts; event IDs and themes may overlap. Calibration, Brier and intervals are descriptive, not guarantees or causality claims.

## Combined holdings after merging asset support

Migration `012_portfolio_asset_types.sql` extends the existing combined manual/SnapTrade view with asset types and terms. Rebuild the backend to apply it before running the jobs. Price loading, measurement, sector tags, and SEC dates include imported securities; cash, directly held bonds, and property retain their own terms. Saving or clearing manual/CSV holdings does not duplicate or remove connected positions. Both `/briefing/reload` and the compatibility `/briefing/refresh` route reuse audio for unchanged holdings; neither bypasses the content cache.
