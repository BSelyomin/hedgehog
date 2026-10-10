-- Additive benchmark identities used only by the new Track Record view.
CREATE TABLE track_benchmark_series (
    benchmark text NOT NULL,
    series_ticker text PRIMARY KEY,
    title text NOT NULL,
    source_url text NOT NULL,
    evidence text NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON track_benchmark_series(benchmark);
