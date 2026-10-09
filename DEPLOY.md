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

Follow [Create a Cortex Search service](https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search) and [query/access requirements](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service). Populate the index with reporting you have permission to use, keep it current, and grant the token's role usage on the database, schema and search service. Provisioning the index and ingesting news are not automated by this repository. The index is optional; tagging and filing analysis work without it.

The summaries job retrieves at most five passages, then generates context with selected source IDs. URLs are taken only from retrieved rows. Unsupported numbers, invalid source IDs, missing sources, failed requests and incomplete model output prevent a new summary from being saved. The event endpoint rechecks cached summaries before showing them. This is retrieval from your index, not automatic Google/open-web search.

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
