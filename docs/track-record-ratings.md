# Track Record ratings

The primary page uses GET /track-record/ratings?horizon=24&page=1&search=.
Supported hours: 1, 24 (default), 168 and 720. Company pages contain ten entries.
`sort` is history (default, most scored questions first), accuracy-high, accuracy-low or name;
`grade` is A, B, C, D or none (too little history for a grade); `scored=1` keeps only records
with a scored question. They apply to all three tabs, before paging; a record without a
percentage is listed last whichever way accuracy is ordered.
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

## Where the history comes from

Each timeframe reads one store, and no store is a copy of another.

- **24 hours** reads `settled_markets`, the track record the trust score also uses. Its reading
  is the quote standing 24 hours before close: the close of the last hourly candlestick at or
  before that moment, at most seven days old. Kalshi publishes a candlestick only when the quote
  changes, so an earlier one still stands; asking for the exact minute found a quote for about
  one market in six. `npm run job -- backfill` fills it for every series a holding can link to.
- **1 hour, 7 days and 30 days** read `forecast_observations`, filled by
  `npm run job -- backfill-horizons [SERIES...]`. That collector keeps only a bid and ask from
  the minute before the mark, so these timeframes score far fewer questions. A market that was
  not yet listed at a mark is noted as unscored without asking Kalshi.

Left out of every rating, never estimated: a quote published at or after a verified release in
`event_releases`, an exactly even quote, and a market with no reading. Release times are known
for few events, so a quote taken relative to close is not proof that it preceded the public
result.

The page first had a store of its own (`track_markets`, `track_quotes`, `track_sync`, with
`track_company_series` and `track_benchmark_series` naming extra series), filled by a collector
that was off unless switched on. On a database where it had not run the page showed "No history
yet" beside a full `settled_markets`. Migration 017 removes those five tables and the
`track-history`, `track-companies` and `track-funds` jobs.

The nightly job runs `backfill-horizons` last and for a set number of markets
(`HORIZON_MARKETS` in `server/src/jobs/scheduler.ts`), carrying on the night after. Unbounded, it
would ask Kalshi for up to four quotes for every settled market of every reviewed series.

## Names

`track_entities` holds Yahoo's name and type for each ticker in the tag list: EQUITY is a
company, ETF and MUTUALFUND a fund, INDEX an index. It covers tickers nobody holds, so a company
can be looked up before it is bought. `npm run job -- track-entities` names up to twenty at a
time and runs hourly with the price jobs; a holding it has not reached is named from its Yahoo
profile in `security_profiles`. Unsupported or missing identities do not appear as invented
companies. Lookup is a search of this catalogue, not unrestricted ticker discovery.

The existing GET /track-record and all trust-score calculations retain their original
calibration behavior. The previous detailed UI module remains available for its existing
component tests, but is not rendered by the primary page.

## Companies

A company's record covers the series tagged with its ticker and reviewed in `series_tags`, the
same tags that draw a Direct link everywhere else. Percentages describe company-specific
questions (including earnings-call words), not how accurately stock returns were predicted.
The linked-holdings disclosure caps its content at 220px with keyboard-accessible vertical scrolling.

## ETFs and index funds

The primary page has three separate tabs: Asset holdings, Companies, and ETFs & index
funds. The fund view treats a fund/index as one record and never expands constituents.
The public S&P 500 record uses a reviewed list of index-price series
(`SP500_BENCHMARK_SERIES`): KXINX, KXINXU, KXINXAB, KXINXW, KXINXM and KXINXY, checked against
the official catalog's Financials category, price-question title and .INX:INDEXSP
settlement-source URL. Only the ones a holding can link to are in the track record, so the
benchmark's history is what the backfill holds for those.

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
