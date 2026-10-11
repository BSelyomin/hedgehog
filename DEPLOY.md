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

## Vercel frontend

Vercel hosts the Next.js frontend and its existing `/api` proxy. Keep Express running on
your home server or another persistent Node/Docker host: it runs migrations, maintains
database connections and schedules the data jobs inside its process.

1. Import this Git repository into Vercel. Set **Root Directory** to `web` and enable
   **Include source files outside of the Root Directory in the Build Step**. The frontend
   needs the root npm workspace lockfile, root TypeScript configuration and `shared/`.
2. Select the **Next.js** framework and **Node.js 24.x**. Vercel reads `web/vercel.json`:
   it installs the root workspace with `npm ci --prefix .. --include=dev` and builds only the frontend
   with `npm run build`. Leave **Output Directory** at the Next.js default. Fluid compute
   is enabled, and the API route allows 120 seconds so the proxy's existing 25-second
   read and 85-second write deadlines can return their JSON responses.
3. In Vercel's Environment Variables, set `API_INTERNAL_URL` for every environment you
   deploy. Use your backend's publicly reachable HTTPS origin, for example
   `https://api.example.com`, without `/api`. Express serves `/exposure`, `/holdings`, etc.;
   the frontend proxy maps `/api/exposure` to `/exposure` and forwards authentication
   cookies, refresh headers, JSON errors and audio. This variable stays server-side;
   do not add a `NEXT_PUBLIC_` prefix.
4. On the backend, set `APP_URL` to the final frontend origin, such as
   `https://hedgehog.example.com`, and `COOKIE_SECURE=true`. Keep `DATABASE_URL`,
   SnapTrade credentials and encryption key, Snowflake credentials and other provider
   keys on that backend. Recreate the backend after changing its environment. The
   existing encryption key must remain the same to read previously linked accounts.
5. Deploy, then check `/api/auth/session` on your Vercel origin, sign in, read your portfolio
   and try a page's Reload button. A signed-out `/api/auth/session` returns JSON with
   `user: null`; a successful sign-in should set the session cookie through the proxy.
   Redeploy after changing Vercel environment variables.

`API_INTERNAL_URL` cannot be `localhost`, `http://backend:4000`, or a tailnet-only address
when the frontend runs on Vercel. In particular, the existing Tailscale Serve port 8443
marked **tailnet only** is not reachable by Vercel. Provide a public HTTPS route to the
backend without replacing Immich's existing Funnel mapping. The backend's host/tunnel
must forward to Express on port 4000; Docker Compose currently keeps that port private,
so its reverse proxy must reach the backend container or a deliberately configured host
binding. Test that origin's `/auth/session` from outside your tailnet before deploying.

For local frontend development, copy `web/.env.example` to `web/.env.local` if you need
to override the default backend at `http://127.0.0.1:4000`. The root `.env` continues to
configure the backend and Docker stack.

See Vercel's [monorepo shared-file settings](https://vercel.com/docs/monorepos/monorepo-faq),
[configuration reference](https://vercel.com/docs/project-configuration/vercel-json) and
[function duration settings](https://vercel.com/docs/functions/configuring-functions/duration).

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
