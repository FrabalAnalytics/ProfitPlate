# ProfitPlate V0.1 specification closure addendum

Date: 25 October 2026
Status: Proposed engineering baseline prepared following document review. These resolutions are recommendations, not evidence of founder approval, implemented behavior, or passed tests.

Sources:
- ProfitPlate_Master_PRD_Inventory_and_Margin_Intelligence_v1_0.docx
- ProfitPlate_V0_1_Engineering_Specification_Design_v1_0.docx

This addendum addresses ambiguities in the two documents. It does not replace the original documents or authorize implementation of future releases. If accepted for implementation, reconcile the authoritative SQL and handoff file with this addendum first; do not silently override executable constraints.

## 1. Release boundary and artifact status

V0.1 contains verified authentication, organization setup, membership lifecycle, locations, items, system units, limited item conversions, audit, and the specified responsive application shell. It contains no stock quantities, balances, money, posting ledger, procurement transactions, recipes, AI, or billing.

The referenced `001_foundation.sql` and `CODEX_START_HERE.md` were not supplied and were not found in the searched Downloads directory or existing web workspace. The migration has not been reviewed or executed. RLS, grants, trigger coverage, owner invariants, and schema compatibility remain unverified. Do not reconstruct an allegedly authoritative migration from the prose summary.

## 2. Invitation lifecycle

Use a dedicated tenant-scoped `organization_invitations` model rather than pending membership rows for identities that do not exist. Creating or sending an invitation does not grant data access.

Required logical fields: immutable invitation ID, organization ID, normalized recipient email, proposed role, inviter user ID, created time, expiry time, status, accepted user ID/time, revoked actor/time, and delivery state. Store only a cryptographic hash of an application invitation token, never the raw token. Tokens must have cryptographically secure entropy and must not enter logs or audit details.

Recommended expiry: seven days. A resend rotates the token and resets expiry, invalidating the old link. Permit at most one pending invitation per organization and normalized email. Do not merge distinct email addresses using provider-specific alias rules. States are pending, accepted, revoked, and expired; expiry must be enforced during acceptance even if a scheduled cleanup has not run.

Server-only invite command:
1. Verify the caller's active membership and owner/admin role.
2. Allow only non-owner roles. Owner assignment uses the separate transfer operation.
3. Reject invitation to an existing active member and do not use invitations to reactivate suspended members.
4. Create a retry-safe invitation and delivery record. Dispatch email through a trusted server flow; retry delivery without creating another invitation. Report delivery failure separately from persistence success.
5. Return a tenant-local result without disclosing membership or account existence elsewhere.

Acceptance requires an authenticated user with verified email matching the invitation email. Lock the invitation and atomically validate token, status, expiry, organization, and email; create or activate the permitted membership and mark acceptance. Recheck the inviter's current authority and allowed target role; reject acceptance if authority has been lost. Never reactivate a suspended membership through acceptance. Acceptance by the same user after successful completion returns the existing result without duplicate membership or audit events. Competing acceptance or revocation must have one valid outcome.

Revocation and resend require current owner/admin authorization. A suspended user can be reactivated only through a separate owner/admin operation with actor and reason recorded. Invitation recipient email is restricted to team administration; it is not general master data.

Supabase Auth email delivery and identity lookup are server-only implementation details. Authentication-provider success and application-invitation success must be tracked separately so partial failures can be recovered.

## 3. Ownership and membership invariants

Resolve the ownership model to exactly one active owner per organization and at most one owned organization per user in V0.1. Ordinary role editing and invitations cannot grant or remove owner status. The owner can transfer ownership through a separate atomic operation.

Transfer prerequisites:
- Caller is the current active owner and has recently reauthenticated.
- Recipient is a verified, active member of the same organization.
- Recipient does not own another organization.
- Caller and recipient differ.

Transfer demotes the former owner to admin and promotes the recipient to owner in one database transaction. Use a consistent locking order covering the organization and affected users, plus database constraints or equivalent transactional enforcement of uniqueness. Bootstrap, transfer, role change, suspension, reactivation, and account-removal paths must share the invariants. A failed or concurrent operation must leave the original valid ownership state intact.

An admin can manage non-owner memberships only. Admins cannot modify or suspend the owner, grant owner, or change their own role. Ownership transfer is the only V0.1 ownership change. Owner account deletion is blocked until ownership is transferred; organization closure is outside V0.1.

Each successful lifecycle operation records the initiating actor, target identity, organization, action, timestamp, reason where required, and request ID. Privileged database connections must receive actor identity only from verified server context, never a client-supplied actor field.

## 4. Item identity and base UOM

The item ID, organization ID, and base UOM are immutable from creation, including before stock postings exist. A mistaken base UOM requires deactivating the item and creating a replacement with a distinct SKU; retain the old identity and its history. Do not recycle inactive SKUs.

SKU and name can be corrected subject to tenant-local uniqueness and audit. Define canonical SKU and location-code comparison before migration implementation: trim surrounding whitespace and compare case-insensitively; display location codes in uppercase. Normalize on the server and enforce equivalent uniqueness in the database.

## 5. Units, packaging, and conversion history

System dimensional conversions are fixed: kg/g, l/ml, and dozen/each. Store factors as exact database numeric values and use decimal-safe application handling. Version the numeric precision, scale, rounding, and upper bounds in the schema/validation contract before implementation; do not choose them independently in the UI and database.

V0.1 item-specific mapping is deliberately limited to one approved cross-dimensional mapping per item and source unit, always targeting the immutable item base unit. Example: one `each` of a particular bottled item equals 700 ml. Reject zero/negative factors, same-unit mappings, alternative same-dimension factors, wrong base targets, and ambiguous competing active mappings. Mass-to-volume mapping requires explicit item-specific evidence and a visible explanation; never infer density.

A generic `each` cannot represent both a bottle and a carton for the same SKU. V0.1 does not provide arbitrary carton/case/bag units, variable pack sizes, packaging hierarchies, or multiple competing pack definitions. State that limitation in the conversion editor. Do not tell users to create separate SKUs merely to represent alternate packaging of the same stock item.

Conversion changes create immutable revisions with factor, source/target UOM, recorded time, actor, and optional supporting note. Retire or supersede an old revision rather than overwriting or deleting it. Enforce at most one active mapping for an item/source/target. Old revisions remain readable to authorized members; hard deletion is denied.

Before V0.2, transaction lines must capture the selected conversion revision and normalized quantity. Editing a conversion must never reinterpret posted history. Adding packaging identities and transaction-effective conversion dates requires a reviewed migration before stock posting, not an implicit extension of the V0.1 UI.

## 6. Access scope

V0.1 active members can read shared location and inventory master data organization-wide. Kitchen/bar department restrictions are future operational permissions; V0.1 must not advertise department-level isolation. Team administration is owner/admin only; the audit trail is owner/admin/accountant only. Location selection is context, not an authorization boundary.

Server checks and database enforcement must agree. Suspended memberships lose access on the next request even with an otherwise valid authentication session. Hiding a control is not authorization. Invitation acceptance is a narrowly authorized operation and must not permit arbitrary membership mutations.

## 7. Organization setup and resumability

Use NGN and Africa/Lagos as fixed V0.1 defaults, visibly stated on setup and organization settings. General currency/timezone editing is deferred until its validation and reporting consequences have an explicit contract. This is restaurant configuration and must not depend on the browser or developer machine timezone.

Persist setup progress through saved organization, location, item, conversion, and invitation records. Derive checklist state on reload; do not require local browser storage. After organization creation, setup steps can be completed in any order or skipped. Zero pending invitations does not block a solo owner, and an item without packaging needs no conversion. No operation creates opening stock.

The onboarding progress indicator and home checklist use the same persisted readiness rules. Interrupted setup returns to the existing organization rather than attempting another bootstrap. Bootstrap retries must return the prior result for the same successful command; an independent attempt to create another owned organization is rejected.

## 8. Command and audit additions

Add explicit command contracts for accepting, revoking, resending invitations; reactivating members; transferring ownership; and superseding conversions. All mutations validate inputs at runtime, resolve authenticated context server-side, and use retry-safe request handling. Scope mutation idempotency to organization, actor, command, and key; reject reuse with a different payload.

Audit metadata must support lifecycle traceability without tokens, credentials, or raw invitation emails. Use stable internal target IDs. Application users cannot insert, alter, or delete audit events. Include organization bootstrap, setup changes, invitations, role/status changes, transfer, item edits, conversion revisions, and deactivation. Define access-controlled retention/export requirements before production launch.

Audit search is tenant-scoped and server-paginated, with filters for time range, actor, action, and entity. Use an opaque stable ordering cursor; do not expose other tenants through search, error details, totals, or exports. Do not search secrets or unrestricted user-entered metadata.

## 9. Acceptance additions

The companion review checklist records required evidence. Every scenario is pending until executed against the reconciled migration and application. Screenshots and unit tests alone cannot establish tenant isolation or atomic ownership guarantees.

## 10. Decisions retained for later gates

Do not treat this addendum as approval of financial policy. Before V0.2, resolve valuation, negative-stock exceptions, backdating/period locks, tax treatment, returns and retroactive costs, decimal precision/rounding, and opening-stock cutover. Before V0.3 resolve transfer recognition and count/approval controls. Before V0.5 resolve recipe costs and POS consumption boundaries.
