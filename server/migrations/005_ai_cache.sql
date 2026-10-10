-- Content-addressed AI results survive restarts. No TTL: market polling and the
-- passage of time must not trigger another paid generation.
CREATE TABLE ai_cache (
    namespace text NOT NULL,
    input_hash text NOT NULL,
    value jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (namespace, input_hash)
);

ALTER TABLE risk_factors ADD COLUMN input_hash text NOT NULL DEFAULT '';
