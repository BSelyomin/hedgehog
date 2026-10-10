-- Extend the combined manual/brokerage view after the asset columns exist.
-- Existing columns retain their order for deployed views and dependent readers.
CREATE OR REPLACE VIEW portfolio_holdings AS
SELECT session_id,symbol,value_usd,updated_at,asset_type,details FROM holdings
UNION ALL
SELECT session_id,symbol,value_usd,updated_at,'security'::text AS asset_type,'{}'::jsonb AS details FROM brokerage_holdings;
