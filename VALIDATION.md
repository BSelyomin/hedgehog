# Validation and phase status

## Event history, frontend checks and storage (2026-10-10)

The event chart now reads one selected market through `/odds/:ticker`, with day, week,
month and all-time ranges. Migration 012 and the first candle backfill are present in the
running database. All 254 tests and both workspace TypeScript checks pass in Node 24;
the frontend production image builds successfully.

### Browser checks

Checked the rebuilt, running frontend in Chrome against the real API using an isolated
guest session, then cleared its holdings. Importing `examples/feature-tour.csv` saved all
17 positions (13 securities and four other asset types), totaling $425,000.

- The overview renders the imported portfolio and wrapping holding tiles.
- Earnings lists five dated calls (JPM, UAL, NFLX, TSLA and AAPL). Company search, outcome
  search and pagination work. Apple's 23 outcomes span three pages at ten per page;
  searching for iPhone reduces them to one. The page fits at 390 pixels wide.
- The Apple monopoly event (`APPLEUS-29DEC31`) returns 93 day, 101 week, 31 month and
  775 all-time readings. Its longest history starts March 27, 2024. The displayed latest
  probability matches the response (26.5% at this check) on all four ranges. Paths use
  horizontal/vertical steps, and pointer tooltips render.
- Switching outcomes on the JPM CEO event loads the newly selected market's history.
- Event details fit at 1440, 390 and 320 pixels wide, without horizontal page overflow.
  A minimum chart canvas width had shrunk axis labels and offset hover coordinates on
  the narrowest screen; it now follows the actual available width. After rebuilding and
  recreating the frontend, its 238-pixel plot uses a 238-pixel canvas at a 320-pixel viewport.
- No browser JavaScript errors occurred. Screenshots were inspected; temporary browser
  artifacts stay in ignored `.cache/ui-tests`.

### Measured storage

Read-only queries against Tiger Data at **15:10 UTC on October 10** measured allocated
table and index space, not a cloud bill. MiB means 1,048,576 bytes.

| Data | Rows | Allocated storage, including indexes |
| --- | ---: | ---: |
| Hourly and daily candles (`odds_candles`) | 820,371 | 129.77 MiB |
| Candle collection progress (`candle_progress`) | 15,818 | 2.15 MiB |
| Five-minute snapshots, including all Timescale chunks | 540,526 | 142.86 MiB |
| Whole database, including the tables above | — | 428.95 MiB |

The candle table contains **413,911 hourly readings** across 7,186 markets and **406,460
daily readings** across 7,008 markets. Daily history reaches October 24, 2023. All 7,909
currently eligible markets have collection progress for both intervals; some return no
usable quotes. The table itself occupies 60.30 MiB and its primary-key index 69.47 MiB.

This is mainly an initial history load. Hourly readings roll off after eight days. Daily
readings stay while a market remains eligible; cleanup allows a day after market close.
The latest complete daily period contributed 5,966 readings. At the current allocated
average of about 166 bytes per candle including its index, that is approximately **0.94
MiB per day** of additional daily history before cleanup, or **1.25 MiB per day** if every
one of the current 7,909 markets produced a daily candle. These are planning estimates,
not measured net disk growth: new listings, quote activity, index occupancy, vacuum and
reusable space can change the result. Deleting expired rows does not immediately shrink
PostgreSQL's allocated files. No Tiger Data dollar price is inferred from these sizes.

Sizes came from `pg_database_size`, `pg_table_size`, `pg_indexes_size`, and
`pg_total_relation_size`. Snapshot storage used `hypertable_detailed_size('odds_snapshots')`
so its chunks were included rather than just its small parent table.

## Earnings screen rebuilt to the design (2026-10-10)

All 221 tests and strict TypeScript checks pass in a Node 24 container, and the Next.js production build succeeds. Migration 011 applied; one poll filled strike values for 75,638 markets.

Checked against the running app with the 25-holding example portfolio in a temporary guest session, cleared afterwards:

- **Who is listed.** 12 of 25 holdings have an earnings call Kalshi has dated, soonest first: JPM and GS on Oct 13 through COST on Dec 10. Holdings without one, such as XOM, are not listed.
- **Call dates.** Netflix, Mastercard and United now show Kalshi's stated days (Oct 20, Oct 29, Oct 14) instead of the occurrence times they carried (Nov 4, Nov 13, March 31, 2027). JPM reads "before the market opens" and AAPL "after the close"; Tesla, Amazon and Alphabet, which carry Kalshi's default 10:00 am, show the day only.
- **Lead metric.** Apple headcount in 2026: levels at 92%, 86%, 67%, 44%, 15%, 17%, with even odds between 168,000 and 170,000. United passengers flown in 2026: between 186 million and 188 million. Netflix headcount skips the 17,500 level, whose quote straddles 50%.
- **Results only.** Apple shows two events, its earnings call and headcount; its product, lawsuit and price markets are no longer on this screen.
- **Call topics.** Apple: 17 words, led by "iPhone 18" at 92.5%.
- **Past moves.** Apple's typical move over its last eight reports is 3.1%, which is $310.82 on a $10,000 position.

Browser validation was completed in the event-history checks above. Not built, as agreed:
year-ago values from filings.

## Full database, read-only mode and odds storage (2026-10-10)

The shared Tiger Data service reached 2,965 MB and turned read-only; 2,815 MB of it was 17 hours of odds history (9.9 million rows, about 141,000 per poll). The backend then crash-looped at startup because applying migrations writes.

- **Read-only mode.** The backend now starts on a read-only database, serves stored data and reports it. Checked live: `/health` returned `readOnly: true`, pages loaded, and an attempted save returned "The database is read-only right now, so changes cannot be saved."
- **Cleanup, approved by the user.** In one transaction, the 500,993 rows for the 8,137 markets in linkable series were kept, 9,424,657 others were deleted, and migration 010 was applied. The database is 282 MB. The kept history covers its full original range.
- **Guard.** A rolled-back test insert was accepted for a linked market and rejected for an unlinked one. The first poll afterwards stored 7,906 odds rows while updating details for all 148,908 markets.
- **Dropped connections.** When Tiger Data lifted the read-only flag it closed open connections and the server exited on the unhandled pool error. Docker restarted it; a pool error listener now keeps it running.

All 191 tests and strict TypeScript checks pass. Not yet observed: the compression and retention policies acting on a chunk, which happens after a day and after eight days.

## Asset types, rate drivers and "what matters most" (2026-10-10)

All 188 tests and strict TypeScript checks pass in a Node 24 container, and the Next.js production build succeeds. Migrations 008 and 009 applied to the shared database.

Checked against the running app with a temporary guest portfolio of ten holdings (AAPL, XOM, TLT, SPY, an oil fund, a real-estate fund, cash, a Treasury note, a corporate bond and a Florida property), cleared afterwards:

- **Drivers ranked.** TLT moves 15.7% per point of the 10-year yield, close to its duration, and that yield ranks first for it (typical daily effect 0.84% against 0.09% for the stock market). Crude oil ranks ahead of the stock market for XOM (0.78% against 0.42%) and for the oil fund (2.07% against 0.15%). AAPL has only the stock market.
- **Measurement fixes.** With the negative crude close of 2020-04-20 excluded, XOM's oil coefficient is 0.266. SPY no longer carries links to oil or rates.
- **Calculated figures.** $50,000 of cash: $500 a year per point of rate. A $10,000 4% note maturing 2036: modified duration 7.85 years at the 5.22% 10-year yield, so $785.44 per point. A $200,000 adjustable mortgage: $2,000 a year per point. An invalid maturity is rejected.
- **Property.** The Florida property linked to 15 events: mortgage-rate markets (calculated) and national housing markets (no number). It did not link to Canadian or other states' housing markets.
- **Moves.** Opens on the latest completed session. Totals reconcile (176.66 = 209.83 − 33.17), state the $470,000 with no daily price, and name the two yields FRED had not yet published. On 2026-10-07 crude oil (−$121.26) outweighed the stock market (−$84.01).
- **Speed.** The snapshot lookup was running for every market in the table. Filtering first cut the exposure request from about 31 seconds to 3, and Moves from timing out to under 5.

Not verified: the screens in a browser. Driver estimates on Moves overlap and are compared, not summed; the page says so.

## Earnings filters, link accuracy, event dates and report dates (2026-10-10)

All 156 tests and strict TypeScript checks pass in a Node 24 container, and the Next.js production build succeeds. Migrations 004 to 007 applied to the shared database on restart.

Checked against the running app with the 25-holding example portfolio in a temporary guest session:

- Withdrawing 103 incorrect mappings reduced linked events from 622 to 425. DAL, BAC and XOM each keep one company event (previously 23, 5 and 25).
- Apple's 17 earnings-call outcomes are classified as call mentions (none were before). Two S&P 500 range ladders now qualify for scaling; the first has 27 outcomes with a raw midpoint sum of 101.5%.
- 421 of 425 linked events carry a Kalshi event date. The 14-day calendar holds 73 events by event date against 70 by market close.
- With `SEC_USER_AGENT` unset, the earnings response returns no history and says why. With it set, the earnings-dates job loaded report dates from live EDGAR for 23 of the 25 holdings (SPY and TLT file none). Apple's and JPMorgan's last eight match their results days, and each move reconciles with the stored closes. XOM has one report because its ticker now maps to a new registrant (see SOURCES.md).

Not verified: the screens in a browser. `git fetch` could not authenticate from the agent's shell, so the merge used the local copy of origin/main at a5b17b3.

Known issues found in review and not changed here: the Moves market split is unavailable for completed sessions, one extreme crude-oil return in April 2020 distorts oil coefficients, and each poll stores about 140,000 odds rows with no retention policy.

## Subject evidence and event context (2026-10-09)

All 122 tests, strict TypeScript checks and the production build pass. Migration 004 applied locally and identity recovery verified all 127 stored observations: 126 inflation contracts across 49 event identifiers and one interest-rate contract in one event. Company and stock-market subject views correctly report no verified history. Stored probabilities and outcomes are not changed by identity recovery.

Added subject-level comparisons using reviewed series tags, while preserving category-level trust calculations. A known-answer test verifies inflation and Fed observations stay in their matching views and two contracts in one event count as one identified event. Identity recovery is tested to update only metadata and ignore unrequested markets. The UI keeps the existing chart and calculation details, adds subject selection and a focused portfolio event with explicit stored link evidence.


## Plain-language track-record view (2026-10-09)

The default view leads with evidence size and average probability/outcome gap, an around-70% comparison with a small-sample warning, four actual outcomes, and relevant current portfolio events. Chart, Brier score, bucket counts and full observation timestamps are collapsed under details. Category filter wording and an all-categories-relevant message explain identical filtered views. The rendering check verifies the comparison, outcome labels and closed detail sections. No forecasting math or source observations changed.


## Track-record evidence feature (2026-10-09)

The page now explains forecasting history separately from portfolio returns, exposes category sample sizes and date ranges, renders calibration-group counts and recent settled observations, and filters categories using session-scoped reviewed portfolio tags. Added known-answer aggregation and rendering tests cover absent history, portfolio relevance, a two-market Brier score of 0.29, the 30-market eligibility threshold, twelve-example limits and evidence timestamps. The expanded CSV reuses the repository’s 25-symbol demo allocation.

Live database initially contains no settled observations. A backfill of the three approved company series returned no usable exact 24-hour quotes for the settled ExxonMobil sample. No synthetic history was inserted.


## Base merge for morning briefing (2026-10-09)

Merged origin/main at dee8f81 into feature/morning-briefing. Briefing routes now live in createApp alongside account middleware; authenticated and guest portfolio ownership and write protections are preserved. Session cleanup remains scheduled alongside independent morning briefing retries. All 116 tests, TypeScript checks and the production build pass, including briefing-specific account isolation and cross-site/stale-session write rejection.


## Focused briefing and refresh (2026-10-09)

The spoken script prioritizes the completed-session takeaway and one event. A session-scoped refresh endpoint and overview button regenerate the current day while retaining cached audio after failures. Audio browser caching is disabled. All 80 tests, TypeScript checks and the production build pass, including explicit refresh before the scheduled time and bypassing the daily cache.


## Conversational briefing update (2026-10-09)

The script now uses an opening takeaway, explanatory transitions, holding-specific watchlist context, spoken dates/times and directional dollar amounts. Existing tests verify the completed-session amounts, omission of stale quotes, missing data and numeric validation with the new wording. All 79 tests, TypeScript checks and the production build pass.

## Morning briefing feature (2026-10-09)

The morning briefing uses the latest stored SPY session before today's New York date, explicitly dates the move, selects this week's top linked events with a nearest-upcoming fallback, and omits stale single-outcome odds. Generation begins at 8 a.m. New York with independent hourly retries and startup catch-up. Per-session/day advisory locks prevent overlapping voice requests. Existing daily audio remains cached. Text and audio endpoints share the New York date.

Validation: 79 Vitest tests pass, including six content/timezone tests and four job tests for prior-session selection, the morning cutoff, cached audio, concurrent generation and retry after a voice failure. Strict TypeScript checks and the Next.js production build pass in an isolated Node 24 container using the project's installed dependencies. No new dependencies or migrations are required.

Snowflake tagging, expanded company/sector coverage, continuous hosting and historical earnings-report moves are outside this feature. Current briefings honestly report unavailable prices or market associations; this change does not certify those separate integrations.


## Current migration: Snowflake Cortex (2026-10-09)

Gemini has been replaced with Snowflake Cortex REST completions for series tagging and supplied
filing risk factors. Optional Cortex Search supplies source passages for summaries. No Snowflake
account credentials have been supplied, so live AI authentication, model availability and index
queries remain unverified. Tiger Data/PostgreSQL remains the application database.

The 45-test Vitest suite passes, including provider request/response contracts, configuration,
sanitized failures, malformed output, fixed tags, batch isolation, filing caching, retrieved
citations and the existing numeric guard. Tests use mocked Snowflake responses, not live calls.
The rebuilt images pass backend/frontend TypeScript checks, the core accuracy checks and the
Next.js production build. Migration `002_snowflake_tags.sql` applied successfully; a rolled-back
temporary-table check verified that legacy Gemini/manual tags retain their review flags and new
Snowflake tags are accepted. The rebuilt frontend and proxied database health endpoint return HTTP
200. The private `.env` stays ignored by Git. Docker now installs the committed lockfile with `npm ci`.

Yahoo history loading worked locally before this change. Kalshi connections reset from both Windows
and Docker. `npm ci` reports five dependency vulnerabilities in the current lockfile; this migration
does not upgrade unrelated dependencies or certify production security.

The original phase log below describes the earlier offline build environment. Its npm, Docker
and Git blockers are historical, not the current local setup. References to Gemini describe
the superseded provider; `DEPLOY.md` contains current credentials and integration instructions.

## Original phase log

Checked before creating app files: AGENTS.md, message.txt, hedgehog_math.py, the eleven-page Hack Knight build-plan PDF, and all seven design PNGs. Read the full text and inspected every design. Original inputs are preserved.

## Checks that passed

- `npm run check:core`: executable assertions cover valid/invalid dollar midpoints, missing quotes, reliable and unreliable ranges, Brier 0.25, calibration buckets including p=1 and weighted misses, trust edge cases and rescaling, missing-data trust, source URL filtering, AI numeric validation, fixed tag filtering, link downgrading, date alignment and cent-based move reconciliation.
- Strict TypeScript check of the frontend and shared types with a recovered cached TypeScript 5.9.3 compiler and cached React/Node type packages. This was a manual compiler invocation, not a successful npm installation or Next build.
- Server rendering smoke checks with recovered cached React/ReactDOM: all seven screen components render their initial states, display a heading, include no fabricated market data, and the shell includes the required footer. This is not browser interaction, responsive screenshot validation or a test of populated live screens.
- TypeScript syntax transpilation of app source files completed without syntax diagnostics. The final backend compiler attempt reports only missing SDK/math/scheduler dependencies; their APIs cannot be fully type-checked until installed.

Temporary recovered tools stayed in /tmp; they are not vendored into this repository.

## Checks blocked

- `npm install`: EAI_AGAIN for registry.npmjs.org in this shell. Retried with a writable cache and zero fetch retries; no dependency lockfile could be generated.
- `npm test`: Vitest unavailable. Known-answer synthetic regression tests are written but not executed. They must pass before using measured links in a live demo.
- `npm run lint` and `npm run build`: workspace TypeScript binaries unavailable through npm; Next and backend SDKs are not installed. The manual frontend check does not certify either build.
- Docker CLI: Docker Desktop WSL integration is unavailable. Compose images, migrations and service health checks have not run here.
- Live data: no configured DATABASE_URL or private API credentials. No honest three-market sample, ten-year-history count, reliable/unreliable live link, grounded Gemini summary or ElevenLabs playback can be demonstrated yet.
- Git: the supplied .git is not a functioning repository and is protected by the environment. No phase commits were created.

## Phase inventory

| Phase | Code prepared | Finish line still to verify |
| --- | --- | --- |
| 1 Foundation | Workspaces, migrations, Timescale hypertables, idempotent price upserts, five-minute/startup poller, scheduler | Installed dependencies, migrated database, populated ten-year series, three stored quote samples |
| 2 Matching | Response types, restricted Gemini tags, review/approve commands, human sector seed, holdings/session API, exposure and both views | Human sector table and tag review; five live tickers linked correctly |
| 3 Events/trust | Trust formula/edge tests, calendar, event distribution/history, grounded summaries with guards | SDK compatibility and live source-linked summaries/trust |
| 4 History/math | Math port, required Vitest tests, resumable settled backfill, category statistics, nightly reliable regressions | Regression tests first, then real category sample and hand-checkable live links |
| 5 Moves/earnings | Cent-reconciled move split, source-backed daily odds moves, normalized exclusive brackets, views | Real close history; free past report-date source remains unresolved |
| 6 Voice/portability | Exact template, numeric guard, official SDK MP3 cache, player, Docker/Compose, deploy guide | Voice credentials/audio validation and Docker execution; public deployment not performed |
| 7 Accuracy | Fail-closed empty states, no UI fixture data, NUMBERS.md and core guards | Full live data and browser audit |
| 8 Submission | README and cautious submission draft | Human editing, eligibility/track decisions, demo recording and publication |

Implementation proceeded sequentially through the planned code areas, but infrastructure-blocked finish lines were not treated as passed. Questions and assumptions are in questions.txt. Sector mappings are intentionally empty because the supplied instructions assign that judgment to a person. Automatic filing acquisition and optional AI briefing smoothing are not implemented. The two-panel design layout and tokens are used throughout; unavailable report histories and reminder functionality are not represented as working features.
