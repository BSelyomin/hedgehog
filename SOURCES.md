# API contracts consulted

- [Kalshi open events and nested markets](https://docs.kalshi.com/api-reference/events/get-events): public host, cursor, status, nested markets, dollar quote fields and fixed-point activity/depth fields.
- [Kalshi market candlesticks](https://docs.kalshi.com/api-reference/market/get-market-candlesticks): series/ticker path, start/end Unix seconds, one-minute resolution, yes_bid/yes_ask close_dollars.
- [Kalshi settled markets](https://docs.kalshi.com/api-reference/market/get-markets): status filter and pagination.
- [Kalshi historical candlesticks](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks): older-history fallback.
- [Yahoo Finance SDK source and documentation](https://github.com/gadicc/yahoo-finance2): constructor, chart and assetProfile modules. Chart quote objects expose date and close; the library is unofficial.
- [FRED observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html): DGS2 series observations, observation_start and JSON date/value fields.
- [Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search) and [official SDK](https://github.com/googleapis/js-genai): grounded content and source metadata. The implementation uses the generateContent API available in the selected SDK major, subject to installed-version verification.
- [ElevenLabs official SDK](https://github.com/elevenlabs/elevenlabs-js) and [speech conversion API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert): convert, model and MP3 output.

Documentation was inspected; the shell could not call live upstream APIs. Do not treat code preparation as verified provider responses. Current docs may show newer SDK majors than the conservative package ranges used by this build; dependency installation and strict checking remain required.
