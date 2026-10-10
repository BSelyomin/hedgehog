# SnapTrade brokerage integration

Hedgehog links brokerages through SnapTrade's hosted Connection Portal with **read-only permissions**. Sign in, open **Brokerages**, connect, then select the accounts to include in your portfolio. Manual entries and `symbol,valueUsd` CSV imports remain available under Add holdings. They are stored separately and added to selected brokerage positions; remove overlapping manual entries to avoid counting them twice.

## Configure sandbox

1. Create a SnapTrade developer account and obtain **commercial test API keys**. Personal keys cannot register separate Hedgehog users. SnapTrade's simulated `SANDBOX` brokerage is available on commercial test keys; it is unavailable on commercial production keys. See the [sandbox guide](https://docs.snaptrade.com/docs/sandbox) and [getting started](https://docs.snaptrade.com/docs/getting-started).
2. Copy `.env.example` to `.env` if you have not done so. Keep existing database settings. Set the following privately:

   ```dotenv
   SNAPTRADE_CLIENT_ID=<commercial test client ID>
   SNAPTRADE_CONSUMER_KEY=<commercial test consumer key>
   SNAPTRADE_ENCRYPTION_KEY=<32 random bytes encoded as base64>
   SNAPTRADE_MODE=sandbox
   APP_URL=http://localhost:3000
   ```

   Generate the encryption key using `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Store the output privately in `.env`. Keep this key with your database backup: replacing it makes existing brokerage credentials unreadable. This command intentionally prints the newly generated key; application logs never print credentials.
3. Run `docker compose up --build` and open `http://localhost:3000`. The backend automatically applies `004_snaptrade.sql`. For an existing Docker deployment, restart/recreate the backend so it receives the new environment variables. For local development, run migrations with `npm run migrate`, then `npm run dev` as described in README.
4. Create/sign into a Hedgehog account, select **Brokerages → Connect sandbox account**. Sandbox mode forces SnapTrade's `SANDBOX` broker and read-only permissions. Choose the successful self-directed scenario in the hosted portal. On return, the page syncs accounts; select an account's **Include supported positions in my portfolio** checkbox. Initial synchronization may take time: retry **Sync accounts** if accounts or positions are pending.

Without valid configuration the connector is visibly disabled; manual and CSV portfolios still work. Sandbox requires real SnapTrade test credentials. Hedgehog does not fabricate a provider login or populate simulated positions locally. Portfolio screens and voice briefings label imported sandbox holdings as simulated.

## Test checklist

- Save a manual holding and import a CSV. Connect a sandbox brokerage and verify these entries remain under Add holdings.
- Confirm new connected accounts are unchecked. Include one, open Overview, and verify supported holdings appear alongside manual holdings with the sandbox banner.
- Inspect quantity, price, currency, exclusion reasons, and source timestamps on Brokerages. Values are **calculated from quantity × last known provider price**, rounded once to cents. Cost basis and account totals are never used as substitutes.
- Clear the manual portfolio; connected holdings should remain. Uncheck a connected account to remove its contribution. Disconnect removes that connection's imported data and leaves manual holdings intact.
- Try sandbox cash-only and no-account scenarios. Cash-only accounts contribute no securities. Missing holdings, unsupported instruments and initial sync pending must not create invented values.
- Try invalid-credentials/account-locked/rate-limit sandbox scenarios. Errors should appear without secrets. Disabled connections offer Reconnect and are excluded from exposure until recovered.
- Sign in as a second Hedgehog user: the first user's connections, positions and account selections must not appear. Sign out and verify guest mode offers manual/CSV input but requires sign-in for brokerage linking.
- Switch to `live` with appropriate commercial credentials and restart: sandbox connections do not appear or contribute. New live accounts also start unchecked. Do not test live linking with credentials that lack the required SnapTrade production access.

## Live mode and storage

Set `SNAPTRADE_MODE=live`, production commercial API keys, and `APP_URL=https://your-frontend-origin` on the backend. `APP_URL` must be an origin without a path/query/fragment; plain HTTP is allowed only on localhost/127.0.0.1. Production deployment also requires the existing HTTPS and secure-cookie setup. Live linking opens SnapTrade's broker picker. Robinhood and other institutions depend on your SnapTrade coverage and account eligibility; verify [supported institutions](https://support.snaptrade.com/en/articles/5120630-supported-brokerages).

Brokerage credentials are AES-256-GCM encrypted in PostgreSQL, bound to the user and mode. The consumer key/encryption key remain server-side. Account numbers are masked before storage. SnapTrade accounts and cached positions are scoped to the authenticated Hedgehog user; client-supplied user IDs are ignored. New accounts require explicit selection. Disconnect tombstones prevent SnapTrade's asynchronous deletion from bringing deleted accounts back on subsequent syncs.

Only long US-listed stocks, ETFs and ADRs with verified listing/currency, positive quantities and prices are included. Cash, shorts, options, crypto, foreign listings and other instruments are excluded with an explanation. Duplicate stable institution account IDs across connections are excluded until the duplicate connection is disconnected. If listing metadata is missing, Hedgehog excludes the position rather than guessing a price-history ticker.

**Sync accounts** and the hourly job retrieve SnapTrade's cached data; they do not call the chargeable refresh-holdings endpoint. Last checked is distinct from the brokerage's source timestamp. Per-account failures retain the prior snapshot for inspection but exclude it from exposure until a successful sync. Whole account-list failures preserve the previous snapshot and its original timestamp. Provider refresh frequency depends on brokerage and plan. See [positions](https://docs.snaptrade.com/reference/Account%20Information/AccountInformation_getAllAccountPositions).

## API and implementation

Authenticated, session-protected endpoints:

- `GET /brokerages`: configuration, current mode, cached connections/accounts/positions and timestamps.
- `POST /brokerages/connect`: create a hosted read-only portal URL; optional owned `reconnect` ID.
- `POST /brokerages/sync`: retrieve provider data and persist validated snapshots.
- `POST /brokerages/accounts/:id` with `{ "included": true|false }`: select an owned account.
- `POST /brokerages/connections/:id/disconnect`: disconnect an owned connection.

API response types are in `shared/types.ts`. Requests use Node's built-in fetch/crypto and SnapTrade's documented [HMAC signing](https://docs.snaptrade.com/docs/request-signatures), with a timeout, read-request retries, and per-user portal/sync limits. No dependency was added. The client has an explicit endpoint allowlist with no trading operations. It never returns provider user secrets.

Account discovery currently uses the documented investment-account `GET /accounts` schema. SnapTrade has deprecated it in favor of `GET /accounts/all`; the new primary reference was inaccessible during implementation, so its response shape was not guessed. Review and migrate this adapter after verifying the current primary schema. Positions use the current `/accounts/{id}/positions/all` endpoint. Outstanding provider setup/verification items are recorded in `questions.txt`.

## Validation performed

Production TypeScript checks, frontend production build, focused SnapTrade/account tests, and a PostgreSQL-engine smoke test with mocked SnapTrade responses cover signing, encryption, owner isolation, import selection, aggregation, unsupported positions, manual clearing, mode isolation and disconnect reconciliation. The smoke test used the locally cached PGlite tool outside the repository, with only the Timescale extension setup omitted; SQL migrations and service queries were executed unchanged. Native Vitest and full lint require the missing development dependencies in this environment. No real SnapTrade session was exercised: complete the sandbox checklist using your commercial test credentials before relying on the integration.

## Data format conversion and backend errors

The frontend now forwards `/api/*` through a server route that reads `API_INTERNAL_URL` at request time (default `http://127.0.0.1:4000`; Docker sets `http://backend:4000`). Connection failures and non-JSON upstream responses become JSON errors with `asOf: null`; provider/server HTML and plain-text bodies are not exposed. The browser API helper also handles non-JSON responses defensively. Backend connectivity must still be restored if the API process is unavailable; this does not manufacture successful data.

Current positions and historical trades have different source schemas:

| SnapTrade source | Hedgehog field | Conversion |
| --- | --- | --- |
| Position `instrument.raw_symbol` | Holding `symbol` | Verified US listing/ticker; unsupported listings remain excluded |
| Position decimal-string `units` and `price` | Holding `valueUsd` | Exact quantity × price, rounded once to USD cents |
| Position `currency` and instrument currency | Position currency | Require USD before entering exposure; no assumed currency or FX conversion |
| Position `data_freshness.as_of` | Position `asOf` | Valid source timestamp; missing timestamps exclude the account from exposure |
| Activity `symbol.symbol` | Activity `symbol` | Preserve the provider's formatted symbol, or null for cash activity |
| Activity numeric `units`, `price`, `amount`, `fee` | `quantity`, `price`, `amount`, `fee` | Preserve finite numbers, signed cash flows, zero fees and nulls |
| Activity `currency.code` | Activity `currency` | Preserve the reported code; never default missing values to USD |
| Activity `trade_date`, `settlement_date` | `tradeDate`, `settlementDate` | Source dates in ISO form; missing dates remain null |

`convertSnapTradePositions` and `positionsToHoldings` live in `server/src/brokerages/positions.ts`; sync validates the converted holding values before persisting the snapshot. `convertSnapTradeActivities` lives in `server/src/brokerages/activities.ts`. A trade's amount is a historical cash flow, not the current value of a holding, so activity records never alter holdings or exposure.

`GET /brokerages/accounts/:id/activities?offset=0&limit=100` retrieves a page of an authenticated user's historical records. Its shared response type includes pagination, mode, `source: 'SnapTrade'`, and `fetchedAt`. `asOf` is null because the [activities response](https://docs.snaptrade.com/reference/Account%20Information/AccountInformation_getAccountActivities) does not supply a brokerage freshness timestamp. This is distinct from the [current positions response](https://docs.snaptrade.com/reference/Account%20Information/AccountInformation_getAllAccountPositions).

To inspect the conversion, connect and sync a sandbox account, then click **View trades and activity** beneath that account on Brokerages. Check quantities, currencies, buy/sell cash-flow signs, null handling and Previous/Next pagination. Cash-only and no-transactions scenarios can legitimately have no activity. Read-only history access adds no order-placement operations.

Regression checks cover the exact reported `Internal Server Error` JSON failure, offline backend, valid JSON errors, auth cookie forwarding, audio passthrough, provider-format fixtures, exact USD holding conversion, paginated signed activity requests and foreign-account rejection.
