-- Additive Track Record storage. Existing history, holdings and trust tables are untouched.
CREATE TABLE track_entities (
    symbol text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK(kind IN ('company','fund','index')),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE track_markets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticker text NOT NULL UNIQUE,
    series_ticker text NOT NULL,
    event_ticker text NOT NULL,
    close_time timestamptz NOT NULL,
    settlement_time timestamptz NOT NULL,
    occurrence_time timestamptz,
    outcome smallint NOT NULL CHECK(outcome IN (0,1)),
    source text NOT NULL CHECK(source IN ('live','historical')),
    fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON track_markets(series_ticker);
CREATE TABLE track_quotes (
    market_id bigint NOT NULL REFERENCES track_markets(id),
    horizon_hours smallint NOT NULL CHECK(horizon_hours IN (1,24,168,720)),
    quote_time timestamptz,
    yes_bid numeric,
    yes_ask numeric,
    status text NOT NULL CHECK(status IN ('quoted','missing','outcome_known')),
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(market_id,horizon_hours),
    CHECK((status='quoted' AND quote_time IS NOT NULL AND yes_bid IS NOT NULL AND yes_ask IS NOT NULL AND yes_bid BETWEEN 0 AND 1 AND yes_ask BETWEEN yes_bid AND 1)
       OR (status<>'quoted' AND quote_time IS NULL AND yes_bid IS NULL AND yes_ask IS NULL))
);
CREATE TABLE track_sync (
    series_ticker text NOT NULL,
    source text NOT NULL CHECK(source IN ('live','historical')),
    cursor text NOT NULL DEFAULT '',
    page_offset integer NOT NULL DEFAULT 0 CHECK(page_offset>=0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(series_ticker,source)
);
