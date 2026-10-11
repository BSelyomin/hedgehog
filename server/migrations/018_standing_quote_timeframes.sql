-- The 1-hour, 7-day and 30-day timeframes are read by the 24-hour rule: the quote standing at the
-- mark is the last one Kalshi published before it, which can be up to seven days older
-- (LOOKBACK_DAYS in server/src/jobs/backfill.ts). The table required a quote from the minute before
-- the mark, which Kalshi publishes for about one market in six, so these timeframes stayed empty.
-- A row may still not be later than its mark (forecast_observations_check1 is kept).
ALTER TABLE forecast_observations DROP CONSTRAINT IF EXISTS forecast_observations_check2;
ALTER TABLE forecast_observations ADD CONSTRAINT forecast_observations_standing_quote
    CHECK(odds_time >= date_trunc('second',close_time) - horizon_hours * interval '1 hour' - interval '7 days');
