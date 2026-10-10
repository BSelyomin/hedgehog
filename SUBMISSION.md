# Hedgehog — draft submission

Prediction markets tell you the odds. Hedgehog tells you which odds are about your portfolio, and how much evidence supports them.

Hedgehog is a read-only portfolio event dashboard with a holdings exposure map, upcoming-event calendar, outcome odds and trust breakdown, earnings market preview, daily move explanation and settled-market calibration. Links distinguish company markets, historical driver associations and unmeasured relationships. Every observed number must come from source data or a documented calculation; absent support means an absent number.

Tiger Data stores the odds and price histories as TimescaleDB hypertables. Snowflake Cortex maps series and supplied filing risk factors into a fixed tag vocabulary. An optional Cortex Search index supplies reporting for source-linked context with numeric validation. ElevenLabs can turn an exact database-backed template into a cached daily audio briefing. Live Snowflake functionality requires account credentials and, for summaries, a populated source index. A live Cortex completion and one Cortex Search query were verified on October 9, 2026 (see SOURCES.md); summaries for a given portfolio still depend on relevant indexed reporting.

Implementation has been prepared with Docker Compose for a transferable frontend, backend and database. Before submission, verify live jobs and all tests, review tags and the sector table, validate sponsor integrations, record the demo, add screenshots, confirm eligibility and eligible track count, and replace this paragraph with verified deployment and results. No live demo URL is claimed in this draft.
