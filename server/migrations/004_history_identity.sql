ALTER TABLE settled_markets ADD COLUMN series_ticker text;
ALTER TABLE settled_markets ADD COLUMN event_ticker text;
ALTER TABLE settled_markets ADD COLUMN title text;
UPDATE settled_markets s SET series_ticker=m.series_ticker,event_ticker=m.event_ticker,title=m.title
FROM markets m WHERE s.ticker=m.ticker;
