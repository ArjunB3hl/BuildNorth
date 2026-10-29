# Mac browser sign-in (local test only)

The Mac test app hosts Rhythm in a persistent `WKWebsiteDataStore`. The website can sign in with a Clerk email code
or password. Sign-out uses Clerk's session sign-out; it does not erase all WebKit website data or other accounts.

The experimental browser flow is disabled unless the backend has `MAC_BROWSER_SIGN_IN_ENABLED=true` and a
server-side `CLERK_SECRET_KEY`. The app generates a fresh 256-bit proof in the embedded page and sends only its
SHA-256 challenge to the server. The server returns an opaque, random request code. The Mac bridge opens only the
configured Rhythm origin, with the code in the URL fragment; the page removes it from the address bar and keeps it
in that browser tab's session storage. The signed-in browser explicitly approves a request using a verified Clerk
session. The server atomically consumes the request only when the Mac presents its matching proof, and obtains a
60-second, single-use Clerk sign-in ticket server-side. The ticket travels in the HTTPS response body and is
consumed by Clerk's `signIn.ticket()` in the original embedded page. It is never placed in a callback URL.

Pending handoffs expire after three minutes. Cancel makes a handoff unusable. Quitting the app loses the proof;
the user must start again. A Clerk request failure after the server claims a handoff is treated as an unknown
outcome and cannot be retried; start a new request. A browser window closed without pressing Cancel remains pending
until expiry. User identity comes only from the server-verified browser session, never from the request body.

## Before deployment

Do not enable this feature yet. Distributed rate limiting and a code-level security review are in place;
the deployment gates and remaining live verification are described below.

The backend requires migration `0014`, a valid server-only Clerk secret for the same Clerk instance as the website,
the feature flag, and production HTTPS. The matching web build and Mac build must be deployed together. Do not
embed the secret in the Mac app or web bundle. Avoid logging request bodies, URL fragments, proofs, codes or Clerk
tickets. OAuth sessions must not be passed to the app via URLs or by copying browser cookies. A rollback disables
the flag and redeploys the previous website and Mac app; expire or delete only the transient handoff table after
all pending requests have expired. Existing Clerk sessions and application records are independent of this table.

The local-only Mac build uses a distinct bundle identifier and `RHYTHM_AUTH_TEST` to load `http://localhost:8089`.
Never ship that test build. Production builds omit this flag and load the HTTPS website.

## Security review and staged deployment (2026-10-29)

The handoff uses a random 256-bit code and a separate 256-bit proof, a three-minute expiry, atomic single-use
claiming, a 60-second Clerk ticket and a native bridge restricted to the configured website origin and main
frame. The backend verifies the Clerk token and checks that its user and session match the account displayed
at approval; the client assertions never establish identity. If the app restarts, its in-memory proof is lost
and the user must start again. An unknown Clerk response is not retried. An attacker with the browser code
but without the app's proof cannot redeem it. An attacker controlling the trusted website, backend, browser
session, or Clerk account is outside that guarantee; keep these services and their dependencies secured.

Migration `0015` adds atomic database-backed fixed-window rate limits shared by all API instances. Start is
limited per client and globally; approval is also limited per verified user; redemption and cancellation are
limited per client and globally; ticket issuance has additional global and per-user limits. A database error
fails closed. These are fixed windows, so bursts spanning a boundary can approach twice the per-window limit.
Synchronize server clocks and monitor database capacity. Expired counters are periodically removed. HTTP 429
includes `Retry-After`; monitor 429/503 rates, handoff completion, Clerk errors and database health without
logging request bodies, tokens, proof, codes, URL fragments, or personal identifiers.

**Deployment gate:** client attribution requires exactly one valid public `CF-Connecting-IP`, and the direct
socket peer must match `MAC_SIGN_IN_TRUSTED_PROXY_CIDRS`. An absent or malformed header, missing allowlist,
untrusted socket peer, and wildcard networks fail closed. Do not enable Uvicorn proxy-header rewriting: this
check needs the actual socket peer. Render's public ingress documents the header, but web services also accept
private-network requests which can forge it. Render must confirm a stable ingress boundary that excludes those
callers before setting the allowlist. Observed proxy addresses, all private ranges and outbound IP ranges are
not such a guarantee. Validate both distinct networks, forged and malformed headers, private-network bypass,
and same-network users in staging. If the boundary cannot be verified, keep the feature disabled and use a
verified edge limiter or isolated ingress architecture instead.
Per-user and global limits do not replace this gate. Run an independent security review and repeat the two-account
and interrupted-handoff tests in the deployment environment before enabling. Rate limiting is not a complete defense against distributed abuse.

Deployment order: back up the SQL database and run migrations `0014` and `0015` using the normal migration
procedure; deploy the backend with `MAC_BROWSER_SIGN_IN_ENABLED=false`; deploy the matching HTTPS website;
install a production-configured Mac candidate; verify the same Clerk instance, authorized website origins and
trusted proxy behavior in staging. Then enable the flag and smoke-test with a consenting test account. The
website and backend must be updated together because approval now asserts the displayed user and session.
Do not put `CLERK_SECRET_KEY` in a client bundle. Keep email-code sign-in available as a fallback.

Rollback: set the feature flag to false and redeploy the backend; restore the previous compatible website and
Mac build if necessary. Leave existing sessions and SQL data untouched. Wait for handoffs to expire; retain the
new migration tables until the normal database rollback procedure has been reviewed. Disabling the flag does
not revoke sessions already created in Clerk. Never roll back the migration while newer instances still run.
The alternate local test flag `RHYTHM_AUTH_TEST_ALT` also loads localhost and must not be used for release builds.

Each validated attempt consumes independently committed global and client counters; operations on a valid handoff
also have per-challenge limits, and approvals and ticket issuance use the verified Clerk user. Counters live in
SQL and are shared across workers. The challenge, proof, verified identity, expiry and single-use claim enforce
security; a network address never binds or identifies the user. Source addresses may legitimately differ between
the app and the approving browser.

## Verification record

A local ad-hoc packaged WebKit test app completed a real Clerk browser-ticket sign-in and reached its local
profile; email-code sign-in, reopening a signed-in app, and sign-out across restart were previously verified.
A separate test app restarted while an unapproved browser handoff was pending and returned to sign-in.
Automated tests cover cancellation, expiry, replay, wrong proof, account/session mismatch, concurrent redemption,
unknown Clerk outcomes and rate limits. A disposable PostgreSQL instance verified shared counter concurrency and
migrations. A subsequent local test signed out of the first account and completed a browser handoff for a distinct
second Clerk user; the app displayed the second user's profile and the matching handoff was consumed. The localhost
test environment and ad-hoc packages are not production artifacts.
