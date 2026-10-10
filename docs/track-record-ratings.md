# Track Record ratings

The primary page uses GET /track-record/ratings?horizon=24&page=1&search=.
Supported hours: 1, 24 (default), 168 and 720. Company pages contain ten entries.
An empty search shows verified company holdings plus companies whose reviewed direct-company series link to this session's holdings. Reviewed macro theme links are displayed separately and never substituted for company-specific accuracy. Rows with scored data sort first, before pagination. A search matches verified company names or symbols in the cached
allowed-tag catalog. ETFs, mutual funds and indexes are not expanded into constituents.
The six asset cards reuse reviewed series tags and existing holding-link evidence.

Accuracy = favored outcomes that matched / scored binary questions. The favored side
comes from the historical bid–ask midpoint; exactly 50% is excluded. Grade thresholds:
A >=90%, B >=75%, C >=50%, D <50%. Grades require >=30 scored questions and >=10 event IDs.
Those cutoffs are a product sample gate, not a statistical confidence guarantee.
Multiple thresholds can share an event; even different event IDs can share one release.
Easy questions and missing quotes can bias the percentage. This is not calibration,
investment performance, or an estimate of the next event's probability.

## Official data and bounded collection

Use Kalshi GET /historical/markets with reviewed series_ticker, cursor and limit=100 (archive filters are mutually exclusive). Recent final markets are fetched with GET /markets?status=settled.
Combo markets are rejected by their mve_collection_ticker/mve_selected_legs fields.
Only finalized, non-provisional binary Yes/No results with settlement_ts are accepted.
close_time anchors the horizon; settlement_ts is stored separately, never substituted
for close_time. Quotes use GET /historical/markets/{ticker}/candlesticks; recent markets
first use GET /series/{series}/markets/{ticker}/candlesticks and fall back to the archive.
The collector requests only the minute surrounding each target and retains a valid
bid/ask candle ending within 60 seconds before it. No other horizon substitutes.

Quotes at/after a sourced event_releases timestamp, Kalshi occurrence_datetime (when
no sourced timestamp exists), or final settlement are excluded. These release fields
are incomplete and occurrence times may be administrative: close-relative scoring
is not proof that every quote preceded the actual public outcome announcement.
Missing quotes remain missing; API outages throw without advancing the checkpoint.

Migration 014 only creates track_entities, track_markets, track_quotes and track_sync.
The collector writes only these new tables. It does not rewrite settled_markets,
forecast_observations, odds_snapshots, holdings, tags or trust scores. A market's identity
and outcome are stored once, with at most four compact quote/status rows; no candle
series or raw API responses are retained. Missing statuses cost a small row to document
coverage. Old records are retained; the new page intentionally does not copy their odds.

Run after applying migrations:

    npm run job -- track-entities
    npm run job -- track-history KXCPI

A history invocation handles at most 25 final markets across three reviewed series by
default, capped internally at 50 markets/six series. It processes one listing page per
source/series and checkpoints its offset/cursor. Repeat to continue. Complete scans can
restart to discover newer history and refresh outcomes; valid quotes are cached.
No large backfill is started automatically. Set TRACK_HISTORY_ENABLED=true to opt into
one bounded collection plus identity refresh hourly at :40 (restart backend afterward).
The page can remain sparse until those bounded collections accumulate usable history.

Company metadata uses the existing Yahoo Finance client: EQUITY is a company;
ETF/MUTUALFUND is a fund and INDEX is an index. Unsupported/missing identities do not
appear as invented companies. Lookup is catalog search, not unrestricted ticker discovery.

The existing GET /track-record and all trust-score calculations retain their original
calibration behavior. The previous detailed UI module remains available for its existing
component tests, but is not rendered by the primary page.

Monitor actual table/index sizes before increasing collection budgets. New normalized
storage grows with unique settled questions and has no additional full-history timeseries.
The existing five-minute odds table remains a separate storage concern; this change does
not alter its policies or assume that a local Docker database represents Tiger cloud usage.

## Company coverage extension

Migration 015 adds track_company_series, with the official series URL, title and matching
settlement-source evidence. `npm run job -- track-companies` discovers identities for
verified company holdings from GET /series. It requires either an issuer settlement source
and an explicit company title/exact earnings-series symbol, or an unambiguous normalized
company name of at least six characters in the title and an identified settlement source.
Unmatched, ambiguous and malformed metadata is skipped. Entertainment rankings and
election categories are excluded; proposed AI tags alone are never approved or copied.
This mapping is separate from existing series_tags and does not change trust scoring.

`npm run job -- track-company-history` continues a bounded company-history collection.
At most 25 final markets are processed, with at most five per series; the original horizon
checks apply. The collector can request only a selected horizon for a small initial sample
without manufacturing other horizons. Company percentages describe company-specific
questions (including earnings-call words), not how accurately stock returns were predicted.
The linked-holdings disclosure caps its content at 220px with keyboard-accessible vertical scrolling.

## ETFs and index funds

The primary page has three separate tabs: Asset holdings, Companies, and ETFs & index
funds. The fund view treats a fund/index as one record and never expands constituents.
The public S&P 500 record uses verified index-price series registered by
`npm run job -- track-funds`: KXINX, KXINXU, KXINXAB, KXINXW, KXINXM and KXINXY,
validated against the official catalog's Financials category, price-question title and
.INX:INDEXSP settlement-source URL. Collect via the existing bounded track-history job.
Migration 016 only adds track_benchmark_series; existing tags and trust remain unchanged.

SPY is linked to this benchmark using State Street's published fund information. This
is a score of S&P 500 questions, not a score of SPY share-price tracking differences.
Other saved funds/indexes are shown separately and score only verified questions about
that specific fund/index. Broad Fed, inflation or Treasury-yield records are never used
as substitute fund scores. Unmapped funds remain unscored. Fund pagination is independent
of company pagination, with ten records per page.

Track Record's holding disclosures now show the name, entered USD position value and
position value / total entered portfolio value. Enrichment uses only the requesting
session's saved holdings, with unavailable values shown as unavailable rather than zero.
The list has ticker/name search, spaced rows, a persistent scroll hint and visible scroll
styling. Search stays outside the 260px scrolling region. Values are not live valuations.
