-- Add the one-hour evaluation without changing any stored horizon or probability.
ALTER TABLE forecast_observations DROP CONSTRAINT forecast_observations_horizon_hours_check;
ALTER TABLE forecast_observations ADD CONSTRAINT forecast_observations_horizon_hours_check CHECK(horizon_hours IN (1,24,168,720));
ALTER TABLE backfill_skips DROP CONSTRAINT backfill_skips_horizon_hours_check;
ALTER TABLE backfill_skips ADD CONSTRAINT backfill_skips_horizon_hours_check CHECK(horizon_hours IN (1,24,168,720));
