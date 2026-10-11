-- Independent observations: never manufacture a 7/30-day probability from a 24-hour quote.
CREATE TABLE forecast_observations (
    ticker text NOT NULL,
    horizon_hours integer NOT NULL CHECK(horizon_hours IN (24,168,720)),
    series_ticker text NOT NULL,
    event_ticker text,
    title text,
    category text NOT NULL,
    yes_bid double precision NOT NULL CHECK(yes_bid BETWEEN 0 AND 1),
    yes_ask double precision NOT NULL CHECK(yes_ask BETWEEN yes_bid AND 1),
    outcome integer NOT NULL CHECK(outcome IN (0,1)),
    close_time timestamptz NOT NULL,
    odds_time timestamptz NOT NULL,
    loaded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(ticker,horizon_hours),
    CHECK(odds_time <= close_time - horizon_hours * interval '1 hour'),
    CHECK(odds_time >= date_trunc('second',close_time) - horizon_hours * interval '1 hour' - interval '60 seconds')
);
CREATE INDEX ON forecast_observations(horizon_hours,series_ticker,close_time DESC);
ALTER TABLE backfill_skips ADD COLUMN horizon_hours integer NOT NULL DEFAULT 24 CHECK(horizon_hours IN (24,168,720));
ALTER TABLE backfill_skips DROP CONSTRAINT backfill_skips_pkey;
ALTER TABLE backfill_skips ADD PRIMARY KEY(ticker,horizon_hours);
