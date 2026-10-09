# API contracts consulted

- [Kalshi open events and nested markets](https://docs.kalshi.com/api-reference/events/get-events): public host, cursor, status, nested markets, dollar quote fields and fixed-point activity/depth fields.
- [Kalshi market candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks): series/ticker path, start/end Unix seconds, one-minute resolution, yes_bid/yes_ask close_dollars.
- [Kalshi settled markets](https://docs.kalshi.com/api-reference/market/get-markets): status filter and pagination.
- [Kalshi historical candlesticks](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks): older-history fallback.
- [Yahoo Finance SDK source and documentation](https://github.com/gadicc/yahoo-finance2): constructor, chart and assetProfile modules. Chart quote objects expose date and close; the library is unofficial.
- [FRED observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html): DGS2 series observations, observation_start and JSON date/value fields.
- [Snowflake Cortex REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api): `/api/v2/cortex/v1/chat/completions`, PAT authentication, JSON-schema output and non-streaming `choices[].message.content` responses. The implementation uses Node's built-in fetch, not a Google SDK.
- [Snowflake PAT authentication](https://docs.snowflake.com/en/user-guide/programmatic-access-tokens): token setup and account authentication policy requirements.
- [Cortex Search queries](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/query-cortex-search-service): the database/schema/service REST query path, selected columns and `results` rows. Hedgehog defines an index contract of `TITLE`, `URL`, `TEXT` for source-backed summaries.
- [Cortex Search creation](https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search): provisioning and maintaining the optional reporting index. This is not an automatic open-web search integration.
- [Tiger Data service setup](https://www.tigerdata.com/docs/get-started/quickstart/create-service): PostgreSQL service with TimescaleDB for the application's existing `pg` connection.
- [ElevenLabs official SDK](https://github.com/elevenlabs/elevenlabs-js) and [speech conversion API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert): convert, model and MP3 output.

Snowflake contracts were checked against official documentation during migration. Unit tests mock the documented response shapes; live Snowflake requests remain unverified without account credentials. Yahoo history loading has worked locally, while Kalshi connections have reset in this environment. Do not treat mocks or successful compilation as proof of live provider compatibility.
