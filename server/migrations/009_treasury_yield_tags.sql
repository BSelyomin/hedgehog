-- treasury-yields now carries numbers: links measured against the 10-year Treasury yield and bond
-- prices calculated per point of yield. These series are a funding rate, a savings-bond fixed
-- rate and a yield spread, not a Treasury yield. They keep any other approved tags they have.
UPDATE series_tags SET reviewed=false WHERE (series_ticker, tag) IN (
    ('KXCREDITC','treasury-yields'), ('KXSOFRD','treasury-yields'), ('KXIBONDFIX','treasury-yields'),
    ('KX10Y2Y','treasury-yields'), ('KX10Y2YDATE','treasury-yields'));
