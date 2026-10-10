-- A midpoint says little when the quote around it is wide: a book with no bid and an offer at 90
-- cents has a midpoint of 45%, and it jumps tens of points when one side steps back. The Moves
-- screen compares odds across a window only between quotes that were narrow at both ends, so each
-- candlestick now keeps the spread between its closing bid and ask. Rows stored before this have
-- none; the candlestick job fetches those markets again and fills it in.
ALTER TABLE odds_candles ADD COLUMN spread real CHECK (spread BETWEEN 0 AND 1);
-- Finds the markets still to be fetched again. It empties as their spreads arrive.
CREATE INDEX odds_candles_unsized ON odds_candles (ticker, minutes) WHERE spread IS NULL;
