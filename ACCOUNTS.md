# User accounts

Hedgehog supports email/password accounts alongside its existing guest portfolios. Accounts
need PostgreSQL; Snowflake, Kalshi, FRED and ElevenLabs credentials are not needed to test
registration, sign-in or holdings storage. Brokerage connections are a separate future feature.

## Start and test

Run `docker compose up --build -d`, then open http://localhost:3000. The backend automatically
applies `003_accounts.sql` on startup. Existing portfolios remain available through their
original guest cookies. Keep the database volume to retain users and portfolios between restarts.
For a public HTTPS deployment, set `COOKIE_SECURE=true` in `.env` and restart the backend.

1. **Save a guest portfolio.** Add `AAPL` with a value of `1000` and click **Map my exposure**.
   These are manually entered test holdings, not fetched market data. Open **Create account**.
2. **Create an account.** Enter a name, email and matching 15–128-character passwords. Leave
   **Save my guest portfolio to this account** checked. The holdings page should still show
   AAPL. Only already-saved holdings transfer; unsaved form edits do not.
3. **Check persistence.** Reload the page. Open a private browser window, click **Sign in**,
   and use the same credentials. Both windows should show the same saved portfolio.
   Emails are trimmed and case-insensitive; passwords are not trimmed.
4. **Check account separation.** Sign out in the private window and create a second account
   with a different email. Its portfolio should be empty. Save MSFT there, then reload the
   first window; it should still show AAPL.
5. **Check sign-out.** Open **Account → Sign out**. The screen switches to sign-in, and guest
   holdings start empty. Signing back in restores the account portfolio.
6. **Check password changes.** Sign in to the first account in both windows. In one, open
   **Account**, enter the current password and a different new password twice. The other
   session should require sign-in when focused, reloaded, or used for an API request. The old
   password should fail and the new password should work. The changing session stays signed in.
7. **Check session controls.** Sign in to the same account in both windows again. Choose
   **Sign out other sessions** in one. That window stays signed in; the other loses access.
8. **Check errors.** Try mismatched confirmation, a short password, invalid email, duplicate
   email and incorrect credentials. Errors should appear without saving a partial account or
   changing holdings. More than ten authentication attempts for one normalized email in fifteen
   minutes returns HTTP 429 with `Retry-After`; use a disposable test email for this check.
9. **Check a fresh account without import.** Save guest holdings, create another account with
   the import checkbox cleared, and confirm that the account starts empty. Signing in to an
   existing account also never merges guest holdings. Signing out starts a fresh guest session.
10. **Check account switching between tabs.** Use two tabs in the same browser. Sign out in
    one, then sign in to a different account. The other tab updates through a broadcast or on
    focus. Outdated requests are rejected rather than writing into the new account.

The account page shows the name, email, join date and password/session controls. Clearing a
signed-in portfolio removes the account's saved holdings across devices; it does not delete
the account. Refresh the other device to see holdings edits.

## API

All routes are under `/api` through the frontend proxy. The internal Express server uses the
paths below. Response contracts live in `shared/types.ts`; every response includes `asOf`.

| Method and path | Request / behavior |
| --- | --- |
| `GET /auth/session` | Returns public user details or `user: null`, `sessionKey`, `expiresAt`, `asOf` |
| `POST /auth/signup` | `{name, email, password, saveGuestHoldings}`; creates account and session |
| `POST /auth/signin` | `{email, password}`; opens the saved account portfolio |
| `POST /auth/signout` | `{}`; revokes current session and starts a fresh guest session |
| `POST /auth/password` | `{currentPassword, newPassword}`; changes password and replaces all sessions with a new current session |
| `POST /auth/signout-others` | `{}`; revokes all sessions except the current one |

For direct API testing, first GET `/auth/session` and retain its cookies and `sessionKey`.
Every POST requires `Content-Type: application/json`, `X-Hedgehog-Request: 1`, and
`X-Hedgehog-Session: <sessionKey>`, including the existing `/holdings` endpoint. Adopt the new
cookies and session key returned by sign-in, registration, password change or sign-out.
The session key is not a bearer credential. Authentication requires the HttpOnly cookie.
Client-supplied user IDs cannot select another portfolio.

## Implementation and limits

- Node's asynchronous scrypt hashes passwords with a random salt and parameters N=131072,
  r=8, p=1. At most two expensive hash operations run at a time.
- Sessions use random 256-bit tokens; PostgreSQL stores SHA-256 digests. Cookies are HttpOnly,
  SameSite=Lax and host-only, with a 30-day absolute lifetime. `COOKIE_SECURE=true` enables
  Secure cookies for HTTPS.
- Custom request headers, JSON-only writes, disabled cross-origin access and fetch metadata
  checks protect mutations. The session key also prevents stale-tab writes after account changes.
- Private responses and briefing audio use `Cache-Control: no-store`. Account changes remount
  the portfolio screens so cached component state cannot carry into another account.
- Account portfolios use `user:<uuid>` owners in the existing holdings/briefings tables. Guest
  cookie parsing only accepts plain UUIDs; it cannot address that namespace. Registration
  transfers a saved guest portfolio transactionally when requested.
- Rate limits and sessions live in PostgreSQL. Expired rows are removed hourly.
- Email verification, forgotten-password email recovery, social login, MFA, profile editing
  and account deletion are not included. Keep the password; there is currently no self-service
  recovery if it is forgotten. Provider decisions are recorded in `questions.txt`.

Password hashing follows [OWASP's scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Request protection follows [OWASP's guidance for custom headers in API applications](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi).

## Validation in this workspace

- Production TypeScript checks passed for backend and frontend using temporary configurations
  that excluded tests whose Vitest dependency was unavailable. Project lint settings were unchanged.
- `npm run build -w web` passed, including optimized compilation and static page generation.
- All 20 account regression cases and both screen-render tests passed using a temporary Node
  test adapter. The committed tests use Vitest and run normally with a complete `npm ci`.
- The actual SQL migrations and Express handlers passed an isolated PostgreSQL 17 WASM smoke
  test using an already-cached PGlite tool outside this repository. It covered two accounts,
  guest transfer, cross-device holdings, CSRF, stale sessions, expiry, password changes,
  session revocation and rate limiting. TimescaleDB-specific hypertable setup was excluded
  from this temporary test database; no application dependency was added.
- `npm run check:core` passed. Full `npm test`, workspace lint and the backend build command remain blocked by missing
  Vitest packages: network installation fails with `EAI_AGAIN`, and those packages are not
  cached. Docker and an interactive browser test could not run because this environment
  denies Docker-socket access and local network listeners.
