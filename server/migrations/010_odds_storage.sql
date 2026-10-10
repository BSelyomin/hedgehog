-- Odds history filled the database in 17 hours: about 141,000 rows every five minutes, 95% of
-- them for markets no holding can link to. Keep history only for markets in series that can link
-- (snapshot_series, refreshed by the poller), in daily chunks that are compressed after a day and
-- dropped after eight. The event chart shows seven days.
CREATE TABLE snapshot_series (series_ticker text PRIMARY KEY);
-- Enforced in the database so that an older backend sharing it cannot fill it again.
CREATE FUNCTION keep_linked_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM markets m JOIN snapshot_series s ON s.series_ticker = m.series_ticker WHERE m.ticker = NEW.ticker) THEN
        RETURN NEW;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER keep_linked_snapshot BEFORE INSERT ON odds_snapshots FOR EACH ROW EXECUTE FUNCTION keep_linked_snapshot();
SELECT set_chunk_time_interval('odds_snapshots', INTERVAL '1 day');
SELECT add_retention_policy('odds_snapshots', INTERVAL '8 days');
DO $$
BEGIN
    BEGIN
        ALTER TABLE odds_snapshots SET (timescaledb.enable_columnstore, timescaledb.segmentby = 'ticker', timescaledb.orderby = 'ts DESC');
        CALL add_columnstore_policy('odds_snapshots', after => INTERVAL '1 day');
    EXCEPTION WHEN OTHERS THEN
        -- TimescaleDB before 2.18 has the same feature under its older names.
        ALTER TABLE odds_snapshots SET (timescaledb.compress, timescaledb.compress_segmentby = 'ticker', timescaledb.compress_orderby = 'ts DESC');
        PERFORM add_compression_policy('odds_snapshots', INTERVAL '1 day');
    END;
END $$;
