CREATE TABLE snaptrade_users (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('sandbox','live')),
    client_hash text NOT NULL,
    provider_user_id text NOT NULL,
    encrypted_secret text NOT NULL,
    checked_at timestamptz,
    PRIMARY KEY(user_id,mode)
);
CREATE TABLE brokerage_connections (
    user_id uuid NOT NULL,
    mode text NOT NULL,
    id uuid NOT NULL,
    name text NOT NULL,
    disabled boolean NOT NULL,
    disconnected boolean NOT NULL DEFAULT false,
    PRIMARY KEY(user_id,mode,id),
    FOREIGN KEY(user_id,mode) REFERENCES snaptrade_users ON DELETE CASCADE
);
CREATE TABLE brokerage_accounts (
    user_id uuid NOT NULL,
    mode text NOT NULL,
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    name text NOT NULL,
    institution text NOT NULL,
    number_mask text NOT NULL,
    included boolean NOT NULL DEFAULT false,
    available boolean NOT NULL DEFAULT false,
    positions jsonb NOT NULL DEFAULT '[]',
    as_of timestamptz,
    sync_error text,
    PRIMARY KEY(user_id,mode,id),
    FOREIGN KEY(user_id,mode,connection_id) REFERENCES brokerage_connections(user_id,mode,id) ON DELETE CASCADE
);
CREATE VIEW brokerage_holdings AS
SELECT 'user:' || a.user_id::text AS session_id,a.mode,p->>'symbol' AS symbol,
       SUM((p->>'valueUsd')::numeric) AS value_usd, MIN(a.as_of) AS updated_at
FROM brokerage_accounts a
JOIN brokerage_connections c ON c.user_id=a.user_id AND c.mode=a.mode AND c.id=a.connection_id
CROSS JOIN LATERAL jsonb_array_elements(a.positions) p
WHERE a.included AND a.available AND NOT c.disabled AND NOT c.disconnected
AND p->>'excludedReason' IS NULL AND p->>'valueUsd' IS NOT NULL
GROUP BY a.user_id,a.mode,p->>'symbol';
CREATE VIEW portfolio_holdings AS
SELECT session_id,symbol,value_usd,updated_at FROM holdings
UNION ALL SELECT session_id,symbol,value_usd,updated_at FROM brokerage_holdings;

ALTER TABLE briefings ADD COLUMN portfolio_revision text NOT NULL DEFAULT '';
