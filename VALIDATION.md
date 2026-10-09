# Validation and phase status

## Current migration: Snowflake Cortex (2026-10-09)

Gemini has been replaced with Snowflake Cortex REST completions for series tagging and supplied
filing risk factors. Optional Cortex Search supplies source passages for summaries. No Snowflake
account credentials have been supplied, so live AI authentication, model availability and index
queries remain unverified. Tiger Data/PostgreSQL remains the application database.

The 45-test Vitest suite passes, including provider request/response contracts, configuration,
sanitized failures, malformed output, fixed tags, batch isolation, filing caching, retrieved
citations and the existing numeric guard. Tests use mocked Snowflake responses, not live calls.
The rebuilt images pass backend/frontend TypeScript checks, the core accuracy checks and the
Next.js production build. Migration `002_snowflake_tags.sql` applied successfully; a rolled-back
temporary-table check verified that legacy Gemini/manual tags retain their review flags and new
Snowflake tags are accepted. The rebuilt frontend and proxied database health endpoint return HTTP
200. The private `.env` stays ignored by Git. Docker now installs the committed lockfile with `npm ci`.

Yahoo history loading worked locally before this change. Kalshi connections reset from both Windows
and Docker. `npm ci` reports five dependency vulnerabilities in the current lockfile; this migration
does not upgrade unrelated dependencies or certify production security.

The original phase log below describes the earlier offline build environment. Its npm, Docker
and Git blockers are historical, not the current local setup. References to Gemini describe
the superseded provider; `DEPLOY.md` contains current credentials and integration instructions.

## Original phase log

Checked before creating app files: AGENTS.md, message.txt, hedgehog_math.py, the eleven-page Hack Knight build-plan PDF, and all seven design PNGs. Read the full text and inspected every design. Original inputs are preserved.

## Checks that passed

- `npm run check:core`: executable assertions cover valid/invalid dollar midpoints, missing quotes, reliable and unreliable ranges, Brier 0.25, calibration buckets including p=1 and weighted misses, trust edge cases and rescaling, missing-data trust, source URL filtering, AI numeric validation, fixed tag filtering, link downgrading, date alignment and cent-based move reconciliation.
- Strict TypeScript check of the frontend and shared types with a recovered cached TypeScript 5.9.3 compiler and cached React/Node type packages. This was a manual compiler invocation, not a successful npm installation or Next build.
- Server rendering smoke checks with recovered cached React/ReactDOM: all seven screen components render their initial states, display a heading, include no fabricated market data, and the shell includes the required footer. This is not browser interaction, responsive screenshot validation or a test of populated live screens.
- TypeScript syntax transpilation of app source files completed without syntax diagnostics. The final backend compiler attempt reports only missing SDK/math/scheduler dependencies; their APIs cannot be fully type-checked until installed.

Temporary recovered tools stayed in /tmp; they are not vendored into this repository.

## Checks blocked

- `npm install`: EAI_AGAIN for registry.npmjs.org in this shell. Retried with a writable cache and zero fetch retries; no dependency lockfile could be generated.
- `npm test`: Vitest unavailable. Known-answer synthetic regression tests are written but not executed. They must pass before using measured links in a live demo.
- `npm run lint` and `npm run build`: workspace TypeScript binaries unavailable through npm; Next and backend SDKs are not installed. The manual frontend check does not certify either build.
- Docker CLI: Docker Desktop WSL integration is unavailable. Compose images, migrations and service health checks have not run here.
- Live data: no configured DATABASE_URL or private API credentials. No honest three-market sample, ten-year-history count, reliable/unreliable live link, grounded Gemini summary or ElevenLabs playback can be demonstrated yet.
- Git: the supplied .git is not a functioning repository and is protected by the environment. No phase commits were created.

## Phase inventory

| Phase | Code prepared | Finish line still to verify |
| --- | --- | --- |
| 1 Foundation | Workspaces, migrations, Timescale hypertables, idempotent price upserts, five-minute/startup poller, scheduler | Installed dependencies, migrated database, populated ten-year series, three stored quote samples |
| 2 Matching | Response types, restricted Gemini tags, review/approve commands, human sector seed, holdings/session API, exposure and both views | Human sector table and tag review; five live tickers linked correctly |
| 3 Events/trust | Trust formula/edge tests, calendar, event distribution/history, grounded summaries with guards | SDK compatibility and live source-linked summaries/trust |
| 4 History/math | Math port, required Vitest tests, resumable settled backfill, category statistics, nightly reliable regressions | Regression tests first, then real category sample and hand-checkable live links |
| 5 Moves/earnings | Cent-reconciled move split, source-backed daily odds moves, normalized exclusive brackets, views | Real close history; free past report-date source remains unresolved |
| 6 Voice/portability | Exact template, numeric guard, official SDK MP3 cache, player, Docker/Compose, deploy guide | Voice credentials/audio validation and Docker execution; public deployment not performed |
| 7 Accuracy | Fail-closed empty states, no UI fixture data, NUMBERS.md and core guards | Full live data and browser audit |
| 8 Submission | README and cautious submission draft | Human editing, eligibility/track decisions, demo recording and publication |

Implementation proceeded sequentially through the planned code areas, but infrastructure-blocked finish lines were not treated as passed. Questions and assumptions are in questions.txt. Sector mappings are intentionally empty because the supplied instructions assign that judgment to a person. Automatic filing acquisition and optional AI briefing smoothing are not implemented. The two-panel design layout and tokens are used throughout; unavailable report histories and reminder functionality are not represented as working features.
