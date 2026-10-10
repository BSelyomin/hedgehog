-- The job often runs after midnight UTC. Its run timestamp is not the date
-- of the prices used to measure a sensitivity. Unknown legacy dates stay null
-- until the next measurement job; do not guess them during migration.
ALTER TABLE measured_links ADD COLUMN price_through date;
