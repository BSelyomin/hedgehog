# Hedgehog

Hedgehog connects stock holdings to real-world events priced on Kalshi. It shows event reach, upcoming close times, the evidence behind a link, daily portfolio moves and historical calibration. It never trades.

The source files specify an npm-workspaces monorepo: **web/** is the frontend (Next.js App Router and Tailwind); **server/** is the backend (Express, scheduled jobs and data math); **shared/** defines API response types. These names take precedence over the request's frontend/backend folder names.

## Quick start

```
cp .env.example .env
docker compose up --build -d
```

Open http://localhost:3000, enter tickers and dollar values, and map your exposure. Docker starts a private local TimescaleDB database when DATABASE_URL is empty. For Tiger Data, set DATABASE_URL to your service connection string. See [DEPLOY.md](DEPLOY.md) for tag approval, data loading, validation, portability and deployment.

For local development, use Node 24, `npm install`, configure DATABASE_URL, then `npm run dev`. The server applies migrations on startup; `npm run migrate` also applies them explicitly. `npm run check:core` runs dependency-free core accuracy checks. `npm test` runs Vitest known-answer and accuracy tests. `npm run lint` runs strict TypeScript checks; `npm run build` checks the backend and builds Next.js.

## Data and accuracy

Kalshi's public events and market candlesticks supply dollar bid/ask quotes; midpoint probabilities never use last trades. Yahoo Finance supplies daily closes for stocks, SPY and crude oil futures. FRED supplies the two-year Treasury yield DGS2. The seeded ticker list follows the designs; the demo portfolio and human-authored sector mapping still require review. No synthetic prices, moves or sensitivities are shipped to the UI.

Direct links require reviewed company tags. Measured links require shared reviewed tags and a historical regression with enough aligned observations and a 95% interval excluding zero. Related links expose no sensitivity. Regressions use returns or daily yield changes with a SPY control; the SPY driver uses five-year beta. Driver coefficients do not become event-outcome dollar forecasts.

Trust returns spread, activity, depth and category calibration components. Category history below 30 markets is excluded and the other components are rescaled. Missing quote data leaves trust unavailable. Track records use midpoint candles ending at or within one minute before the timestamp 24 hours before close; absent quotes are skipped. A resumable backfill retries failed pages. The 70% headline has its own 65–75% bucket.

Move components reconcile mathematically, with unavailable values when aligned closing prices or beta history are missing. Earnings ladders normalize only a complete quoted, mutually exclusive bracket set. Past-report move history is omitted until a free report-date source is verified.

## Sponsor tools

**Tiger Data:** Postgres via pg stores markets, holdings, tags and measured links; TimescaleDB hypertables store five-minute odds and daily prices. Screens read our database through the backend. Docker's local TimescaleDB provides the same schema for transfer and development.

**Gemini:** Google's official JavaScript SDK assigns only fixed-list tags, caches a supplied 10-K risk-factor section once per ticker, and writes Google Search-grounded event context in a scheduled job. Market series tags remain unreviewed until a person approves them. Every visible summary must have safe source links and all numeric tokens supported by its input. Unsupported text is hidden. The `risk-factors` job accepts a symbol, local filing-text path and HTTPS filing URL; automatic SEC filing discovery is not implemented.

**ElevenLabs:** The official SDK converts a database-backed template briefing into MP3, cached per anonymous portfolio session and UTC date. Playback appears on the overview when audio is available. Pages only read the cache; scheduled jobs create it. Templates go through the same number guard. Optional Gemini wording smoothing is omitted to preserve exact template facts.

## Status

All context files and seven design exports were checked before code creation. Code and documentation address all eight planned phases, but their live-data finish lines and production readiness are **not certified**. npm DNS and missing Docker integration prevent full installation, Vitest, lint/build and container execution here. No API credentials or populated database are present, so sample markets and regression links cannot be printed honestly. The supplied `.git` directory is not a functioning repository; phase commits could not be made. See [questions.txt](questions.txt) and [VALIDATION.md](VALIDATION.md) for the remaining work.

[NUMBERS.md](NUMBERS.md) maps displayed numbers to sources. [SUBMISSION.md](SUBMISSION.md) is a draft for human review; it avoids unverified completion claims.
