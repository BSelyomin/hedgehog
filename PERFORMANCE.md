# Request profiling — 2026-10-10

**Update:** The baseline below predates the dedicated Moves query path. Moves now skips exposure/trust/settled-history work and the freshness scan. See the follow-up at the end and DEPLOY.md for actual browser timing instructions.

Controlled profiling identifies repeated settled-market reads as the largest measured cost. The existing AI cache is being hit, but it does not avoid the analytics work needed for Exposure, Moves, Calendar, and Event pages.

## What ran

- `npm run start -w web` could not bind port 3000 (`EPERM`). Loopback IPv4/IPv6 listeners were also denied by the workspace. The normal backend startup could not reach its configured database. These are environment restrictions, not measured deployment latency.
- Ran the built production Next.js request handler in-process, including its real `/api/[...path]` proxy, connected through an in-process transport to the real Express app. No production application files were changed for profiling.
- Ran all application migrations against PostgreSQL 17 in the already-available PGlite test engine, omitting TimescaleDB extension/hypertable setup. SQL was actually executed, not mocked.
- Used a synthetic signed-in account with 10 holdings, 200 linked events, 400 markets, 38,400 odds snapshots, 127,260 price rows, 25,000 settled markets, and a cached briefing containing a 1 MiB audio payload. Brokerage configuration was synthetic; the brokerage-holdings query returned zero rows.
- Issued a first request and eight repeated requests per endpoint. Cached-briefing reads were explicitly asserted to contain saved text and an audio URL. No external provider calls were made.
- These results exclude real network latency, native pg pool contention, background jobs, TimescaleDB planning, browser JavaScript hydration, and browser rendering. PGlite serializes SQL execution; overlapping query timings include that queue. Do not sum overlapping SQL timings or treat these values as production SLAs.
- Raw observations and query plans: [performance-profile.json](./performance-profile.json). Temporary harness: `/tmp/hedgehog-profile/profile.mjs` (uses the temporary PGlite installation, no new repository dependency).

## Measured request timings

Times include the production Next handler, API proxy and Express handler with the in-process database. Warm p50 uses the upper middle observation of eight repeated requests. First-request times include lazy module/setup costs.

| Request | First request (ms) | Warm p50 (ms) | SQL calls each time | Response body bytes |
| --- | ---: | ---: | ---: | ---: |
| `/` | 90.3 | 1.4 | 0 | 5,588 |
| `/api/auth/session` | 21.3 | 3.3 | 1 | 297 |
| `/api/holdings` | 4.5 | 5.0 | 3 | 748 |
| `/api/briefing` | 13.2 | 11.5 | 4 | 209 |
| `/api/exposure` | 217.5 | 175.9 | 8 | 618,092 |
| `/api/moves` | 180.5 | 178.4 | 13 | 2,114 |
| `/api/calendar?days=14` | 164.3 | 167.1 | 8 | 489,624 |
| `/api/event/E1` | 155.3 | 159.6 | 10 | 15,180 |
| `/api/track-record` | 141.3 | 146.1 | 2 | 1,792 |

One simulated initial Overview load—session request, then Exposure and cached briefing in parallel—took **182.5 ms** and made **13 SQL calls**. This excludes HTML/JavaScript download and rendering.

## Findings, in priority order

### 1. Settled-market history is fetched and recalculated on every analytics request

`server/src/services/track-record.ts:10` reads every settled market and calculates category statistics in JavaScript. `server/src/services/exposure.ts:51` invokes it for each Exposure request. Moves, Calendar, Event and Earnings call Exposure, so all of them inherit this work. Event requests rebuild the entire portfolio exposure before selecting one event.

The isolated full settled-history query returned 25,000 rows in a warm p50 of **129.8 ms** through the embedded engine. PostgreSQL EXPLAIN execution alone was **9.8 ms**; the rest includes result construction/transport/decoding overhead in this embedded setup, not just the SQL scan. The result size and repeated work matter as well as indexes.

For a controlled experiment, the harness reused the same settled rows in memory without changing production code; all application calibration calculations still ran. Requests improved as follows:

| Request | Existing path (ms) | Reuse settled rows (ms) |
| --- | ---: | ---: |
| `/api/exposure` | 175.9 | 39.4 |
| `/api/moves` | 178.4 | 49.7 |
| `/api/event/E1` | 159.6 | 32.5 |

**Recommended fix:** precompute/cache the category aggregates when settled data changes, rather than loading every settled row on each request. Use shared public aggregates across users. Scope Event queries to the requested event, and give Moves a lighter data path that does not build trust scores and the full exposure response just to obtain linked markets.

### 2. The Moves freshness query scans the entire prices table

`server/src/services/moves.ts:86` uses `WHERE ts::date=$1::date`. EXPLAIN showed a sequential scan of all 127,260 price rows, discarding 127,159 of them. Casting the indexed timestamp prevents the ordinary timestamp range index from being used here.

The existing query took **14.51 ms** in EXPLAIN ANALYZE. A read-only comparison using a timestamp range used the existing index and took **0.48 ms**. No schema/index change was needed for the comparison.

**Recommended fix:** use explicit UTC start/end bounds and restrict freshness to the relevant symbols. This also avoids relying on the database session timezone when assigning a daily date. Production TimescaleDB plans still need confirmation.

### 3. A cached briefing read also fetches the audio blob

`server/src/jobs/briefing.ts:58` calls `readAI`, which selects the complete JSON value in `server/src/services/ai-cache.ts`. That JSON contains base64 audio even for `GET /briefing`, where only text, metadata and an audio URL are returned. Authentication and both manual/brokerage holding reads happen before the cache lookup.

In this fixture, the stored JSON was **1,398,219 bytes**, while its non-audio value was **104 bytes**. Reading the full cached value took **6.91 ms**; selecting `value - 'audio'` took **1.46 ms**. This is database-to-backend waste; the browser does not receive the audio until it requests playback.

**Recommended fix:** separate cached metadata/text from audio retrieval (and retain an audio-available flag). Fetch the blob only for the audio endpoint. A SQL projection reduces transfer immediately; separate blob storage avoids loading/decompressing it at all during metadata reads.

### 4. Returning to a screen repeats the request instead of showing saved screen data

`web/app/common.tsx:18` stores data only inside the mounted component; line 38 clears it on a new request path. Screens unmount during navigation. The client fetch and server response both disable HTTP caching. Therefore repeat visits run the same backend work, despite unchanged AI inputs. Initial screen mounting also waits for `/auth/session` (`web/app/hedgehog.tsx:63`).

**Recommended fix:** retain account/session-scoped screen results, display the last result while revalidating, and invalidate safely on account/holdings changes. Keep dynamic market-data revisions separate from AI cache keys, so refreshing odds does not regenerate AI text/audio. Do not enable shared public caching for private portfolio responses.

### 5. Response size and repeated complete-portfolio work add costs

The 200-event fixture returned **618,092 bytes** for Exposure and **489,624 bytes** for Calendar. `web/lib/api-proxy.ts:60` parses and reserializes the full JSON. The exposure UI also creates a holdings-by-events table; browser rendering of that table was not measured in this sandbox.

**Recommended fix:** page/filter the event views, avoid sending duplicate large link structures where unnecessary, and keep error validation while reducing redundant JSON processing in the proxy. Address the measured database costs first.

## Additional risks found in code, not reproduced as measured bottlenecks

- `getHoldings` reads manual and brokerage holdings sequentially. Independent reads can run concurrently to remove one network round trip.
- Every authenticated API request checks the session in the database. The initial session check precedes screen requests. These checks are important for account isolation; optimize batching or carefully scoped reuse rather than bypassing authentication.
- `runJob` holds one connection from the main pool for an advisory lock throughout a job, including external provider waits (`server/src/jobs/scheduler.ts:11`). Multiple startup/scheduled jobs can leave fewer connections for page requests. This experiment did not run the scheduler or model pool contention.
- Browser focus and visibility handlers can both trigger session refresh. This was not exercised by the in-process frontend test.

## Conclusion

Prioritize cached track-record aggregates, the Moves date-range query, and briefing metadata-only reads. Then retain safe per-account screen results and reduce whole-portfolio work for individual pages. The measured local hot paths were below a quarter-second in this fixture; multi-second delays on the live app require production request/SQL/pool-wait timings to distinguish database/network contention from browser work.

## Follow-up: dedicated Moves path implemented

The signed-in Moves path now makes 7 SQL calls instead of 13. The sequential
stages are session lookup → concurrent holdings reads → concurrent price,
measurement and tag reads → odds lookup. The price query resolves the default
session and reads its closes together; freshness is taken from those same rows.
Only markets crossing the supported 3-point threshold are returned by the odds
query. Direct/Measured/Related evidence and exact move reconciliation are preserved.

A controlled rerun using the same fixture added an artificial 150 ms delay to
every database call to model the effect of round trips. The old path's warm median
was 1,393 ms and the new path approximately 616 ms. Without injected delay, the new
path measured approximately 13 ms locally. These are synthetic comparisons, not
live browser measurements; the fixture had no qualifying odds moves in the chosen
historical window. Regression checks separately cover supported odds moves.

Actual browser requests now expose `Server-Timing` through the frontend proxy.
Session, holdings, prices, measurements, tags and odds durations include real
query waits; the header also gives backend duration and query count. Cumulative
SQL time sums overlapping calls and is not elapsed request time. Inspect this
header on the user's deployment before identifying any remaining bottleneck.

Raw follow-up results are saved in `moves-performance-profile.json`. No AI cache
policy was changed by this optimization, and no live provider calls were made.
