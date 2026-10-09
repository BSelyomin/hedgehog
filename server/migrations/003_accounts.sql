CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    name text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Store only a digest of the random bearer token sent in the HttpOnly cookie.
CREATE TABLE auth_sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth_sessions(user_id);
CREATE INDEX ON auth_sessions(expires_at);

CREATE TABLE auth_rate_limits (
    key text PRIMARY KEY,
    attempts integer NOT NULL,
    resets_at timestamptz NOT NULL
);

-- Existing holdings/briefings retain their anonymous UUID owners. Account owners
-- use 'user:<uuid>', which cannot be supplied through the legacy guest cookie.
