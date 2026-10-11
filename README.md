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

Direct links require reviewed company tags. Measured links require shared reviewed tags and a historical regression with enough aligned observations and a 95% interval excluding zero. Unmeasured shared-topic links expose no sensitivity. Every screen uses one vocabulary, set by the Overview: Direct (red), Related (blue, a measured link) and Topic (dashed, unmeasured). The event page also restates each measured coefficient as a sentence, using only the stored coefficient, its 95% range and the number of trading days. Regressions use returns or daily yield changes with a SPY control; the SPY driver uses five-year beta. Driver coefficients do not become event-outcome dollar forecasts.

Holdings can be listed securities, cash or savings, Treasuries or CDs, bonds, or property. Securities are measured against five drivers: the S&P 500, crude oil, the 2-year and 10-year Treasury yields, and the weekly 30-year mortgage rate. Every measurement stores a typical effect, so each holding's drivers are ranked and the screens say which matters most: the 10-year yield for a long bond fund, crude oil ahead of the stock market for an oil producer. Holdings without a ticker are never regressed. Where their own terms give an exact figure it is shown as Calculated (interest per point of rate, a bond's price change from modified duration, interest on an adjustable mortgage); otherwise they are topic links with no number, and property links only to markets that name its state or the whole country.

Trust returns spread, activity, depth and category calibration components. Category history below 30 markets is excluded and the other components are rescaled. Missing quote data leaves trust unavailable. Track records use midpoint candles ending at or within one minute before the timestamp 24 hours before close; absent quotes are skipped. Backfill retains failed pages for explicit manual resumption. The 70% headline has its own 65–75% bucket.

Move components reconcile mathematically, with unavailable values when aligned closing prices or beta history are missing. The Earnings screen follows the design: upcoming reports for holdings whose next earnings call Kalshi has dated, then one company's preview. It shows only markets about reported results. Kalshi lists no company revenue brackets, so the lead card reads an operating metric from its ladder of "above X" markets and states where even odds fall, using the two markets either side of 50%. Earnings ladders normalize only a complete quoted, mutually exclusive range ladder: its buckets plus any open-ended end caps. Past report dates come from SEC EDGAR 8-K filings carrying Item 2.02; each move runs from the last close before the filing date to the first close after it. Report dates load only when `SEC_USER_AGENT` is set. The calendar places each event on Kalshi's own event date (occurrence time, strike date or expected expiration) and names the field used, falling back to the market close.

The **Forecasts** page uses a vertical table with one row per event family across dates, times and targets. S&P price/range/threshold/up-down formats share one row; other repeated series/metric formats are also consolidated. Snowflake evaluates the full contract set together for one best-effort driver forecast and uncalibrated self-rated confidence. Expand a row to see its estimated stock effects and every original contract's odds and scenario. The backend computes dollar effects from reliable sensitivities; event odds remain separate Kalshi bid–ask midpoints and overlapping scenarios are never summed. Verified S&P/Treasury scenarios and manual assumptions remain available. Assumptions are cached by holdings/models/contract identity, so quote changes do not regenerate them. Stocks without reliable measurements get no dollar estimate. Expand Additional forecast tools for manual scenarios and the next-session baseline. See [FORECASTS.md](FORECASTS.md) for methods and testing steps.

## Sponsor tools

Failed provider requests and background tasks are not retried automatically. Successful
data schedules continue normally; stopped work requires an explicit action. Docker services
also have automatic restarts disabled. Forecasts reuse saved estimates and expose **Retry
estimate** for a single manual attempt after a failure. An unsupported number in AI prose
hides the explanation while preserving independently validated estimates. See
[DEPLOY.md](DEPLOY.md#request-failures-and-manual-recovery) for operational recovery.

**Tiger Data:** Postgres via pg stores markets, holdings, tags and measured links; TimescaleDB hypertables store five-minute odds and daily prices. Screens read our database through the backend. Docker's local TimescaleDB provides the same schema for transfer and development.

**Snowflake Cortex AI:** REST calls assign only fixed-list tags and analyze a supplied 10-K risk-factor section once per ticker. Configure `SNOWFLAKE_ACCOUNT_URL`, `SNOWFLAKE_PAT` and `SNOWFLAKE_CORTEX_MODEL`; no additional SDK is needed. New series tags have `source = 'snowflake'` and remain unreviewed until a person approves them. The migration preserves historical Gemini/manual provenance and approvals. The `risk-factors` job accepts a symbol, local filing-text path and HTTPS filing URL; automatic SEC filing discovery is not implemented.

**Event context:** Optional Cortex Search retrieves reporting from your own index with `TITLE`, `URL` and `TEXT` columns. This replaces Google Search grounding; automatic open-web search is not implemented. Summaries cite only retrieved HTTPS sources and may use only numbers in the supplied market data. Missing configuration, sources or supported numbers means no new summary. See [DEPLOY.md](DEPLOY.md) for setup. Application storage remains in Tiger Data/PostgreSQL, independently of Snowflake.

**ElevenLabs:** The official SDK converts a database-backed template briefing into MP3, cached per account or guest portfolio and holdings snapshot. Playback appears on the overview when audio is available. Scheduled jobs create it from 8 a.m. New York time, and Reload briefing prepares a missing snapshot on request. Unchanged holdings reuse the saved audio even when the date or Kalshi quotes change. Templates go through the same number guard. Optional AI wording smoothing is omitted to preserve exact template facts.

## Status

Docker setup, Kalshi polling, Yahoo price loading, Snowflake tagging and one Cortex Search query have run against live services. Series tags were bulk-approved on October 9, 2026 without individual review; 103 plainly incorrect mappings were withdrawn on October 10 and several debatable groups remain approved (see [REVIEW-TAGS.md](REVIEW-TAGS.md)). The human sector mapping is still empty, so links come only from company tags and the four measured drivers. SEC report dates need `SEC_USER_AGENT`. See [VALIDATION.md](VALIDATION.md) for current checks and the historical phase log; production readiness is not certified.

[NUMBERS.md](NUMBERS.md) maps displayed numbers to sources. [SUBMISSION.md](SUBMISSION.md) is a draft for human review; it avoids unverified completion claims.

## Brokerage accounts

Read-only SnapTrade linking is available under **Brokerages** for signed-in users, with separate sandbox and live modes. Manual entry and CSV imports remain available. Configure commercial test keys and follow [SNAPTRADE.md](SNAPTRADE.md) for sandbox setup and the test checklist. Docker passes the connector settings to the backend.
