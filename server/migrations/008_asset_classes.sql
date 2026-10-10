-- Typical effect (|b| times the driver's typical change) lets a holding's drivers be compared.
ALTER TABLE measured_links ADD COLUMN effect double precision;
-- Holdings beyond listed securities. Existing rows are securities; details holds the terms that
-- exact calculations need (maturity, coupon, location, mortgage).
ALTER TABLE holdings ADD COLUMN asset_type text NOT NULL DEFAULT 'security' CHECK (asset_type IN ('security','cash','treasury','bond','property'));
ALTER TABLE holdings ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
-- treasury-yields is now measured against the 10-year Treasury yield. These three series are
-- about tokenised Treasuries, a stablecoin's reserves and foreign holders, not a yield.
UPDATE series_tags SET reviewed=false WHERE (series_ticker, tag) IN (('KXTOKENUST','treasury-yields'), ('KXUSDTTBILL','treasury-yields'), ('KXUSTHOLDERS','treasury-yields'));
