-- Keep the provenance and review state of existing Gemini/manual tags.
ALTER TABLE series_tags DROP CONSTRAINT series_tags_source_check;
ALTER TABLE series_tags ADD CONSTRAINT series_tags_source_check
    CHECK (source IN ('gemini', 'snowflake', 'manual'));
