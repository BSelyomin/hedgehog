# Hedgehog — instructions for coding agents

Hedgehog links a user's stock holdings to Kalshi prediction markets. It shows which real-world
events a portfolio depends on, what's coming up, what moved today, and how far to trust each number.

**Hedgehog never trades.** Do not add order placement, Kalshi authentication, wallets, or any
endpoint that sends money anywhere.

## The one rule that matters most: accuracy

Every number on screen is either read straight from a data source or measured from price history,
and the UI says which. When the data can't support a number, show no number.

- Never hard-code how much a stock moves when an event happens. Sensitivities come only from
  `measured_links`, computed from historical data.
- A link that fails `checkSensitivity` stays unmeasured (API type `Related`, labelled **Topic**
  on screen) with no number.
- Probabilities are the bid–ask midpoint, never the last trade.
- AI-written text (Snowflake Cortex) never introduces a number that isn't in the data passed to it.
  Code checks this (see "Snowflake Cortex").
- An AI summary without source links is hidden, not shown.
- If you are unsure what an external API returns, read its docs or call it and inspect the
  response. Do not guess field names.

## Stack

npm workspaces monorepo, Node 24+, TypeScript everywhere.

```
/web      Next.js (App Router) + Tailwind — screens only, no business logic
/server   Node.js + Express + node-cron + pg — data jobs, math, API
/shared   TypeScript types for every API response, imported by both
```

| Concern | Use |
| --- | --- |
| Database | Tiger Data (Postgres + TimescaleDB) via `pg` |
| Scheduling | `node-cron` inside the server process |
| Stock and oil prices | `yahoo-finance2` (daily closes) |
| 2-year Treasury yield | FRED API, series `DGS2` |
| Past earnings-report dates | SEC EDGAR APIs via Node's built-in fetch |
| Regression | `ml-matrix` (least squares) |
| AI | Snowflake Cortex REST APIs via Node's built-in fetch |
| Voice | ElevenLabs API, official JavaScript SDK |
| Tests | `vitest` |

Ask before adding any dependency not in this table.

### Environment variables (`.env`, never committed)

```
DATABASE_URL=
COOKIE_SECURE=
SNOWFLAKE_ACCOUNT_URL=
SNOWFLAKE_PAT=
SNOWFLAKE_CORTEX_MODEL=
SNOWFLAKE_SEARCH_DATABASE=
SNOWFLAKE_SEARCH_SCHEMA=
SNOWFLAKE_SEARCH_SERVICE=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
FRED_API_KEY=
SEC_USER_AGENT=
```

Ship a `.env.example` with these names and no values. Never print keys in logs.

## Kalshi

- Base URL: `https://external-api.kalshi.com/trade-api/v2`, the host in Kalshi's current docs
  (confirm on docs.kalshi.com).
  Market-data endpoints are public; send no credentials.
- Data hierarchy: series → events → markets.
- Use the `*_dollars` price fields (`yes_bid_dollars`, `yes_ask_dollars`, …). The older cent
  fields are deprecated.
- Endpoints we need (check exact params in the docs):
  - `GET /events?status=open&with_nested_markets=true` (paginate with `cursor`)
  - `GET /series/{series_ticker}/markets/{ticker}/candlesticks` and batch `GET /markets/candlesticks`
  - settled markets via `GET /markets` with a status filter, for the track record
- Only the poller and backfill jobs call Kalshi. Pages read from our database. Never call Kalshi
  from the browser.
- Poll every 5 minutes. Back off on 429 and 5xx responses. Log and skip a bad market rather than
  failing the whole run.

## Data model

`odds_snapshots` and `prices` are TimescaleDB hypertables on their time column.

| Table | Columns | Filled by |
| --- | --- | --- |
| `events` | ticker PK, series_ticker, title, description, category, mutually_exclusive, strike_date | poller |
| `markets` | ticker PK, event_ticker, series_ticker, title, subtitle, close_time, status, result, strike_type, occurrence_time, expected_expiration_time | poller |
| `odds_snapshots` | ts, ticker, yes_bid, yes_ask, mid, volume_24h, open_interest | poller, every 5 min |
| `prices` | ts (date), symbol, close | price loader, daily |
| `series_tags` | series_ticker, tag, source ('snowflake', legacy 'gemini', or 'manual'), reviewed boolean | tagging job |
| `stock_tags` | symbol, tag, link_type ('direct', 'measured', 'related') | sector table + 10-K job |
| `measured_links` | symbol, driver, b, se, low, high, days, reliable, computed_at | nightly job |
| `settled_markets` | ticker, category, prob_24h_before, outcome (0/1), close_time | backfill |
| `holdings` | session_id, symbol, value_usd | add-holdings screen |
| `sector_tags` | sector, tag | seeded from `server/seed/sector_tags.json` (written by a human) |
| `earnings_reports` | symbol, accession, filing_date, report_date, source_url | earnings-dates job (SEC EDGAR) |

Tags come from a **fixed list** in `server/seed/tags.json`, for example: `fed-rates`,
`inflation`, `oil`, `consumer-spending`, `recession`, `tariffs`, `sp500`, `jobs`, plus one tag
per company ticker for company markets. Never create tags outside this list.

## Matching holdings to markets

1. **Direct:** the market's series is tagged with the holding's ticker (company earnings and
   KPI markets, earnings-call mention markets).
2. **Measured:** the holding shares a tag with the market *and* `measured_links` has a reliable
   link between the holding and that tag's driver.
3. **Related:** a shared tag only. Show it, labeled, with no sensitivity number.

Drivers used for measurement: `oil` → crude oil futures (`CL=F`); `fed-rates` and `inflation` →
daily change in `DGS2`; `sp500` → SPY (this one is the stock's beta).

Exposure for an event: `linkedValue` = sum of the values of holdings linked to it;
`share` = `linkedValue / totalValue`. These show reach, not how much a holding would move.
Sort links Direct → Measured → Related. On screen these read Direct, Related and Topic (see UI).

## Math (port of `hedgehog_math.py`, in `server/src/math/`)

Port these from the attached `hedgehog_math.py` and keep its tests passing in vitest:

- `midpoint(yesBid, yesAsk)` → `{ p, spread }`
- `estimateSensitivity(y, x, controls?)` → `{ b, se }`: least squares with an intercept;
  standard error from residual variance. Use the SPY return as a control unless the driver *is* SPY.
- `checkSensitivity(b, se, days, minDays = 60)` → `{ b, low, high, days, reliable }`;
  95% range = b ± 1.96·se; reliable when `days >= minDays` and the range excludes zero.
- `beta(stockReturns, spyReturns)` over 5 years of daily data.
- `brier(probs, outcomes)` = mean of (p − outcome)².
- `calibration(probs, outcomes)` → buckets 10 points wide with count, mean prob, observed rate;
  `avgMiss` = count-weighted mean of |mean prob − observed rate|, in points.

Known-answer tests (required): on seeded synthetic data with a true b of −0.10 over 250 days,
`estimateSensitivity` recovers b within 0.02; on pure noise, `checkSensitivity(...).reliable` is
false; Brier of always predicting 0.5 is 0.25.

Use returns (or daily changes for yields), never price levels. Align dates across series
before regressing; drop days missing any series.

## Trust score (0–100)

Keep weights and thresholds in one file, `server/src/config/trust.ts`. Starting values:

| Part | Max | Formula |
| --- | --- | --- |
| Spread | 30 | 30 × clamp((10 − spreadCents) / 9, 0, 1) |
| Activity | 25 | 25 × clamp(log10(volume24h) / 5, 0, 1) |
| Depth | 20 | 20 × clamp(log10(openInterest) / 6, 0, 1) |
| Track record | 25 | 25 × clamp((15 − avgMissPts) / 13, 0, 1) for the market's category |

If the category has fewer than 30 settled markets, the track-record part is `null` and the score
is rescaled from the other three parts; the UI says "no track record yet". Bands: High ≥ 80,
Medium 60–79, Low < 60. Return every part, not just the total; the event page shows them.

## Track record

For each category, take settled markets, read the odds **24 hours before close** from candlesticks
(not at close), and pair them with the outcome. Report count, `avgMiss`, Brier score, and the
calibration buckets. Headline example: "When Kalshi said 70%, it happened X% of the time" uses the
65–75 bucket.

## Move explainer

For a day: each holding's dollar move; `fromMarket = beta × SPY return × value`;
`beyondMarket = actual − fromMarket`. The totals must add up exactly. List linked markets whose
midpoint moved 3+ points in the last 24 hours. Connect a market to a holding's move only when the
link is Measured; otherwise say it moved the same day, nothing more.

## Earnings preview

For holdings with company markets: bracket ladders scaled so they sum to 100% (show the raw sum
in a note), other KPI markets with their trust score, mention markets, and the stock's move across
each of the last 8 reports. Report dates are the SEC EDGAR filing dates of 8-K filings carrying
Item 2.02; the move runs from the last close before the filing date to the first close after it.

## Snowflake Cortex

- **Tagging:** batch the open series, send title + description, ask for JSON with tags from the
  fixed list only. Validate the response; drop unknown tags. Store with `reviewed = false`. A
  human reviews tags for series that touch the demo portfolio.
- **10-K risk factors:** per ticker, once, cached; map to the fixed tags only.
- **"Why the odds moved":** retrieve reporting from an optional Cortex Search index exposing
  `TITLE`, `URL`, and `TEXT`. Only cite retrieved source IDs; never accept model-invented URLs.
  If the index or valid sources are absent, generate no summary. This does not search the open web.
- **Number check:** before showing or speaking any AI text, extract every number in it and
  confirm each appears in the input data. Fail closed: fall back to the plain template text.
- **Provenance:** new AI tags use `source = 'snowflake'`; keep legacy Gemini rows and review states.
- **Storage:** application data stays in Tiger Data/PostgreSQL; Snowflake handles AI and optional
  source retrieval. PAT credentials stay server-side. No new SDK dependency is needed.

## Voice briefing (ElevenLabs)

Build the briefing text from a template filled with database numbers (top events this week by
share, today's move split, biggest odds move). AI may only smooth the wording, then the
number check runs. Send to ElevenLabs, cache one MP3 per day, serve at `GET /briefing`.

## API

Every response type lives in `/shared/types.ts`. Write the types first; then the web app can build
against mock data while the server is built.

`POST /holdings` · `GET /exposure` · `GET /calendar?days=14` · `GET /event/:ticker` ·
`GET /moves?date=` · `GET /earnings/:symbol` · `GET /track-record` · `GET /briefing`

Every response includes `asOf` (when the data was last updated).

## UI

Seven screens, matching the designs in `/design` (screenshots or exports from the canvas):

1. Add holdings
2. Exposure map (heatmap of holdings × events, plus a "By holding" view)
3. Event calendar (next two weeks by Kalshi event date, filter All / Company / Other)
4. Event page (odds distribution, 1-week chart, trust score breakdown, linked holdings + evidence)
5. Earnings preview
6. Move explainer
7. Track record (calibration chart, table by category, how trust is scored)

Design tokens: background `#0E1116`, card `#151A21`, border `#2A313C`, text `#E8ECF1`,
secondary text `#A3ADBA`, accent `#5AA2FF`, up `#7DB6FF`, down `#FF9F45`. Fonts: Space Grotesk
(headings), IBM Plex Sans (body), IBM Plex Mono (all numbers). Link chips use one vocabulary
on every screen, set by the Overview: Direct = `#f87171` (red); Measured links are labelled
"Related" = `#5aa2ff` (blue); unmeasured links are labelled "Topic" = dashed border. Touch targets ≥ 44 px; real `<button>` and
`<a>` elements; works at phone width. Footer on every screen: "Not financial advice. Odds from
Kalshi."

## How to work

- Work one phase at a time, in the order given in the prompt.
- At the end of each phase: run tests and lint, fix failures, commit with a clear message, and
  reply with what works, what doesn't, and anything you had to guess.
- Never delete or weaken a test to make it pass.
- Never commit `.env` or any key.
- Prefer small, readable modules over clever ones; this is demoed live to judges.
