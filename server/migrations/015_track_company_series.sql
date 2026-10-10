-- Track Record-only company identities; existing reviewed tags and trust remain untouched.
CREATE TABLE track_company_series (
    series_ticker text PRIMARY KEY,
    symbol text NOT NULL REFERENCES track_entities(symbol),
    title text NOT NULL,
    source_url text NOT NULL,
    evidence text NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON track_company_series(symbol);
