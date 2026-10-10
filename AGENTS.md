# Hedgehog — instructions for coding agents

Hedgehog links a user's stock holdings to Kalshi prediction markets. It shows which real-world
events a portfolio depends on, what's coming up, what moved and which events moved with it, and how far to trust each number.

**Hedgehog never trades.** Do not add order placement, Kalshi authentication, wallets, or any
endpoint that sends money anywhere.

## The one rule that matters most: accuracy

Every number on screen is read straight from a data source, measured from price history, or
calculated exactly from the terms the user entered for a holding, and the UI says which. When the
data can't support a number, show no number.

- Never hard-code how much a stock moves when an event happens. Sensitivities come only from
  `measured_links`, computed from historical data.
- A **Calculated** figure is arithmetic on a holding's own terms: yearly interest on a cash balance
  per point of rate, a bond's price change from its modified duration, yearly interest on an
  adjustable mortgage balance. It never comes from a regression and is always labelled Calculated.
- When a holding has several measured drivers, always show which matters most. Importance is the
  typical effect, |b| × the driver's typical daily change, so oil, yields and the stock market
  compare on one scale. A link on a minor driver says what matters more.
- A link that fails `checkSensitivity` stays unmeasured (API type `Related`, labelled **Topic**
  on screen) with no number.
- A reliable measurement is not enough for a link. With ten years of prices almost every
  holding is reliably tied to almost every driver, however faintly. A measurement draws a link
  only when a typical move in its driver moves the holding at least `MATERIAL_SHARE` (a tenth)
  as much as a typical move in the holding's biggest driver. Below that it is a Topic link whose
  evidence says how it compares, with no estimate.
- Probabilities are the bid–ask midpoint, never the last trade. A book with no bid and no offer
  (0 and 1) has no midpoint: it shows no probability, spread or trust score, counts as no move,
  and gives the track record no reading. The poller still stores it, so readers know the book
  is empty now. The test is `emptyBook` in `server/src/services/kalshi.ts`.
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
| Treasury yields and mortgage rate | FRED API, series `DGS2`, `DGS10`, `MORTGAGE30US` |
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
- Only the poller, backfill and candlestick jobs call Kalshi. Pages read from our database. Never
  call Kalshi from the browser.
- Poll every 5 minutes. Back off on 429 and 5xx responses. Log and skip a bad market rather than
  failing the whole run.
- Every scheduled job runs under a database lock (`runJob` in `server/src/jobs/scheduler.ts`), so
  that only one of the backends sharing the database runs it. The lock's session ends itself
  after two minutes without a statement and the job sends a heartbeat while it runs, so a
  backend that dies cannot hold a job for long. Keep both when changing how jobs are locked.
- Store every market's details, but odds history only for series a holding could link to. Storing
  it for all markets filled the database in 17 hours. A database trigger enforces this for any
  backend that shares the database.

## Data model

`odds_snapshots` and `prices` are TimescaleDB hypertables on their time column.

| Table | Columns | Filled by |
| --- | --- | --- |
| `events` | ticker PK, series_ticker, title, description, category, mutually_exclusive, strike_date | poller |
| `markets` | ticker PK, event_ticker, series_ticker, title, subtitle, close_time, status, result, strike_type, occurrence_time, expected_expiration_time, floor_strike, cap_strike, open_time | poller |
| `odds_snapshots` | ts, ticker, yes_bid, yes_ask, mid, volume_24h, open_interest | poller, every 5 min, only for markets in `snapshot_series`; compressed after 1 day, dropped after 8 |
| `snapshot_series` | series_ticker | poller: series a holding could link to (approved ticker, driver or asset-type tag) |
| `odds_candles` | ticker, minutes (60 or 1440), ts (end of the period), mid, spread | candlestick job: Kalshi's hourly closes for 12 days and daily closes since listing, with the closing bid–ask spread, for open markets in `snapshot_series` |
| `candle_progress` | ticker, minutes, through | candlestick job: how far each market has been fetched |
| `security_profiles` | symbol PK, quote_type, name, sector, industry, fund_category, updated_at | profiles job: Yahoo's description of each held ticker |
| `prices` | ts (date), symbol, close | price loader, daily |
| `series_tags` | series_ticker, tag, source ('snowflake', legacy 'gemini', or 'manual'), reviewed boolean | tagging job |
| `stock_tags` | symbol, tag, link_type ('direct', 'measured', 'related') | sector table + 10-K job |
| `measured_links` | symbol, driver, b, se, low, high, days, reliable, computed_at, effect | nightly job |
| `settled_markets` | ticker, category, prob_24h_before, outcome (0/1), close_time, odds_time, series_ticker, event_ticker, title | backfill |
| `holdings` | session_id, symbol, value_usd, asset_type ('security', 'cash', 'treasury', 'bond', 'property'), details | add-holdings screen |
| `sector_tags` | sector, tag | seeded from `server/seed/sector_tags.json` (written by a human) |
| `earnings_reports` | symbol, accession, filing_date, report_date, source_url | earnings-dates job (SEC EDGAR) |
| `companies` | symbol, name | earnings-dates job (names from the SEC ticker file) |

Tags come from a **fixed list** in `server/seed/tags.json`, for example: `fed-rates`,
`inflation`, `oil`, `consumer-spending`, `recession`, `tariffs`, `sp500`, `jobs`, plus one tag
per company ticker for company markets. Never create tags outside this list.

## Matching holdings to markets

1. **Direct:** the market's series is tagged with the holding's ticker (company earnings and
   KPI markets, earnings-call mention markets).
2. **Measured:** the holding shares a tag with the market *and* `measured_links` has a reliable
   link between the holding and that tag's driver that is big enough to count (`materialRows` in
   `server/src/services/matching.ts`): at least a tenth of the holding's biggest daily driver. A
   weekly driver cannot be put on that scale, so it counts when a daily driver of its family
   does.
3. **Related:** a shared tag only. Show it, labeled, with no sensitivity number.

4. **Calculated:** the holding has no ticker (cash, a Treasury or CD, a bond, a property) and its
   asset type shares a tag with the market. Where its terms give an exact figure, show it;
   otherwise it is a Related link with no number. Property links only to housing and weather
   markets that name its state or the whole country. Rules: `server/src/services/asset-links.ts`.

Tickers, sector tags and measurements apply to listed securities only.

Drivers used for measurement: `oil` → crude oil futures (`CL=F`); `fed-rates` and `inflation` →
daily change in `DGS2`; `treasury-yields` → daily change in `DGS10`; `mortgage-rates` → weekly
change in `MORTGAGE30US`; `sp500` → SPY (this one is the stock's beta). The list lives in
`server/src/config/drivers.ts`; add a driver there and nowhere else.

Exposure for an event: `linkedValue` = sum of the values of holdings linked to it;
`share` = `linkedValue / totalValue`. These show reach, not how much a holding would move.
Sort links Direct → Calculated → Measured → Related. On screen these read Direct, Calculated,
Related and Topic (see UI).

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

The backfill (`server/src/jobs/backfill.ts`) scores settled markets of every series that can
link to a holding (`snapshot_series`), from Kalshi's live listing and its archive, and records
per series how far it got so a later run looks only at newer settlements.

- **The reading** is the close of the last hourly candlestick ending at or before 24 hours
  before close. Kalshi publishes a candlestick only when the quote changes, so that is the quote
  standing at the mark; asking for the exact minute found one for about one market in six.
  `odds_time` records when that quote was published. One more than seven days old is not used.
- **No reading, no row.** An empty book at the mark gives no reading (an older quote is not
  substituted), and a market listed for under a day has no odds a day before its close, so
  daily markets such as "gas prices tomorrow" are not scored.

For each category, take settled markets, read the odds **24 hours before close** from candlesticks
(not at close), and pair them with the outcome. Report count, `avgMiss`, Brier score, and the
calibration buckets. Headline example: "When Kalshi said 70%, it happened X% of the time" uses the
65–75 bucket.

## Categories

The portfolio is grouped two ways (`server/src/services/categories.ts`), sent as `categories`
with the exposure and calendar responses:

- **Asset class** says what a holding is; each holding has exactly one, so the groups add up to
  the portfolio. A holding the user described is classed by that description (cash, Treasury or
  CD, bond, property). A ticker is classed from Yahoo's profile of it in `security_profiles`: a
  company is a stock (with its sector); a fund is classed by its category through
  `server/seed/fund_classes.json`, written by a human from category names Yahoo returned.
  Nothing is inferred from a name: a ticker with no profile, or a fund category that is not
  mapped, is **Unclassified** and shown as such.
- **Event theme** says what kind of Kalshi event is linked to a holding. A holding is in every
  theme it has an open event in through a Direct, Calculated or Measured link, so themes overlap
  and do not add up to 100%. A theme is a tag from the fixed list, or `direct` for markets about
  the holding itself. An unmeasured topic link carries no theme, as on the Overview.

A group's value is the value of its holdings and its share is that over the whole portfolio,
each holding counted once. That is reach, not an amount at risk. A measurement under the
link floor gives no theme. Among those that remain, a theme names the holdings it matters
most to: those linked by a Calculated link, and securities whose most important measured driver
stands behind it. A group's next event is the soonest one reached by such a strong link.

One category choice is shared by the Overview, Calendar and Moves
(`web/app/screens/category-filter.ts`). The Moves response carries no categories; that screen
reads them from the exposure data in the background so the moves are not kept waiting.

## Odds chart

The event page charts one market's bid–ask midpoint with titled axes and a choice of range.
Every point is a reading from a source: one of our five-minute snapshots, or the close of a
Kalshi candlestick (`GET /markets/candlesticks`, midpoint of `yes_bid.close_dollars` and
`yes_ask.close_dollars` at `end_period_ts`). Ranges live in `server/src/services/odds-history.ts`:

| Range | Kalshi closes | Our snapshots |
| --- | --- | --- |
| 1 day | hourly | every one |
| 1 week | hourly | the last of each hour |
| 1 month | daily | the latest only |
| All time | daily, since the market's `open_time` | the latest only |

Kalshi publishes no candlestick for most periods in which the quote did not change, so the line
is stepped: it holds each reading until the next and never slopes between two readings. A
candlestick or snapshot with no bid and no offer (0 and 1) is not a quote and is not drawn.
The probability axis zooms to the readings on round levels, never to a span under ten points.
The candlestick job (`server/src/jobs/odds-candles.ts`) runs hourly for hourly closes, after
midnight New York for daily closes, and after the first poll at startup.

## Move explainer

Compares the portfolio at two closes and sets the Kalshi events of the same window beside it.
The window ends on a session (the latest by default) and opens a day, a week, a month or three
months earlier, on the last session at or before that date (`MOVE_RANGES` in
`server/src/services/move-data.ts`). The view is the whole portfolio, the shared category
choice, or one holding picked on the screen; the server sends the whole portfolio and the
screen narrows it (`web/app/screens/move-scope.ts`).

- **Today's holdings at both closes.** No history of what was held is stored, so the amount held
  now is assumed held throughout: the value entered is read as the worth at the latest stored
  close and scaled by the price to each end (`valueAt`). The screen says so. Change =
  value at the last close − value at the first.
- **Split.** `fromMarket = beta × SPY's return over the window × value at the first close`;
  `beyondMarket = change − fromMarket`. The totals must add up exactly and cover listed
  securities; state the value of holdings with no daily price.
- **Drivers.** Compare each measured driver's estimated part of the window (sensitivity × the
  driver's change × value at the first close) and highlight the largest. A sensitivity under
  the link floor gives no estimate. Those estimates overlap, so they are compared and never
  summed; name any driver with no published reading at both ends.
- **Kalshi over the same window**, close to close (4:00 pm New York):
  - *Settled*: markets that closed inside it, from `settled_markets`, with the odds a day
    before each closed; an event leads with the result furthest from those odds.
  - *Odds that moved*: markets open at the last close whose midpoint moved 3+ points between
    the quote standing at each close. That quote is the newest candlestick close or snapshot at
    or before the instant, no more than seven days old, and each reading is shown with its
    time. Only quotes at most `MAX_MOVE_SPREAD` (10 cents) wide at both ends are compared: a
    wider quote's midpoint jumps when one side of the book steps back.
- **What an event has to do with a move.** Only a Measured link is set beside a holding's move,
  and then through its driver: the driver's own change and the holding's estimate from it. A
  Direct link states the holding's move and that nothing measured ties them; a Calculated or
  Topic link states no figure. Never say an event caused a move.
- Events linked only by an unmeasured topic are hidden until asked for, as on the Overview.

## Earnings preview

Laid out as in `/design`: upcoming reports on the left, then the chosen company's preview.

- **Who appears:** only holdings whose next earnings call Kalshi has dated, soonest first. A
  holding without one is not shown on this screen. The date is the one Kalshi states in the
  call event's subtitle ("On Oct 29, 2026"). Its `occurrence_datetime` is used for the hour only
  when it falls on that day: for about a third of these markets it holds a later administrative
  date. Say "before the open" or "after the close" only with the call's own time; exactly
  10:00 am New York is Kalshi's default and says nothing.
- **Which markets:** only those about reported results: the earnings call, and numeric metrics
  for a reporting period ("headcount in 2026", "bookings in Q3"). Products, lawsuits, executives,
  prices, rankings and monthly third-party data stay on the other screens.
- **Lead card:** one reported metric read from its ladder of "above X" markets, ordered by
  Kalshi's strike. Say where even odds fall: the highest level whose bid is at least 50% and the
  lowest whose ask is at most 50%. Never interpolate between them. A quote that straddles 50%,
  as any quote wider than 50 cents must, says neither and shows no number. Give no reading when
  no level is clearly on a side or the sides are out of order. These are separate markets, so
  they are not scaled to add up. Kalshi lists
  no company revenue brackets, which the design assumed.
- **Bracket ladders** (mutually exclusive ranges) are still scaled so they sum to 100%, with the
  raw sum in a note.
- **Group trust** is the median trust score of the group's markets.
- **Call topics:** the chance each word is said on the call.
- **Past reports:** the stock's move across each of the last 8. Report dates are the SEC EDGAR
  filing dates of 8-K filings carrying Item 2.02; the move runs from the last close before the
  filing date to the first close after it. The typical move is the average size of those moves
  (at least four), also shown in dollars on the holding.

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
`GET /odds/:ticker?range=day|week|month|all` ·
`GET /moves?date=&range=day|week|month|quarter` · `GET /earnings` · `GET /earnings/:symbol` · `GET /track-record` · `GET /briefing`

Every response includes `asOf` (when the data was last updated).

## UI

Seven screens, matching the designs in `/design` (screenshots or exports from the canvas):

1. Add holdings
2. Exposure map (category cards in one row that scrolls sideways, then events × holdings with
   every linked holding shown in its event's row, plus a
   "By holding" view)
3. Event calendar (next two weeks by Kalshi event date, filter All / Company / Other)
4. Event page (odds distribution, odds chart over 1 day / 1 week / 1 month / all time, trust
   score breakdown, linked holdings + evidence)
5. Earnings preview
6. Move explainer (a window of 1 day / 1 week / 1 month / 3 months; the whole portfolio, a
   category or one holding; events that settled and odds that moved in the window)
7. Track record (calibration chart, table by category, how trust is scored)

Design tokens: background `#0E1116`, card `#151A21`, border `#2A313C`, text `#E8ECF1`,
secondary text `#A3ADBA`, accent `#5AA2FF`, up `#7DB6FF`, down `#FF9F45`. Fonts: Space Grotesk
(headings), IBM Plex Sans (body), IBM Plex Mono (all numbers). A chip that names a link type
opens an explanation beside it when pointed at (what it means, what it rests on, what it does
not tell you); the wording lives in `linkMeaning` in `web/app/common.tsx`. Link chips use one vocabulary
on every screen, set by the Overview: Direct = `#f87171` (red); Measured links are labelled
"Related" = `#5aa2ff` (blue); Calculated = `#34d399` (green); unmeasured links are labelled "Topic" = dashed border. Touch targets ≥ 44 px; real `<button>` and
`<a>` elements; works at phone width. Footer on every screen: "Not financial advice. Odds from
Kalshi."

## How to work

- Work one phase at a time, in the order given in the prompt.
- At the end of each phase: run tests and lint, fix failures, commit with a clear message, and
  reply with what works, what doesn't, and anything you had to guess.
- Never delete or weaken a test to make it pass.
- Never commit `.env` or any key.
- Prefer small, readable modules over clever ones; this is demoed live to judges.
