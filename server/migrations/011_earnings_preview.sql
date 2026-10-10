-- Strike values let a ladder of "above X" markets be read in order of level, which the earnings
-- preview needs to say where traders put even odds. Filled by the poller.
ALTER TABLE markets ADD COLUMN floor_strike double precision, ADD COLUMN cap_strike double precision;
-- Company names from the SEC ticker file, shown beside the ticker. Filled by the earnings-dates job.
CREATE TABLE companies (symbol text PRIMARY KEY, name text NOT NULL, loaded_at timestamptz NOT NULL DEFAULT now());
