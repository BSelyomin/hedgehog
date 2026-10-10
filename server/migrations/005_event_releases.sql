CREATE TABLE event_releases (
    event_ticker text PRIMARY KEY,
    title text NOT NULL,
    released_at timestamptz NOT NULL,
    source_url text NOT NULL CHECK(source_url LIKE 'https://%'),
    verified_at timestamptz NOT NULL DEFAULT now()
);
