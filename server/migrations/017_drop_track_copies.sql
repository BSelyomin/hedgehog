-- The Track record page first read its history from a second store (track_markets, track_quotes,
-- with track_sync as its progress), filled by a collector that was off unless switched on. On a
-- database where it had not run the page was empty, while settled_markets held the record. The
-- page now reads settled_markets (24 hours) and forecast_observations (the other timeframes), and
-- nothing reads or writes these three any more.
DROP TABLE IF EXISTS track_quotes;
DROP TABLE IF EXISTS track_markets;
DROP TABLE IF EXISTS track_sync;
-- Series matched to a company by name, without the review every other link goes through. The
-- page uses the reviewed company tags in series_tags.
DROP TABLE IF EXISTS track_company_series;
-- Six rows naming the S&P 500 index series, which are a list in the code
-- (SP500_BENCHMARK_SERIES in server/src/services/history-subjects.ts).
DROP TABLE IF EXISTS track_benchmark_series;
-- track_entities stays: it names the tickers Kalshi has markets on, held or not.
