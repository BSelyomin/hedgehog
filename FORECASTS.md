# Forecasts

Open **Forecasts** in the navigation, or `http://localhost:3000/#forecasts`.
Rebuild an existing Docker deployment with `docker compose up -d --build backend frontend`.
No new dependency or migration is required. The combined AI assessment uses the existing
Snowflake account URL, PAT and Cortex model settings. Sourced forecasts work without them.

## Joint event-family forecasts

S&P price/range/threshold/up-down events share one row across resolution times and targets,
including additional price formats recognized from their titles. Title recognition groups
context only; it never grants a verified numeric strike or stock sensitivity. Other repeated
formats are grouped by series and subject/metric, ignoring varying numeric targets, dates and
times. Companies, metrics and Treasury tenors remain distinct; shared topic tags alone never
merge unrelated events.

Snowflake receives the **complete compact contract set**, with each close, bid–ask midpoint,
spread and stored strike, plus measured holdings and reference prices. Up to eight representative
contracts across times/formats receive generated individual assumptions for unsupported families;
supported families retain up to 48 representative scenarios. A joint assessment also
requests one remaining one-session driver change around the nearest quoted close, using all
contracts as context. It must identify at least two distinct quoted evidence contracts and use
a measured driver for holdings whose reviewed links are shared by the whole group.

The main table shows the **combined forecast**, its dollar effect and self-rated confidence.
Expand **View results** to see the combined stock directions/value and every original dated
contract. An example contract's odds remain separate: there is no invented family probability,
sum of scenario effects or average of overlapping odds. Repeated correlated contracts must not
raise confidence automatically; conflicting quotes and different horizons increase uncertainty.
This provides more context, not demonstrated predictive accuracy or calibrated confidence.

Joint forecasts run automatically even when every individual contract already has a verified
scenario. Verified scenarios and manual overrides remain available. Both joint and individual
AI assumptions reuse the private cache on quote/price changes. Holdings, measured models,
reviewed scope, contract membership/terms/times, model settings and prompt changes invalidate
it. The original quote snapshot and generation time are retained, so a cached joint estimate
does not claim to incorporate subsequent odds changes.

## Snowflake best-effort predictions

The user has authorized Snowflake to estimate driver changes and self-rated confidence when
an event lacks a verified outcome-to-driver mapping. Open Forecasts: unsupported measured
results show **Snowflake estimating…**, then automatically show a portfolio dollar change,
**AI assumption**, the proposed driver shock and **AI confidence: N%**. No manual entry is
required. Expand **View results** for the dated result table, stock directions, portfolio value,
source links and assumption details. Verified S&P and Treasury-level scenarios retain their
measured method; Snowflake does not overwrite them.

The prompt tells Snowflake to do its best, choose a relevant available measured driver, and
propose the remaining one-session change if that contract resolves yes. It receives event
meaning, separate contract odds, reviewed holdings, reliable stock sensitivities, units,
published references, and typical driver moves derived from measured historical volatility.
The confidence score is an integer from 0 to 100: **the model's own uncalibrated self-rating**,
not Kalshi's event odds, a historical accuracy score or a calibrated prediction probability.
Only the structured driver-change assumption and confidence are newly generated numbers.
The backend computes stock and portfolio effects from stored reliable coefficients; prose
retains source and number checks, with those validated assumption fields explicitly allowed.

AI assumptions start automatically via one batch polling request, with at most two provider
calls in progress, matching the dedicated AI database pool. The table and verified figures stay responsive while jobs finish. Completed
assumptions are private PostgreSQL cache entries. **Reload AI estimates** reads that cache;
live Kalshi odds and prices do not regenerate assumptions. Changes to holdings, any usable
measured model, reviewed contract membership, model settings or the prompt invalidate the
identity. The exact original input and output are retained; stock dollar effects are computed
from current holding values and coefficients when serving cached assumptions. Cache entries
from the older selection-only prompt are not reused after this update. All contracts are sent
as compact joint context, preserving each close time and individual odds.

Unknown drivers/markets/source IDs, repeated market IDs,
non-finite/out-of-range shocks, invalid linear values and non-integer/out-of-range confidence
scores are rejected before caching. Missing or invalid sibling estimates do not discard independently
validated estimates; partial results are labeled. No reliable stock measurement still means no dollar
figure. Configuration, provider and validation failures are shown explicitly. No dependency,
credential or migration is added. Existing Snowflake account URL, PAT and model settings
remain server-side.

Manual scenarios remain available: expand a result and use **Calculate this result with your
assumption**, or expand **Additional forecast tools**. Entering `2` for SPY means your own
assumption of a 2% SPY return; entering `-0.25` for DGS2 means a 25-basis-point Treasury yield
fall. Manual overrides show **Your assumption** and clear on reload; the cached AI assumption
remains available. Missing or unreliable measurements can only improve after loading price
history and rerunning measurements:

```sh
docker compose exec backend npm run job -- prices
docker compose exec backend npm run job -- measure
```

For a local checkout use `npm run job -- prices` then `npm run job -- measure`. Treasury
references require a configured `FRED_API_KEY`. Reload reads the database rather than
fetching provider prices. A historically validated conditional model is still needed to turn
AI assumptions and self-ratings into calibrated event-impact forecasts.

## What to test

1. Add manual/CSV holdings or select imported brokerage holdings. Open Forecasts. The vertical table
   ranks the top 20 open, reviewed, portfolio-linked groups by **gross measured daily dollar
   sensitivity**. Similar verified markets are grouped before selecting 20. This compares
   measured exposure, not a prediction of the event's actual impact. Reach is shown separately.
2. Look for one S&P row containing range, threshold and up/down results across all dates and times,
   plus stored S&P index and SPY prices. Select **View results** to expand it inline. Each result
   appears in a dated vertical table with its own close time, odds, portfolio change and stock
   directions; select **View stock effects** for its measured breakdown. Each result
   keeps its own bid–ask midpoint; overlapping probabilities are not added or averaged.
   Select an event and a specific result. Verified daily Treasury-yield contracts show the
   target yield, published FRED reference, stocks estimated to rise/fall, dollar contributions
   and individual result values. The full portfolio scenario adds modeled changes to its current
   total; excluded holdings stay at their current values, with that assumption stated beside it.
   Other measured results receive clearly labeled Snowflake driver assumptions and self-rated confidence; unmeasured stocks still get no invented coefficient.
   S&P results use a clearly labeled SPY-beta proxy scenario, requiring a stored `^GSPC` level.
   The existing price job loads that index after restart; if necessary run `npm run job -- prices`.
3. Change a holding's dollar value and reload. Its sensitivities and result contributions should
   scale with its new value. Switch results to check the modeled direction and value change.
4. Expand **Additional forecast tools** for the next-session baseline, manual single-driver
   scenarios and manual yes/no forecasts. These tools load only when expanded.
   Choose SPY or crude oil and enter a percent change. Choose a Treasury yield and enter a
   **percentage-point** change: `-0.25` means a fall of 25 basis points. Calculate scenario.
   Check per-holding contributions, covered value, sensitivity bounds and excluded holdings.
5. In the additional tools, choose a linked open event outcome. Enter your assumed remaining driver changes if yes and
   if no. Calculate event forecast. The result shows both covered values and their weighted
   average using the current bid–ask midpoint. Topic/company linkage alone does not supply an
   outcome-to-stock-price estimate.
6. Reload the additional tools and calculate again after changing holdings. Reload clears prior
   manual results; editing an input also clears its result.
7. Check missing/noisy measurements, missing price histories and quotes older than 30 minutes.
   Unmeasured stocks remain without numbers. With Snowflake configured, a driver-shock assumption can replace a missing outcome mapping or reference; missing/stale odds never become invented probabilities.
8. With Snowflake configured, leave rows collapsed and wait for best-effort estimates to appear.
   Check **AI confidence** separately from Kalshi odds. Expand a row to compare dated assumed
   results and stock effects. Reload AI estimates should reuse the generation timestamp.
   Changing only market odds updates their midpoint without another completion; changing a
   holding's value regenerates the assumption and scales its computed effect. Check missing
   configuration and provider failures for explicit messages without a page-wide loading hang.

## Consolidation and Snowflake

`forecast-groups.ts` combines verified level series by underlying across all resolution/close
times. S&P `KXINX`, `KXINXU` and `KXINXDUD` become one group that occupies a single ranked row;
2-year and 10-year yield series each get their own group. General topic tags do not merge
unrelated events. Other repeated series/subject/metric formats are grouped across targets and
times; their contract terms and probabilities remain separate. A sourced joint AI assessment
can use the full group without inventing an automatic level mapping for additional formats.
Holdings and measured daily exposure are counted once. The group retains original event IDs,
all individual market close times, odds, source links and stored reference prices. Its earliest
and latest closes define the displayed time range. Results are ordered by close, and the
representative result prefers the nearest supported quoted contract. No probability or stock
change is aggregated across time. Multiple rows can be expanded together; there is no event
tab/sidebar layout. Unsupported measured rows start AI assessment even while collapsed through the shared batch endpoint; stock-detail requests remain lazy.

The [S&P range rules](https://kalshi.com/markets/kxinx/sp-500-range/kxinx-26sep29h1600),
[threshold rules](https://kalshi.com/markets/kx/m/kxinxu-26sep24h1600) and
[up/down rules](https://kalshi.com/markets/kxinxdud/inxdud/kxinxdud-26oct12h1600) identify the index
level. Convert target index points to a return using stored Yahoo `^GSPC`: `target / reference − 1`.
Apply reliable measured SPY beta to that return as an **explicit proxy**, allowing for unknown
tracking differences, dividends and fees. Never divide an index strike by the SPY ETF price.
Missing/stale index data suppresses the result value. Above/below probabilities refer to the
whole contract, while its price scenario remains a boundary estimate.

`forecast-assessment.ts` sends grouped outcomes, computed scenario changes, measurements and
source IDs to the existing [Cortex structured-output API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api).
The prompt selects and explains a representative result and, when no verified result mapping
exists, makes best-effort driver-change assumptions with self-rated confidence. It cannot
invent coefficients, portfolio dollar changes or event probabilities. Code validates allowed
drivers and contract scope, shock units/ranges and confidence before computing stock effects.
Sources and prose numbers are still checked. A bounded outcome's midpoint is representative,
not an expected price or conditional mean. Fine-tuning can later replace this producer while
retaining the validated contract; calibration needs realized outcome data.

The replacement model's output contract is:

```json
{
  "selectedMarketTicker": "a ticker supplied in the input",
  "text": "A cautious explanation of the supplied scenario or tentative assumption.",
  "sourceIds": ["event-0"],
  "assumptions": [
    { "marketTicker": "an unsupported ticker supplied in the input", "driver": "SPY", "change": 2, "confidence": 55 }
  ],
  "jointForecasts": [
    { "horizonMarketTicker": "nearest quoted ticker supplied in jointContext", "driver": "SPY", "change": 1, "confidence": 48,
      "evidenceMarketTickers": ["supplied horizon ticker", "another supplied quoted ticker"] }
  ]
}
```

Use an empty `jointForecasts` array when no shared measured scope or multiple quotes support
a joint estimate. `FORECAST_INSTRUCTIONS` combines the individual and joint prompts.
`FORECAST_PROMPT`, `FORECAST_SCHEMA` and `checkedAssessment` are exported from the assessment
module. Stock effects and contract probabilities remain outside the model's output contract.

Assessment requests return pending immediately and poll completed database cache entries.
Backend terminal diagnostics show `[Cortex] request_started`, `response_received` (HTTP
status and duration), and `response_metadata` (finish reason and token counts when supplied).
The request ID connects those transport messages. `[Forecast AI] response_validated` shows
accepted structured driver changes/confidence, the returned assumption count, and specific
`rejectionReasons` when validation fails (for example `missing_or_unknown_source_ids`,
`unsupported_summary_number`, `assumption_driver_not_allowed` or `joint_horizon_mismatch`).
These reasons also appear in the unavailable row. `[Forecast AI] assessment_failed` gives a
sanitized failure reason, and `[Forecast AI] cache_hit` confirms reuse without a provider call.
Raw response prose, portfolio symbols/values, session identifiers and credentials are omitted.
For Docker, rebuild the backend then watch `docker compose logs -f backend` while opening
Forecasts. Reloading an unchanged cached assessment produces cache-hit logs, not a new request.
Unsupported families generate at most eight representative individual assumptions per
completion to reduce output truncation; supported families retain up to 48 representative
scenarios. Every stored contract remains in the compact joint context. Each individual and
joint estimate is validated independently: invalid estimates never supply numbers, while
valid siblings can be cached with a partial-result note. Prose still requires valid sources
and number checks against the input and only accepted assumptions. A prose-only failure
(including `unsupported_summary_number`) hides the explanation, rather than discarding
otherwise validated driver estimates. The response remains ready with `summary: null`
and `explanationStatus: "hidden"`; measured effects, model confidence and supplied market
sources remain visible. Invalid quantitative assumptions still produce no numbers.
Provider failures expose sanitized HTTP, timeout, completion/schema or content-check reasons.
Failed assessments are stopped, with a safe failure status persisted in the existing
PostgreSQL `ai_cache` under `forecast-failure-v1`. There is no automatic retry or cooldown
expiration, including for transport and rate-limit failures. Reload, time passing, market
quotes and new contract ingestion cannot restart the failed family. Holdings, measured
coefficients, model/account settings or prompt changes permit a new assessment. The original
failure reason remains visible; rejected AI prose is never shown or stored as a valid result.
Previously stopped rows have an explicit **Retry estimate** button. Its CSRF-protected
`POST /forecasts/assessment/:ticker` clears only the current portfolio's failure marker
and permits one new attempt. It cannot reset another portfolio; successful cached estimates
are reused. Normal reloads never clear failure markers.
The page polls only pending work and stops on polling errors. The existing 12-minute limit
bounds checks for jobs that remain pending.
Completed forecast GET responses are cached in browser memory for one minute, with concurrent
requests sharing one fetch. Pending jobs are not cached; failed HTTP requests are not cached.
The event-family table shows ten groups per page with Previous/Next controls and a page
selector. Ranks continue across pages; an expanded family keeps all of its contracts together.
Pagination uses the loaded response and does not start new API or AI requests. After a
refresh reduces the group count, the selected page is kept within the available range.
Portfolio forecast cells use a collapsed dropdown: the amount or unavailable status and
its AI/measured classification stay visible; open Forecast details for confidence, calculation
evidence, sources and manual retry actions. Opening the dropdown does not send a request.
Each main column heading has an explanation on hover, keyboard focus or tap. Escape and
outside taps dismiss it; explanations float outside the scroll container to avoid clipping.
Reload bypasses this browser cache but still reads the backend's saved assessments/stopped
statuses. Account changes and successful mutations clear the browser cache, and late replies
from older portfolio revisions cannot repopulate it. Live odds may update on a later read;
they do not regenerate cached AI assumptions.
The main table uses "Selected result odds" and "Measured effect at the stated market level"
instead of example-scenario wording. Numeric effects expose the measured driver, entered or
estimated driver change, minimum aligned observation count, measurement date and reference
source, plus links to the market and per-stock measurements. AI driver changes remain labeled
assumptions with uncalibrated confidence; historical coefficients do not prove a future reaction.
Provider failures do not block source-backed forecasts. AI cache identity includes the private
session, holdings, relevant measured coefficients and contract membership, excluding live
odds/prices and ingestion timestamps. Original AI input/output snapshots are stored in the
existing PostgreSQL `ai_cache` for provenance. Quote or price refresh updates numeric UI data
without rewriting cached prose; its original generation time is visible. No fine-tuning job
or training dataset exporter is included.

## Ranked event results

Ranking uses the sum of `holding value × measured_links.effect` over reviewed linked securities
for the strongest relevant daily driver. `effect` is the measured `|b| × driver standard
deviation`; opposite stock directions do not cancel in this ranking. Verified result drivers
take precedence over general topic tags. Missing effect values produce no ranking number.
Events without reliable measurements remain visible after measured events, ordered by reach.

Exact-driver automatic scenarios use `KXUST2AD` → `DGS2` and `KXUST10AD` → `DGS10`, configured in
`server/src/config/drivers.ts`. The [2-year contract rules](https://kalshi.com/markets/kxust2ad/ust-2-year-daily/kxust2ad-26sep30)
and [10-year contract rules](https://kalshi.com/markets/kxust10ad/ust-10-year-daily/kxust10ad-26oct06)
identify the US Treasury par-yield series. References are published [DGS2](https://fred.stlouisfed.org/series/DGS2)
and [DGS10](https://fred.stlouisfed.org/series/DGS10) observations, at most seven calendar days old.

Read numeric `floor_strike`, `cap_strike`, and `strike_type` from stored poller metadata, never
the market title. Above/below results use their boundary; bounded ranges use a clearly labeled
representative midpoint. Neither is an estimate of the whole binary outcome's conditional
average. Actual Kalshi yes probability is shown separately and is not used to weight this
specific-level result. The driver change is target yield minus published reference yield.
Only reliably measured stocks with a reviewed link to the selected event get a contribution.

This is a static sensitivity scenario, not cumulative growth through the event date or a
causal forecast. Non-SPY scenarios hold SPY and other modeled contributions at zero. Fed policy
decisions, earnings and other futures cannot be substituted for the measured driver level.
Snowflake can instead hypothesize a remaining driver change for those events, clearly labeled as an AI assumption. Manual tools remain available.

The main page reads at most two completed price rows per symbol, existing coefficients and
all candidate metadata; it fetches latest odds only for the selected top events. No long price
history or external provider request is needed for the ranked data or stock-scenario endpoints.
The separate assessment endpoint starts optional Snowflake inference in the background.

## Value forecast method

Read at most 321 completed daily price endpoints per symbol, through the existing New York
close cutoff. Align adjacent stored SPY sessions; missing endpoints are skipped rather than
turning a multiple-session return into a one-day return. Current holding dollar weights make a
hypothetical portfolio return series, not the user's historical account performance.

A forecast needs at least 120 common daily returns. Compare a rolling 60-observation mean with
zero return over an earlier 40-observation selection window. Select the smaller squared error.
Then audit that fixed choice on the final 20–60 observations, forecasting each using only prior
returns. Report both the selected model's RMSE and the no-change benchmark. Report an audit
failure even if the earlier selection favored the mean; the audit does not choose the model.

The next value is current covered value × (1 + forecast return). The estimated 80% range adds
the empirical 10th/90th percentiles of the audit errors to the forecast return. This assumes
those errors remain representative; future interval coverage is unverified. Dividends,
deposits and trades are excluded. Source dates and partial coverage stay visible.

## Scenario and event methods

Sensitivity coefficients come only from reliable `measured_links`: at least 60 observations,
95% coefficient bounds excluding zero, and a source date no later than the price session.
Only daily drivers are offered. Weekly mortgage measurements are not mixed with daily models.

Each scenario uses one driver: holding value × coefficient × entered change. Percent-return
inputs are divided by 100; yield-point inputs are not. Non-SPY scenarios hold SPY at zero.
Separate driver regressions overlap, so their contributions must not be added. The portfolio
value and contribution are sums in cents over supported holdings. Coefficient bounds form an
envelope, **not** a joint confidence interval or a future-return prediction interval. Shocks
outside the recent observed driver range are identified as extrapolation. Negative linear
values are excluded rather than clamped to a made-up value.

For one binary market, expected covered value = p × yes value + (1 − p) × no value. The two
outcomes must cover the same holdings. p is recalculated from stored bid and ask; stale,
missing, future-dated or crossed quotes cannot produce an expected value. Only reviewed
series linked to the current user's security holdings are readable. A list contains up to
200 markets, ordered by market close.

Outcome driver changes are explicitly user assumptions about the remaining change from
current prices, including expectations already priced in. A Fed policy-rate outcome does not
automatically imply an identical Treasury-yield move. The horizon is one session around the
event, not accumulated growth until its market closes. Individual event scenarios overlap.

## Backend

- `GET /forecasts`: historical value forecast, driver models and coverage.
- `GET /forecasts/ranked-events`: ranked linked events with compact result previews.
- `GET /forecasts/result/:ticker`: selected linked result, stock directions and portfolio scenario.
- `POST /forecasts/result/:ticker`: `{ "driver": "SPY", "change": 2 }`, an explicit assumption calculated only for reviewed event-linked stocks; same account scope and CSRF protection as other POSTs.
- `GET /forecasts/assessment/:eventTicker`: cached combined assessment with validated assumptions and current computed stock predictions.
- `GET /forecasts/assessments`: automatic batch assessments for joint family forecasts and unsupported displayed results, sharing model reads and bounded background inference.
- `GET /forecasts/events`: portfolio-linked open market outcomes and quote provenance.
- `POST /forecasts/scenario`: `{ "driver": "SPY", "change": 2 }`.
- `POST /forecasts/event`: `{ "marketTicker": "…", "driver": "SPY", "yesChange": 2, "noChange": -2 }`.

All responses carry `asOf`, use the existing account/guest scope and are private `no-store`
responses. POSTs require the existing same-origin/session headers. Only the separate assessment
route starts AI inference; no forecast route calls Kalshi, Yahoo, FRED or a brokerage provider.
