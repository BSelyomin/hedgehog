-- Kalshi's own timing fields, so the calendar can show when an event happens rather than when
-- its market stops trading. Filled by the poller; null until a market is next polled.
ALTER TABLE events ADD COLUMN strike_date timestamptz;
ALTER TABLE markets ADD COLUMN occurrence_time timestamptz, ADD COLUMN expected_expiration_time timestamptz;
