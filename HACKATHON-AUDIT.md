# Hackathon audit and sponsor priorities

Audited October 10, 2026, approximately 9:45–10:00 p.m. New York. Initial checkout: `d34d6de`.
This is a bounded code, test, database and browser audit, not a guarantee of zero defects.
Concurrent edits arrived during the audit; the running containers were not rebuilt by this audit.
The observations below distinguish the running app from those unfinished working-tree changes.
Sponsor priorities are an assessment against the track descriptions supplied by the team, not
an estimate of winning odds or a claim about an unpublished judging rubric.

## Checks and observed results

- Standard test run: **619 passed, 1 timed out**, out of 620. The password-hashing test hit its
  five-second limit under parallel load. Its account-test file passed in a one-worker run.
- Both workspace TypeScript checks passed before the concurrent changes arrived.
- The standard Vitest include patterns omit `web/app/forecasts-cache.test.ts`. Its four tests
  passed when explicitly included. The isolated account and cache run passed 28 tests.
- Two temporary audit probes reproduced the release-filter discrepancy and the limits of the
  numerical token guard. They establish current behavior, not a correction.
- An isolated guest imported `examples/feature-tour.csv`: 17 holdings, $425,000. Nine API reads
  returned HTTP 200. The Moves components reconciled to the cent. Browser navigation produced
  no uncaught page errors and the Overview had no sideways page overflow at 390 pixels.
- The temporary guest portfolio was cleared. Existing users' portfolios were not edited.
- No paid AI/voice generation or brokerage linking was explicitly triggered by the audit.

Single-request timings on this machine (not a p95 benchmark):

| Request | Time |
| --- | ---: |
| Exposure | 4.86 s |
| Calendar, 14 days | 3.95 s |
| Moves | 1.95 s |
| Earnings list | 3.84 s |
| Track-record ratings, 24 hours | 1.29 s |
| Ranked forecast families | 1.11 s |
| One event detail | 3.97 s |

The database had TimescaleDB 2.30.2 and Toolkit 1.26.0, **zero continuous aggregates**,
19,658 scored markets across 1,913 event IDs, zero `forecast_observations`, and 55 stored
summaries. The latest snapshot advanced from 01:51 to 01:56 UTC during inspection.
Required AI, voice, FRED and SEC configuration names were present; presence does not prove
every provider call succeeds. Their values were not printed.

## Findings to resolve before judging

### 1. Calibration and ratings apply different release-time exclusions — high priority

[`track-record.ts`](server/src/services/track-record.ts) joins official release timestamps but
does not remove rows whose quote was published after the known result before calculating
Brier, calibration, or the category component of trust. The newer
[`track-ratings.ts`](server/src/services/track-ratings.ts) excludes such rows.

A mocked already-released result with a 99% quote still counted in calibration and produced a
Brier score of 0.0001. This is a reproduced code defect. The live database's 112 records with
verified release timestamps had **zero** such violations at audit time, so no current affected
row was demonstrated. Release metadata covers only a small part of the 19,658 records; the
absence of a timestamp is not evidence that a quote preceded the announcement.

Use one eligibility function for both paths, distinguish known pre-release from unknown timing,
and add a regression test covering a release added after its historical quote was ingested.

### 2. Overview reach disagrees with visible holdings — reproduced; fix in progress elsewhere

The running API returned 366 events, while the Overview's visible-link rule retained 356.
For `KXSHELTERCPI-26OCT14`, reach was 89.41% but visible holdings represented 12.94%.
An unmeasured property topic contributed the difference. 311 events had some difference
between all-link reach and visible-link reach.

Concurrent changes add `reach()` and separate topic value from supported links. Review and
deploy those changes, then repeat the same portfolio check across Overview, Calendar, event
details and category summaries. Define clearly whether filters change reach or only visibility.

### 3. Briefing refresh is not daily in the running version — fix in progress elsewhere

The original [`briefing.ts`](server/src/jobs/briefing.ts) cache identity omitted the day and
returned immediately for unchanged holdings. Reload reused that snapshot indefinitely.
The existing UI did disclose that it was saved; it was a product gap relative to a daily briefing.

Concurrent edits add day-aware replacement and timestamped speech. Verify a New York date
transition, failed generation, changed holdings, audio/transcript alignment and account isolation
before claiming daily refresh. Avoid generating daily paid audio for abandoned guest sessions.

### 4. Historical comparison/calibration views lost their navigation — fix in progress elsewhere

The running Event link to `#track-record/holdings` opened the Asset holdings ratings tab.
The older calibration and historical-event components still existed but were not routed.
Concurrent edits restore the two routes; confirm them after rebuilding. This is a forgotten
feature after a merge, not evidence that the underlying data or component was deleted.

### 5. Three history timeframes are empty — collection work in progress elsewhere

The 1-hour, 7-day and 30-day views have no observations in the inspected database. The previous
collector required a quote within a minute of the target, unlike the 24-hour standing-quote rule.
Concurrent changes introduce `backfillTimeframes` with the standing-quote approach. It still
needs a bounded, successful live run and coverage checks; code existing does not populate data.
Document the selection effect if only markets already scoreable at 24 hours are collected.

### 6. Test discovery omits the browser cache regression tests — still outstanding

[`vitest.config.ts`](vitest.config.ts) includes web `*.test.tsx` but not `*.test.ts`.
Include both extensions so the four cache/privacy/in-flight invalidation tests run by default.
Keep the password checks and their cryptographic strength; address runner resource contention
or give this deliberately expensive test a justified time budget.

### 7. The numeric guard validates tokens, not factual meaning — important limitation

[`ai-guard.ts`](server/src/services/ai-guard.ts) accepts a generated number if the same token
occurs anywhere in the input. For example, input `{ holdingValueUsd: 85 }` permits the sentence
"An 85% chance of rising." The probe reproduced this. Source-ID validation likewise establishes
that a cited source exists, not that it entails every sentence.

For strong accuracy claims, have AI return fact IDs and qualitative text, then render numerical
sentences from typed, unit-bearing facts in code. Evaluate grounding separately. Do not describe
the current check as proof that an explanation is financially or semantically correct.

### 8. Page latency and compression savings need demonstrated improvement

Exposure computes the entire portfolio map and calibration data; Calendar, event details and
Earnings reuse that work. The observed roughly four-second waits are noticeable in a short demo.
Inspect query plans and time individual stages before choosing indexes, latest-quote tables or
rollups. Cache shared public calculations separately from authenticated portfolio data.

At 01:56 UTC the database occupied 674,969,279 bytes (about 644 MiB). Snapshots occupied
290,316,288 bytes including indexes. There were three snapshot chunks, only one compressed.
For that chunk, reported pre-compression size was 6,684,672 bytes and post-compression size
6,873,088 bytes: **about 2.8% larger**, not smaller. This does not establish that representative
full chunks will behave the same way. Measure chunk density, ticker segmentation and index
overhead before making a storage-reduction claim. Retention/selective ingestion already reduce
what is stored, but that is a different result from compression efficiency.

## Financial credibility and remaining scope

- **Strong existing foundation:** source-linked events, date/quote provenance, explicit missing
  data, arithmetic that reconciles, measured drivers, current-holdings scenarios and multiple
  real integrations. The baseline forecaster already separates model selection from a held-out
  evaluation window and compares against no change; preserve that distinction.
- **Historical accuracy is not investment performance.** The rating grades measure whether
  the favored Yes/No side won. Numerous easy thresholds or repeated questions can yield a very
  high percentage. Show calibration/Brier versus a base-rate reference and event/sample counts
  alongside it. A percentage on earnings-call word markets does not validate a stock forecast.
- **AI scenario assumptions are not calibrated impact forecasts.** `FORECASTS.md` explicitly
  authorizes Snowflake to propose shocks and self-rated confidence. Reliable regression
  coefficients do not validate those proposed shocks. The main display and Devpost must retain
  that distinction. The old absolute claim that AI never originates any numeric input no longer
  describes this feature. No realized-outcome validation of the AI impact assumptions was found.
- **AI quote freshness:** assessment cache identity deliberately omits quote and reference-price
  changes. Cached assumptions use original inputs while today's odds are shown separately.
  This is documented behavior, but needs a prominent timestamp and an explicit refresh/expiry
  policy if presented as a current forecast. Do not silently add spend-heavy regeneration.
- **ETF constituent look-through remains absent.** Current fund classification and SPY benchmark
  mapping are useful, but do not calculate weighted exposure through each constituent. Add
  verified issuer holdings/weights/dates before promising that capability; disclose residual
  unclassified weight and avoid double-counting direct plus indirect exposure.
- **Mapping quality still matters more than mapping count.** `REVIEW-TAGS.md` records bulk approval
  and later withdrawn mappings. The sector seed remains `{}`. Inspect the actual series used in
  the demo; a large fixed tag vocabulary alone does not provide reliable holding relationships.
- **Reporting ingestion is still a separate refresh step.** The feed collector exists, but the
  normal scheduler generates summaries from the index rather than maintaining its source feeds.
  Regular source ingestion and publication/ingestion timestamps would strengthen the RAG demo.

## Best next features for Finance + Tiger Data

### First: event replay and a "what changed" view backed by continuous aggregates

Let a user select an event and compare stored odds, quote quality and the same current portfolio's
measured driver exposure at two timestamps. Pair the odds timeline with observed price changes
and the official release marker when available. Show what changed and which holdings have
supported connections; do not label co-movement as causation or reconstruct historical ownership.

Use Timescale continuous aggregates on existing hypertables for hourly/daily first/last quote,
spread and observation-count summaries, preserving source timestamps and empty-book states.
Keep Kalshi-provided candles distinguishable from aggregates of Hedgehog's sampled quotes.
Join the authenticated portfolio after shared market calculations. Add a freshness indicator
and refresh the browser after an ingestion completes; five-minute polling is not tick streaming.
This makes the sponsor technology visible through a useful financial workflow.

[Continuous aggregates](https://www.tigerdata.com/docs/learn/continuous-aggregates) incrementally
materialize time buckets. [Refresh policies](https://www.tigerdata.com/docs/build/continuous-aggregates/refresh-policies)
must be coordinated with the eight-day raw retention: refreshing already-deleted raw periods can
erase their aggregates. Explicitly choose real-time mode if the latest raw data must be included.

### Second: a measured performance and storage exhibit

Show public-data row counts, ingestion freshness, query p50/p95, and actual chunk compression
statistics before/after tuning on the same workload. Separate removal of irrelevant snapshots,
retention and compression rather than attributing all savings to one feature. This supports the
real story of recovering from the database filling in 17 hours. Use measured results, not sponsor
marketing maxima. Keep this an engineering/demo panel, not clutter in the normal investor flow.

### Third: liquidity-aware alerts inside the app

Highlight a stored odds move only when spread, freshness and quote availability support it.
Let users filter by category, reach and trust, and retain the quote pair that triggered the alert.
Use the rollups for efficient historical comparisons and a deduplication record for each alert.
This builds on existing Moves logic instead of inventing a new unvalidated composite score.

Toolkit's [candlestick aggregates](https://docs.tigerdata.com/api/latest/hyperfunctions/financial-analysis/candlestick_agg/)
are useful if true trade/OHLCV inputs are later stored. Current rolling `volume_24h` readings are
not independent trade volumes and must not be summed to fabricate period volume or VWAP.
No new vector database, storage platform or trading endpoint is needed for these priorities.

## Secondary sponsor opportunities

| Sponsor | Feature | Fit and constraints |
| --- | --- | --- |
| ElevenLabs | Spoken briefing with highlighted transcript and links to the event being discussed | Timestamped speech returns character alignment; concurrent work is already starting this. Finish and verify that version first. |
| ElevenLabs | Voice navigation: "show my oil events" or "explain this relationship" | Client tools can change filters or open an event. Bind tools to the current authorized session and render/spoken facts from server data. A new agent setup is additional work, not a free property of existing TTS. |
| Snowflake | Evidence drawer for "why is this linked?" with retrieved filing/release excerpts | Cortex Search hybrid retrieval can support company filings and official releases; retain document date, exact excerpt and link. Requires a better maintained source corpus. |
| Snowflake | Ask a bounded question about displayed portfolio facts | Cortex completion receives typed facts from Tiger Data plus retrieved sources; return referenced fact IDs. Prefer this to generating untested numeric shocks as the sponsor showcase. |

Official capabilities: [ElevenLabs speech timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps/),
[ElevenLabs client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools),
[contextual updates](https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events),
[Cortex Search](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-overview).

[Cortex Analyst](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api)
offers semantic models/views and verified-query references, but it does not directly turn this
Tiger Data database into a Snowflake semantic model. It would need an additional data integration
or maintained analytical copy, so it is a weaker deadline choice for the team's primary tracks.

## Judging assessment and order of work

Hedgehog is a credible contender for Financial Hack because its central problem is concrete:
turning event probabilities into understandable portfolio relevance with evidence. The weak
points are explaining decision value quickly, avoiding overstated statistical confidence,
finishing merged features and showing fast, reliable operation. Winning cannot be predicted
without the competing projects and the actual judges' rubric.

Recommended sequence:

1. Finish and verify the concurrent fixes; fix the release filter and include the omitted tests.
2. Make calibration and uncertainty visible; distinguish observed facts, measured relationships
   and hypothetical/AI assumptions in both the demo and submission.
3. Improve the slow query path, introduce a genuinely used continuous aggregate, and measure it.
4. Demonstrate one event replay/what-changed workflow with a small understandable portfolio.
5. Finish synchronized audio and grounded source excerpts if time remains.

Suggested three-minute narrative: load a portfolio; identify an event that connects several
holdings; compare its odds at two recorded times; inspect the evidence and forecast track record;
show how Tiger Data serves the timeline and the measured storage/performance results. Close on
the decision the user can now make—what to investigate and monitor—not a claim of guaranteed alpha.
