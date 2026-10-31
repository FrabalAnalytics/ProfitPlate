# ProfitPlate database foundation

Implementation baseline: 27 October 2026. Migration: `20261027000100_foundation.sql`.

The subsequent approved operational increment is described in [Operational_Workflows.md](Operational_Workflows.md). Migrations `20261027000300`–`20261027000500` add stock posting, explicit operational-manager appointments, period controls, recipes and sales-import safeguards. The foundation-only scope and historical verification below describe the original baseline.

Follow-up migration `20261027000200_current_account.sql` adds an authenticated-only, read-only own-account function. It accepts no identity argument, reads `auth.uid()`'s current Auth record, and excludes banned/deleted accounts. PostgREST verifies the caller's JWT before execution. This removes page-navigation dependence on Auth's rate-limited `/user` endpoint without duplicating the identity store. It is applied to the linked project; anonymous and service-role execution are denied.

This is a new V0.1 foundation based on the local closure addendum and master PRD, not a reconstruction of the missing original `001_foundation.sql`. The original engineering DOCX and `CODEX_START_HERE.md` were unavailable in the workspace and searched Downloads locations. These are engineering decisions implemented under the instruction to build the foundation, not production release sign-off.

## Scope and model

Verified Supabase Auth, organizations, memberships, invitations, locations, items, units, conversion history, audit, and retry-safe mutations. No stock, opening quantities, monetary amounts, procurement, recipes, POS consumption, billing, or AI tables are introduced. Timestamps use `timestamptz`; restaurant settings are fixed at NGN and Africa/Lagos for V0.1.

Auth owns identities and credentials. No duplicate password store exists. A separate profile table is deferred until application-owned profile fields are needed; authorization never trusts user-editable Auth metadata.

| Object | Rules |
| --- | --- |
| `organizations` | Tenant boundary; name, currency/timezone, timestamps |
| `organization_memberships` | Unique organization/user; role and active/suspended status; exactly one active owner per organization; at most one owned organization per user |
| `locations` | Organization-wide masters; trimmed uppercase code unique within organization, including inactive locations |
| `units_of_measure` | Immutable system `g`, `kg`, `ml`, `l`, `each`, `dozen`; dimension and exact reference factor |
| `items` | Tenant catalogue; unique canonical SKU/name, immutable UUID/tenant/base unit, activation state |
| `item_conversion_revisions` | Immutable mapping revisions targeting the item base unit; one-way retirement, one active mapping per item/source |
| `item_conversion_history` | Security-invoker read view preserving table RLS; factors returned as strings |
| `organization_invitations` | Admin-only recipient email/lifecycle; one pending invitation per organization/normalized email |
| `audit_events` | Append-only actor/action/target/request history with controlled before/after snapshots |
| `private.command_requests` | Scoped request keys, payload hashes, non-secret successful results; no raw payloads |
| `private.invitation_secrets` | Token hashes only |
| `private.invitation_deliveries` | Queue state, attempts, lease, sanitized error code; no token storage |

Child relationships enforce organization consistency through composite foreign keys. UUIDs identify records; they do not authorize access. Referential deletes use RESTRICT. Items/locations are deactivated, revisions retired, and audit records retained. Application users and the service-role API cannot directly mutate foundation tables.

SKU and item-name uniqueness use PostgreSQL lowercase comparison after trimming surrounding POSIX whitespace (including tabs/newlines), with no accent folding. The same database helper normalizes commands and checks stored values. An inactive item's current SKU stays reserved. SKU corrections preserve old values in audit; a permanent alias/reserved-history registry is outside V0.1. Location names need not be unique. Codes allow ASCII letters/digits/underscore/hyphen, start with a letter/digit, and have at most 32 characters. Changes to comparison rules require a collision review.

## Permissions

Every active member can read organization-wide shared locations, items, and conversion history. Location selection is context, not a permission boundary. Users can see their own active membership; team administrators can see all memberships and invitation emails in their organization. Global units contain no tenant data and are readable by authenticated users without membership.

| Role | Item/conversion edits | Location/org edits | Team administration | Audit |
| --- | --- | --- | --- | --- |
| owner | Yes | Yes | Yes; ownership transfer | Read/search |
| admin | Yes | Yes | Non-owner members; no self-edit | Read/search |
| inventory_manager | Yes | No | No | No |
| kitchen_lead | No | No | No | No |
| bar_lead | No | No | No | No |
| accountant | No | No | No | Read/search |
| viewer | No | No | No | No |

All tenant tables have RLS. Suspension checks live membership rows on each request rather than cached JWT roles. Department isolation and operational posting permissions are deferred.

## Transactional commands

Call `profitplate_command(p_command, p_request_id, p_organization_id, p_payload)` using the verified user's JWT. Keep Supabase signature verification enabled. Never accept an actor ID from application input or replace the user's session with a service key for business mutations. `lib/database-contract.ts` defines payloads; the database independently validates them and rejects unknown fields.

| Command | Payload |
| --- | --- |
| `bootstrap` | `name`; omit organization argument |
| `update_organization` | `name` |
| `create_location` | `code`, `name` |
| `update_location` | `id`, `code`, `name`, `is_active` |
| `create_item` | `sku`, `name`, `base_uom_code` |
| `update_item` | `id`, `sku`, `name`, `is_active` |
| `supersede_conversion` | `item_id`, `source_uom_code`, decimal-string `factor`; optional `supporting_note` |
| `retire_conversion` | `id`, `reason` |
| `invite` | `email`, non-owner `role` |
| `resend_invitation` | `id` |
| `revoke_invitation` | `id`, `reason` |
| `accept_invitation` | `id`, `token` |
| `change_member_role` | `user_id`, non-owner `role`, `reason` |
| `suspend_member` / `reactivate_member` | `user_id`, `reason` |
| `transfer_ownership` | `user_id`, `reason` |

Results are `{ id, organization_id }`, or `{ organization_id }` for bootstrap. Updates submit complete editable values. Retry keys are UUIDs scoped by actor, organization (a sentinel for bootstrap), command, and key. Same key/payload returns the successful result without another mutation/event. Different payload is rejected. Failed transactions roll back the request record. Authorization is checked before cached results are returned. Retain successful request records throughout V0.1 so old retries remain safe.

Commands lock the organization before checking permissions and changing records, deliberately serializing writes per tenant in V0.1. Bootstrap/transfer also share a transaction advisory lock across organizations. Unique indexes enforce ownership upper bounds; deferred constraint triggers require exactly one owner at commit. Mutations, audit, and retry records commit atomically.

Transfer requires the current owner and a different verified active recipient who owns no other organization. The former owner becomes admin. A password/OTP/TOTP/WebAuthn AMR event must be within five minutes; token refresh time is insufficient. Owner suspension/removal through ordinary membership commands is denied. Identity deletion is restricted while referenced by foundation history; full account-erasure and organization-closure workflows are outside V0.1 and must not use cascades.

Errors: `42501` auth/permission; `22023` invalid input/state; `23505` duplicate; `23514` invariant; `23503`/`23001` referential restriction. Map them to application messages without exposing raw diagnostics or credentials.

## Decimal and conversion contract

Factors use `numeric(24,12)`, greater than zero and at most `1000000000`. Commands require plain decimal strings with at most 12 fractional places; exponent notation and excess precision are rejected rather than rounded. This is the factor contract only; quantities, money, valuation, and rounding need future specifications.

Read factors through `item_conversion_history`. The underlying numeric column is correctly generated as a JavaScript `number` by Supabase typegen, but application calculations must use the view's string representation and decimal-safe arithmetic. Fixed dimensional conversions derive from reference factors, never item overrides.

Item mappings must cross dimensions and target the immutable base unit. Mass/volume mappings require item-specific evidence in the supporting note; density is never inferred. A generic `each` cannot represent multiple package sizes for one item. Arbitrary cases/cartons/bags are outside V0.1. Before stock posting, transaction lines must retain their chosen revision and normalized quantity.

## Invitation worker protocol

The user's `invite` command persists the invitation and queues delivery. A trusted backend worker calls `pending_invitation_deliveries`, then `claim_invitation_delivery`, sends the email, and calls `complete_invitation_delivery`. Only `service_role` may execute these worker RPCs; keep that key server-only. This foundation does not wire a provider or send real email.

Claim returns recipient, organization/invitation IDs, expiry, token, and lease ID. Build links from a configured trusted origin, never a request Host header. Never log tokens, recipient emails, provider bodies, or token-bearing URLs. Use provider idempotency keyed by invitation and lease, with capped exponential retry/backoff in the worker. Persisted success and delivery success are separate states.

Tokens concatenate two cryptographically generated UUIDv4 values (244 random bits). Only SHA-256 hashes are persisted. Leases last five minutes; live leases block competing claims. Reclaiming after a crash/failure rotates the token. An ambiguous provider response is recovered with a fresh link. Expired/stale completion leases cannot overwrite newer state. Provider errors are recorded only as short uppercase codes. Owner/admin can inspect `invitation_delivery_status`.

Invitations expire after seven days. Resend immediately invalidates the previous token, updates the inviter, extends expiry, and queues delivery. Revoke invalidates the token and cancels delivery. Acceptance checks matching verified email, hash, state, expiry, and inviter's current authority while holding transaction locks. It never reactivates suspended members. Same-user acceptance retries create one membership/event. Expiry works without scheduled cleanup. Email normalization is trim/lowercase with no provider alias merging. Acceptance routes must keep tokens out of referrers/analytics.

## Audit and setup readiness

`search_audit_events` supports actor, action, entity type/ID, inclusive start/exclusive end timestamps, and pages of 1–100. Order is `(created_at DESC, id DESC)`. Base64 opaque cursors bind the position to an organization; they are not credentials. Permissions are rechecked per call. Keep filters unchanged across pages. No unrestricted metadata search or cross-tenant totals are exposed.

Bootstrap, master/setup changes, invitation lifecycle, role/status changes, transfer, and conversion revisions/retirement are audited. Snapshots exclude invitation email and token material. Reasons/notes are user-entered text; never ask for secrets in these fields. Retain all events in V0.1, with no application purge command. Bulk export, retention automation, and account erasure require an explicit production contract. Database-owner maintenance is privileged and outside application command audit guarantees; record those operations separately.

Derive setup state from saved records, not browser storage or independent booleans. Solo owners need no invitations and items without packaging need no conversion. Steps can be skipped/reordered after bootstrap. Resume the existing organization. No setup command creates stock.

## Verification and rollout

Use [the database workflow](../supabase/README.md). Fast checks run real PostgreSQL through PGlite with minimal Auth fixtures. Native checks run a disposable loopback PostgreSQL 17 cluster and separate-session races. They never load hosted credentials or modify hosted data. CI also defines full Docker-backed Supabase reset/lint/Auth/PostgREST checks and generated-type drift detection; its presence is not evidence of a completed CI run.

Before hosted deployment: inspect target schema/migration history, match PostgreSQL major versions, verify a recoverable backup if data exists, preview a migration dry-run in the intended development/staging project, then apply using privileged migration access. Public API keys cannot execute DDL. Never put database passwords/access tokens in `NEXT_PUBLIC_*` or version control. Local Auth/API configuration is not automatically applied to the hosted project.

The initial migration is transactional. After deployment with data, recover through a reviewed forward migration or verified backup; do not drop foundation tables as rollback. Local reset is exclusively for disposable development databases.

Evidence during implementation:

- Native PostgreSQL 17: 27 functional/security scenarios and eight independent-session races passed.
- TypeScript schema generated by the pinned Supabase CLI from the migrated database.
- ESLint/TypeScript final checks are recorded in the task response.
- Docker-backed Supabase reset/lint/Auth/PostgREST: pending; Docker is unavailable on the command path here.
- Hosted migration: applied on 27 October 2026 to project `ndvqzhvnwbemqmwdlckl` (PostgreSQL 17.11). Read-only verification confirmed 11 RLS-enabled tables, six system units, the security-invoker conversion view, two deferred ownership triggers, and expected command/worker/direct-write permissions. Real Auth/PostgREST workflow integration remains pending.
- Frontend/accessibility checks remain pending; database tests do not establish V0.1 release completion.

Official references: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [local workflow](https://supabase.com/docs/guides/local-development/cli/getting-started).
