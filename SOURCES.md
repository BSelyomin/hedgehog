# API contracts consulted

- [Kalshi open events and nested markets](https://docs.kalshi.com/api-reference/events/get-events): public host, cursor, status, nested markets, dollar quote fields and fixed-point activity/depth fields.
- [Kalshi market candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks): series/ticker path, start/end Unix seconds, one-minute resolution, yes_bid/yes_ask close_dollars.
- [Kalshi settled markets](https://docs.kalshi.com/api-reference/market/get-markets): status filter and pagination.
- [Kalshi historical candlesticks](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks): older-history fallback.
- [Yahoo Finance SDK source and documentation](https://github.com/gadicc/yahoo-finance2): constructor, chart and assetProfile modules. Chart quote objects expose date and close; the library is unofficial.
- [FRED observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html): DGS2 series observations, observation_start and JSON date/value fields.
- [Snowflake Cortex REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api): `/api/v2/cortex/v1/chat/completions`, PAT authentication, JSON-schema output and non-streaming `choices[].message.content` responses. The implementation uses Node's built-in fetch, not a Google SDK.
- [Snowflake PAT authentication](https://docs.snowflake.com/en/user-guide/programmatic-access-tokens): token setup and account authentication policy requirements.
- [Cortex Search queries](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service): the database/schema/service REST query path, selected columns and `results` rows. Hedgehog defines an index contract of `TITLE`, `URL`, `TEXT` and a `PUBLISHED_AT` timestamp attribute. Requests restrict publication times to the preceding 90 days.
- [Cortex Search creation](https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search): provisioning and maintaining the optional reporting index. This is not an automatic open-web search integration.
- Public primary-source seed feeds: [Federal Reserve monetary policy](https://www.federalreserve.gov/feeds/press_monetary.xml), [EIA Today in Energy](https://www.eia.gov/rss/todayinenergy.xml), and [BLS latest releases](https://www.bls.gov/feed/bls_latest.rss). The collector preserves original titles, descriptions, source URLs and publication dates; it skips inaccessible feeds and malformed dates.
- [Kalshi market fields](https://docs.kalshi.com/api-reference/market/get-market): `occurrence_datetime` ("the recorded datetime when the underlying event occurred, if available"), `expected_expiration_time` and `latest_expiration_time`. `expiration_time` is deprecated. Event `strike_date` is not described on that page; it was taken from live event responses.
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces): `https://www.sec.gov/files/company_tickers.json` (entries with `cik_str`, `ticker`, `title`) and `https://data.sec.gov/submissions/CIK##########.json` (`filings.recent` parallel arrays including `accessionNumber`, `filingDate`, `reportDate`, `form`, `items`; older lists named in `filings.files`). Requests must carry an identifying User-Agent.
- [Tiger Data service setup](https://www.tigerdata.com/docs/get-started/quickstart/create-service): PostgreSQL service with TimescaleDB for the application's existing `pg` connection.
- [ElevenLabs official SDK](https://github.com/elevenlabs/elevenlabs-js) and [speech conversion API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert): convert, model and MP3 output.

Snowflake contracts were checked against official documentation during migration. On 2026-10-09, a live PAT-authenticated Cortex request using `claude-sonnet-4-5` returned HTTP 200 and JSON content with an empty `finish_reason` and populated `usage.completion_tokens`. The parser accepts that observed variant only below the requested token limit and still rejects explicit truncation, refusals and invalid JSON; callers continue validating the task data. Regression tests cover this response shape. This inference check does not verify Cortex Search or all AI jobs. Yahoo history loading has worked locally, while Kalshi connections have reset in this environment. Do not treat mocks or successful compilation as proof of live provider compatibility.

On 2026-10-09, `HEDGEHOG.REPORTING.EVENT_SOURCES` was provisioned with 21 dated Federal Reserve and EIA feed excerpts. BLS was unreachable and skipped. A live REST search with the publication-date filter returned five source passages; a Cortex-generated context sentence passed the application's number and source-ID checks. This validates retrieval and guarded generation, not the availability of summaries for a portfolio: those still need holdings, relevant reporting and human-reviewed market tags. Refresh the feed collection explicitly using the commands in DEPLOY.md.
# Event dates and earnings-report dates (October 10, 2026)

- Kalshi timing fields were read from live responses for five events before use. Apple's
  earnings-call market has `occurrence_datetime` 2026-10-29T21:00Z and `close_time`
  2026-11-12T15:00Z; an S&P 500 year-end event carries `strike_date`. After one full poll,
  421 of 425 linked events in the 25-holding test portfolio had a Kalshi event date.
- EDGAR's ticker file, Apple's filing list, an older filing-list page and one filing index
  page were fetched and inspected. The filing-list `acceptanceDateTime` for Apple's 8-K of
  2026-07-30 reads 2026-07-31T00:30:28Z, while the filing page shows it accepted at 16:30:28
  Eastern on 2026-07-30. Because the two disagree by eight hours, Hedgehog does not infer
  pre-market or after-close timing; it measures across the filing date instead.
- The earnings-dates job ran against EDGAR for the 25 held symbols on 2026-10-10. Apple and
  JPMorgan each returned eight reports whose dates match their quarterly results days; the
  banks needed the older filing lists. SPY returned none and TLT is not in the ticker file.
- XOM returned one report. Its ticker now maps to a new registrant, ExxonMobil Holdings Corp
  (CIK 2115436), whose filings begin on 2026-07-01. Reports filed by a predecessor registrant
  are not followed, so a company that changes registrant starts with a short history.

# Earnings-call dates and strike values (October 10, 2026)

- All 62 open earnings-call events state their date in the event subtitle ("On Oct 20, 2026").
  The markets' `occurrence_datetime` agreed with it for 39 and held another date for 23: later
  by one day or by about two weeks, or equal to the market close (United: March 31, 2027).
  Thirty-one carried exactly 10:00 am New York time. Hedgehog therefore dates a call by the
  stated day, and reports a time of day only from an occurrence time on that day that is not
  10:00 am.
- `floor_strike` and `cap_strike` are numbers on live market responses (Apple headcount:
  164000, 166000, ...). `product_metadata.competition_scope` names the metric on some events;
  it is not stored.
- Kalshi lists no company revenue or earnings-per-share markets. Company results markets are
  ladders of "above X" levels on operating metrics (232 open) and earnings-call word markets.

# Settled markets for the track record (October 10, 2026)

- `GET /markets?status=settled&series_ticker=…` and `GET /historical/markets?series_ticker=…`
  both accept `limit=1000` and return `ticker`, `event_ticker`, `title`, `open_time`,
  `close_time` and `result`. Most settled markets are in the archive: CPI had 25 on the live
  listing and 483 archived, the Fed series 11 and 402.
- The batch candlestick endpoint returns nothing for an archived market; those are read one at
  a time from `GET /historical/markets/{ticker}/candlesticks`, which accepts
  `period_interval=60` and names its prices `yes_bid.close` and `yes_ask.close`.
- Reading the odds 24 hours before close: of 36 live-listed CPI and Fed markets, a one-minute
  candlestick existed at the exact mark for 6; the last hourly candlestick within the week
  before the mark existed for all 36, with a median age of 1.4 to 2.9 hours and at most 20.9.
- Daily markets ("gas prices tomorrow", 3,697 settled in one series) open about 16 hours
  before they close, so they have no quote 24 hours before close.

# Security profiles for asset classes (October 10, 2026)

- Yahoo `quoteSummary` was called for about 150 tickers and the replies inspected.
  `quoteType.quoteType` was EQUITY, ETF, MUTUALFUND, MONEYMARKET, CRYPTOCURRENCY or INDEX, and
  NONE for a symbol that is not a security. `assetProfile.sector` and `.industry` are present for
  companies; `fundProfile.categoryName` for ETFs and most mutual funds (null for one, FCNTX).
- Every fund category in `server/seed/fund_classes.json` is a name one of those replies
  contained, except the two prefix entries: `Target-Date *` (observed as Target-Date 2055) and
  `Allocation--*` (observed as Allocation--50% to 70% Equity). Categories seen and deliberately
  left unmapped: Trading--Leveraged Equity, Trading--Inverse Equity, Trading--Miscellaneous,
  Single Currency, Systematic Trend, Preferred Stock and Convertibles.
- yahoo-finance2 3.15.4 rejects every mutual fund's `fundProfile` against its own schema and
  prints a debug line per field while doing so. The profile job therefore reads replies without
  schema validation, checks each field it uses is text, and mutes `console.log` for the one
  fund-profile call.

# Candlesticks for the odds chart (October 10, 2026)

- [Batch candlesticks](https://docs.kalshi.com/api-reference/market/batch-get-market-candlesticks):
  `GET /markets/candlesticks` with `market_tickers` (at most 100), `start_ts`, `end_ts` and
  `period_interval` in minutes; at most 10,000 candlesticks per reply across all markets. The
  reply is `markets[]` of `market_ticker` and `candlesticks[]`, each with `end_period_ts` (the
  inclusive end of the period) and `yes_bid` / `yes_ask` objects holding `close_dollars`.
- Live replies for five stored markets: daily periods end at midnight New York (04:00 UTC in
  summer), only finished periods are returned, and `price` is empty when nothing traded.
  Candlesticks are not published for every period: one Fed market listed 362 days earlier had
  293 daily candlesticks, with gaps of up to 12 days.
- What a missing candlestick means was checked against our own five-minute readings for 200
  markets over 22 hours. Of 744 closely watched hours with no hourly candlestick, the quote
  was unchanged in 741. Where a candlestick was published and we had a reading within five
  minutes of the hour's end, its closing bid and ask equalled that reading in 199 of 214 hours.
  The chart therefore holds each reading until the next one rather than sloping between them.
- Nested markets in the events listing carry `open_time`, which is stored as the start of a
  market's history.

# Additional coverage validation (October 9, 2026)

- [Kalshi historical data](https://docs.kalshi.com/getting_started/historical_data): older
  settled markets require the separate historical listing, not only a candlestick fallback.
- [Historical market listing](https://docs.kalshi.com/api-reference/historical/get-historical-markets):
  supports series filtering and independent cursor pagination.
- [Historical candlesticks](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks):
  archived `yes_bid.close` and `yes_ask.close` are dollar strings, normalized separately from
  live `close_dollars` fields. Empty arrays and missing archives do not support a midpoint.
- [Events listing](https://docs.kalshi.com/api-reference/events/get-events): open events are
  paginated at up to 200 per page. Validated pages are now stored in database batches.
- Live verification: the original four approved company events close in 2029–2035. Their
  low activity/open interest explains low trust under the unchanged scoring formula.
  After six user-approved macro mappings, the 25-holding portfolio returned 19 events,
  including three within 14 days and fifteen with measured links. These are observations
  at setup time, not fixed counts or guarantees.
