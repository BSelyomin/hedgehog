# Hedgehog

Hedgehog connects stock holdings to real-world events priced on Kalshi. It shows event reach, upcoming close times, the evidence behind a link, daily portfolio moves and historical calibration. It never trades.

The source files specify an npm-workspaces monorepo: **web/** is the frontend (Next.js App Router and Tailwind); **server/** is the backend (Express, scheduled jobs and data math); **shared/** defines API response types. These names take precedence over the request's frontend/backend folder names.

## Quick start

```
cp .env.example .env
docker compose up --build -d
```

Open http://localhost:3000, create an account or continue as a guest, enter tickers and dollar values, and map your exposure. Docker starts a private local TimescaleDB database when DATABASE_URL is empty. For Tiger Data, set DATABASE_URL to your service connection string. See [ACCOUNTS.md](ACCOUNTS.md) for account features and a manual test checklist, and [DEPLOY.md](DEPLOY.md) for tag approval, data loading, validation, portability and deployment.

For local development, use Node 24 and `npm ci`, then configure DATABASE_URL. Start `npm run dev -w server` and `npm run dev -w web` in separate terminals (the combined launcher is not Windows-compatible). The server applies migrations on startup; `npm run migrate` also applies them explicitly on Linux. `npm run check:core` runs dependency-free core accuracy checks. `npm test` runs Vitest known-answer and accuracy tests. `npm run lint` runs strict TypeScript checks; `npm run build` checks the backend and builds Next.js.

## Data and accuracy

Kalshi's public events and market candlesticks supply dollar bid/ask quotes; midpoint probabilities never use last trades. Yahoo Finance supplies daily closes for stocks, SPY and crude oil futures. FRED supplies the two-year Treasury yield DGS2. The seeded ticker list follows the designs; the demo portfolio and human-authored sector mapping still require review. No synthetic prices, moves or sensitivities are shipped to the UI.

Direct links require reviewed company tags. Measured links require shared reviewed tags and a historical regression with enough aligned observations and a 95% interval excluding zero. Related links expose no sensitivity. Regressions use returns or daily yield changes with a SPY control; the SPY driver uses five-year beta. Driver coefficients do not become event-outcome dollar forecasts.

Trust returns spread, activity, depth and category calibration components. Category history below 30 markets is excluded and the other components are rescaled. Missing quote data leaves trust unavailable. Track records use midpoint candles ending at or within one minute before the timestamp 24 hours before close; absent quotes are skipped. A resumable backfill retries failed pages. The 70% headline has its own 65–75% bucket.

Move components reconcile mathematically, with unavailable values when aligned closing prices or beta history are missing. Earnings ladders normalize only a complete quoted, mutually exclusive bracket set. Past-report move history is omitted until a free report-date source is verified.

## Sponsor tools

**Tiger Data:** Postgres via pg stores markets, holdings, tags and measured links; TimescaleDB hypertables store five-minute odds and daily prices. Screens read our database through the backend. Docker's local TimescaleDB provides the same schema for transfer and development.

**Snowflake Cortex AI:** REST calls assign only fixed-list tags and analyze a supplied 10-K risk-factor section once per ticker. Configure `SNOWFLAKE_ACCOUNT_URL`, `SNOWFLAKE_PAT` and `SNOWFLAKE_CORTEX_MODEL`; no additional SDK is needed. New series tags have `source = 'snowflake'` and remain unreviewed until a person approves them. The migration preserves historical Gemini/manual provenance and approvals. The `risk-factors` job accepts a symbol, local filing-text path and HTTPS filing URL; automatic SEC filing discovery is not implemented.

**Event context:** Optional Cortex Search retrieves reporting from your own index with `TITLE`, `URL` and `TEXT` columns. This replaces Google Search grounding; automatic open-web search is not implemented. Summaries cite only retrieved HTTPS sources and may use only numbers in the supplied market data. Missing configuration, sources or supported numbers means no new summary. See [DEPLOY.md](DEPLOY.md) for setup. Application storage remains in Tiger Data/PostgreSQL, independently of Snowflake.

**ElevenLabs:** The official SDK converts a database-backed template briefing into MP3, cached per account or guest portfolio and UTC date. Playback appears on the overview when audio is available. Pages only read the cache; scheduled jobs create it. Templates go through the same number guard. Optional AI wording smoothing is omitted to preserve exact template facts.

## Status

Docker setup and Yahoo price loading have been verified locally. Kalshi connections currently reset from both the Windows host and Docker, so market data remains unavailable in this environment. Snowflake needs user-supplied credentials and an optional reporting index before live AI validation. Human sector mappings and series-tag approval are still required. See [VALIDATION.md](VALIDATION.md) for current checks and the historical phase log; production readiness is not certified.

[NUMBERS.md](NUMBERS.md) maps displayed numbers to sources. [SUBMISSION.md](SUBMISSION.md) is a draft for human review; it avoids unverified completion claims.
