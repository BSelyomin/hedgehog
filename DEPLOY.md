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

## Database storage and read-only mode

Kalshi lists about 145,000 open markets. Storing a five-minute odds row for each wrote roughly
500 MB an hour and filled a Tiger Data service in 17 hours, after which the service turned
read-only. Migration `010_odds_storage.sql` keeps odds history only for series a holding could
link to (about 7,000 markets), in daily chunks that are compressed after a day and dropped after
eight. A trigger on `odds_snapshots` applies the same rule to any backend writing to the
database, including one running older code.

The event chart's longer ranges read `odds_candles`: Kalshi's hourly closes for the past eight
days and its daily closes since each market was listed, one midpoint per period, for the same
linkable markets while they are open. The candlestick job fills it after the first poll at
startup, then hourly and after midnight New York. To run it by hand:

```powershell
docker compose exec backend npm run job -- odds-candles
```

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
also run nightly and at startup. Only listed securities are priced and measured; cash,
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
filing dates of 8-K filings carrying Item 2.02. It also runs after the nightly price load and at
startup. Funds such as SPY and TLT file no such reports and show none. A move needs a close on
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

## Morning briefing

The briefing runs at 8 a.m. America/New_York, with independent hourly retries at :15 after that time and catch-up after startup price loading. Generation never runs before 8 a.m. A per-session/day database advisory lock prevents concurrent voice requests, and an existing daily MP3 is reused. Failures remain eligible for retry. The API and audio lookup use the same New York date, including across UTC midnight and daylight saving changes.

The move uses the latest stored SPY trading date before today; it never treats an intraday candle as a completed session. Its date is spoken explicitly, and missing holding prices or beta estimates remain unavailable. The main linked event closing this week is selected by portfolio reach. If none close this week, the nearest upcoming event is included instead. Single-outcome bid–ask midpoint probabilities are spoken only with quotes at most 15 minutes old. Multi-outcome events keep their distributions on the event page. Historical odds changes are explicitly dated and do not imply causation.

To generate after 8 a.m.: `docker compose exec backend npm run job -- briefings`. Open the overview to play audio or read the transcript. An existing MP3 for that date is retained after a code update; the new wording starts with the next uncached day. Docker and the host must remain running. No email delivery or notification is implemented.

Briefing wording follows a conversational sequence: the last completed session, available market context, then a holding-specific event watchlist. Directions are spoken as up/down with absolute dollar amounts, dates use month names, and quote times use New York time. The deterministic template still passes the numeric guard before speech; it does not add AI explanations or unsupported causes.

Use **Refresh briefing** on the overview to regenerate today’s text and MP3 immediately, including before the automatic morning run. POST `/briefing/refresh` uses the current guest or authenticated account session and replaces the saved briefing only after successful generation. Failed requests keep existing audio. Audio responses disable browser caching so playback reflects the refreshed version.
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
and accepts only bid/ask observations at the 24-hour cutoff (within one minute before it).
Unavailable or unsupported history is omitted rather than replaced with last-trade prices.

## Track-record evidence and portfolio CSV

Track record reads verified settled Kalshi observations, not holdings CSV rows. It shows category sample sizes, close-date coverage, calibration groups, trust eligibility and up to twelve recent market observations with the exact stored quote/close times. Portfolio relevance uses reviewed series tags shared with the current guest or account holdings. This filter selects whole categories; it does not restrict the historical sample to individual stocks. The overview's global category trust calculations are unchanged.

`examples/fake-portfolio-large.csv` supplies 25 allowed demo tickers at $10,000 each ($250,000 total). Import it to exercise broader portfolio matching. It replaces the current holdings when saved and contains invented portfolio allocations only; it does not populate historical market outcomes. Reviewed tags and verified historical bid–ask quotes are still required.

The track-record main view explains the sample and compares around-70% quotes with observed outcomes. It keeps small-group warnings beside that comparison and links current events to the selected category. Technical charts and scores are under **Explore the details**. The category-linked filter says when all loaded categories are relevant, so identical views are expected rather than unexplained.

## Subject-level forecasting evidence

The track-record selector offers All history, Inflation, Interest rates, Company events and Stock market. Subject samples use exact series identities and reviewed tags; unknown or unclassified observations remain in All history. The original category aggregation and trust-score formula are unchanged. Subjects use the same calibration/Brier functions over their own matching observations. A focused current event explains the recorded Direct/Measured/Related holding evidence and opens the existing event page.

Migration 004 adds nullable series/event/title identity to settled observations. It recovers known local catalog metadata without altering quotes or outcomes. New backfill rows retain those identifiers. Run `docker compose exec backend npm run job -- history-metadata` to recover missing identity from public live/archive market responses and their event metadata. Unavailable identities remain explicit; no ticker parsing or guessed subject labels are used. Distinct-event counts describe identified events, not statistically independent observations.
