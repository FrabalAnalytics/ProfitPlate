# Authentication and first UI slice

For the subsequent Inventory workspace and its approved operating policies, see [Operational_Workflows.md](Operational_Workflows.md). The original authentication/setup implementation is documented below.

Implemented 27 October 2026 against the V0.1 database foundation. The user selected forest green, warm neutrals, and a clean operational layout. The visual identity is a first draft for review; the original engineering DOCX/design handoff remains unavailable. No website deployment is included in this slice.

## Included

- Email/password sign-up, confirmation/resend, sign-in, password recovery, password update, and sign-out.
- Verified-user organization setup through `profitplate_command('bootstrap', ...)` with a stable form request ID. Reload resumes the saved organization.
- Organization-specific workspace, business switching for existing memberships, read-only business settings, and a saved-data setup checklist.
- Responsive authentication/setup layouts and an initial workspace shell. No inventory quantities, balances, financial statistics, or fake charts.
- Error, unavailable-page, and request-loading states; labeled forms, keyboard focus feedback, password visibility controls, reduced-motion styling, and mobile navigation.

## Local review

From the repository root:

```powershell
cd web
npm run dev
```

Open `http://localhost:3000`. Use your own email to create an account, confirm it in the same browser, and create your business. The real app uses the existing hosted Supabase URL/public key from `.env.local`.

`APP_URL` controls the trusted origin of confirmation/recovery links, defaulting to `http://localhost:3000` in development. Keep the browser origin and `APP_URL` consistent: `localhost` and `127.0.0.1` have different cookies. Production requires an explicit HTTPS `APP_URL`, matching hosted Site URL and exact callback allowlist. Never derive email-link origins from Host/Forwarded headers.

Desktop/mobile preview images are produced by `npm run test:ui` under `.tooling/previews`. Preview businesses/accounts belong only to the disposable test fixture. Screenshots do not establish hosted email delivery or production acceptance.

## Security and session behavior

- `@supabase/ssr` creates a fresh server client per request. Application sessions use HttpOnly, SameSite=Lax cookies; production cookies are Secure. The diagnostic client has session persistence disabled and is not the UI's authentication client.
- Proxy uses `getSession` solely to transport/refresh tokens; it never trusts the embedded user or authorizes from that result. Each protected server page/action obtains the live account through `current_account()`: PostgREST verifies the JWT signature/expiry, and the function selects only `auth.uid()`'s own non-deleted/non-banned Auth record. Email confirmation and live membership checks still run. This avoids consuming the Auth `/user` rate limit on every page. Client instances and reads are deduplicated within each render/request, never shared across users or requests.
- Roles come from database memberships, not user metadata or a posted role/actor field. A foreign organization produces the same unavailable-page experience as any inaccessible page. Suspension denies the next server request with the same session cookies.
- No service-role key is used by application authentication or organization setup. Configuration rejects secret/service-role keys in the public-key slot. Supabase Data API/RLS remains the final database boundary.
- Server Actions provide Next.js Origin/Host checks and POST-based mutations. Inputs are independently validated; passwords and access/refresh tokens are never placed in query strings or returned in form state. Callbacks use standard one-time PKCE authorization codes; hosting request logs should redact callback query strings. Error messages exclude raw database/provider diagnostics. Successful auth redirects use fixed application destinations.
- Email confirmation/recovery uses PKCE. Codes are exchanged server-side, and callbacks use relative redirects to preserve the browser's origin. A strict destination allowlist prevents open redirects. A wrong-browser or reused code fails with a fresh-link screen. Recovery state is a short-lived HttpOnly user-bound navigation marker, not a replacement for verified authentication. Password changes still require a verified current session and Auth authorization.
- After a password reset, the recovery marker is removed and Supabase signs the user out. Ordinary sign-out uses local-session scope; it is not an application-wide revoke-all-sessions operation. If remote logout or expired-token refresh is rate limited, project-scoped session and PKCE cookies are explicitly removed so this browser can sign in again. This does not claim remote token revocation succeeded during an outage.
- React `cache()` deduplicates reads only within the render/request. There is no persistent cache of user identity, role, or membership. `connection()` prevents Auth's internal clock/randomness from running during static prerender. Protected segments deliberately opt out of instant-navigation validation while they block on live authorization. Root Suspense supplies a neutral loading shell.
- App pages use private/no-store and `Referrer-Policy: same-origin`. This preserves the Origin on native form POSTs while withholding referrers from other sites. The callback retains `no-referrer` to avoid forwarding authorization codes and never reflects an untrusted external destination. Server Action Origin checks remain enabled; `null` and wildcard origins are not allowed.

## Hosted configuration applied

A narrow declared-only configuration lives at `supabase/hosted-auth/supabase/config.toml`. It was previewed and applied through the authenticated CLI to project `ndvqzhvnwbemqmwdlckl`:

- Confirmation remains required (already enabled before this work).
- Minimum password length increased from 6 to 12.
- Secure password changes enabled.
- Exact `http://localhost:3000/auth/callback` and `http://127.0.0.1:3000/auth/callback` redirects allowed.
- Site URL remains `http://localhost:3000`; unrelated hosted resources/configuration were left unchanged.

Verify drift without changing configuration:

```powershell
npx supabase config diff --workdir supabase/hosted-auth --project-ref ndvqzhvnwbemqmwdlckl
```

Before deploying the app to a real domain, update the trusted origin and this narrow allowlist deliberately. Do not push the full development-stack configuration to change a few hosted Auth fields.

## Verification

```powershell
npm run lint
npm run build
npx playwright install chromium
npm run test:ui
```

The Playwright suite starts an isolated Auth/PostgREST protocol fixture on loopback and a dedicated Next.js server on port 3100. Auth identities, session tokens, delivery, and PKCE are emulated locally. Database queries and organization commands run against real PostgreSQL through PGlite with the foundation migration/RLS. The fixture is never imported into app code and neither loads `.env.local` nor contacts hosted Supabase. The Next.js test process receives explicit test URL/key/origin overrides.

Browser QA uses `.next-e2e` so it can run alongside the developer's `.next` server. Development assets allow exact IPv4 addresses owned by the computer, discovered at server startup. Restart the server after changing networks to refresh that allowlist. No Server Action cross-origin bypass is configured. Native form submission and rejection of different-origin POSTs have explicit regression coverage.

The follow-up rate-limit fix adds `20261027000200_current_account.sql`, deployed and permission-verified on the linked project. Auth passwords/settings and rate-limit thresholds were not changed. Browser coverage includes repeated login/logout while `/auth/v1/user` is throttled, throttled logout/refresh, clear password-throttling feedback, and recovery from a stable service-status screen. Normal navigation performs zero Auth `/user` reads in these tests. Database tests additionally enforce own-account isolation and banned/deleted-account exclusion.

The suite checks anonymous gates, forged cookies, invalid credentials/focus/password clearing, unverified identities, existing-owner resumption, new organization creation/reload, foreign-tenant denial, suspension, normal sign-out, confirmation browser binding, recovery/replay, open-redirect rejection, and responsive layouts. CI repeats lint/build/browser checks without hosted credentials. Real hosted email delivery and a complete signup-to-business walkthrough using the owner's actual email remain manual verification, not a claimed test result.

## Clock synchronization and session recovery

The recurring real-device refresh loop was traced to the Windows host clock being approximately 14,264 seconds ahead of the Auth service. Fresh Auth HTTP Date responses, the hosted database clock, Google HTTPS Date, and Cloudflare trace time agreed. Windows Time was disabled and configured as `NoSync`. With the user's explicit approval, its service was enabled in Manual mode and synchronization enabled against its existing configured peer; the time zone and account credentials were unchanged. A subsequent fresh HTTPS comparison measured zero seconds of difference. The native resync command reported unavailable time data before the background clock correction, so actual clock comparison, rather than the command's exit code alone, is the verification evidence.

`authClockStatus` compares local UTC to fresh HTTPS Date metadata. A known difference above two minutes blocks fresh login and refresh navigation with a specific clock screen. Only clock metadata is cached for 30 seconds, using monotonic elapsed time so a Windows clock correction is recognized immediately. The browser fixture disables the metadata cache to exercise clock changes deterministically. Unknown/unreachable clock data does not authorize anyone or bypass JWT verification; normal Auth/Data API checks remain in force. Expiry and signature checks are unchanged.

The service-status page includes **Start a fresh sign-in**, a same-origin Server Action that removes only this browser's project session/PKCE cookies without contacting the unavailable Auth endpoint. It does not change a password or business and does not claim remote revocation. Auth navigation preserves the current development loopback origin through validated redirects. Browser coverage includes a stale open form under four-hour clock drift, zero token requests while blocked, session cleanup, and successful sign-in after the simulated synchronization.

## Next UI increments

Location management is implemented. Workspace navigation, the welcome banner, and the location checklist row link to `/workspace/[organizationId]/locations`. Active business members can read locations; owners and admins can add and edit names/codes and deactivate/reactivate locations. New locations are active. Deactivation retains the record and its unique code. The overview counts only active locations from the database.

Every save rechecks the current authenticated membership and goes through the existing `profitplate_command` RPC with the user's Supabase client. Database tenant scope, owner/admin authorization, unique business codes, audit attribution, and request idempotency remain authoritative. No migration or additional hosted privileges are needed. Inputs are validated again on the server, codes are trimmed/uppercased, and duplicate-code/provider errors produce safe feedback. Identical retries retain their request key; changed submissions use a new random key. Browser randomness uses `crypto.getRandomValues` so the local HTTP phone preview is supported. Each form has unique field/help IDs, including when navigation retains an earlier form in a hidden segment. Pending saves disable submission and preserve entered values on errors.

Location browser coverage uses disposable fixtures and real PGlite/PostgreSQL command/RLS execution. It covers server validation, duplicate codes, persistence, edits, deactivation/reactivation, overview progress, read-only users, live permission loss on an already-open form, and foreign-location denial for an admin belonging to both businesses. Screenshots and overflow checks cover 375/768/1440px. The location workflow uses a separate test owner/business so other tests do not depend on it. Screenshots are saved as `.tooling/previews/locations-{width}.png` and `location-form-{width}.png`. Hosted changes using the user's real restaurant remain a manual walkthrough; test fixtures do not write hosted data.

Verification on 27 October 2026: production build and ESLint passed. All 20 existing authentication browser cases passed with the new navigation. All four location cases passed on a subsequent focused run after fixing the test to capture its edit destination from the link rather than reading the URL before navigation completed. The permission check confirms an open form cannot save after its admin is downgraded; restoring admin access permits editing again.

Review location management together, then add item/conversion management, team invitation acceptance/delivery, role management, and audit browsing. The item catalogue checklist row is still a status indicator. Invitation email dispatch and account deletion are not implemented in this slice. Business settings are currently read-only. Location search and pagination can be added for businesses with large location catalogues; the current list uses the hosted API's normal row limit.

Official references: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [password authentication](https://supabase.com/docs/guides/auth/passwords). Next.js implementation follows the installed `node_modules/next/dist/docs` guides for cookies, Server Actions, Cache Components authentication, and request-time rendering.
