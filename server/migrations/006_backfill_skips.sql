-- Settled markets the backfill could not score, so coverage can be reported instead of silently shrinking the sample.
CREATE TABLE backfill_skips (
    ticker text PRIMARY KEY,
    series_ticker text NOT NULL,
    category text NOT NULL,
    reason text NOT NULL CHECK(reason IN ('no_quote','outcome_known')),
    close_time timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now()
);
