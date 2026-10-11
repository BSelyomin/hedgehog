-- The event chart's longer ranges need odds from before Hedgehog started polling, and for the
-- hours it was not running. Kalshi publishes both as candlesticks: the closing bid and ask of each
-- hour and of each day. Stored here as midpoints for markets in series that can link to a holding
-- (snapshot_series): hourly closes for the past eight days, daily closes since listing.
ALTER TABLE markets ADD COLUMN open_time timestamptz;
CREATE TABLE odds_candles (
    ticker text NOT NULL,
    minutes integer NOT NULL CHECK (minutes IN (60, 1440)),
    ts timestamptz NOT NULL,
    mid double precision NOT NULL CHECK (mid BETWEEN 0 AND 1),
    PRIMARY KEY (ticker, minutes, ts)
);
-- How far each market's candlesticks have been fetched, so a run asks only for what is new.
CREATE TABLE candle_progress (
    ticker text NOT NULL,
    minutes integer NOT NULL,
    through timestamptz NOT NULL,
    PRIMARY KEY (ticker, minutes)
);
