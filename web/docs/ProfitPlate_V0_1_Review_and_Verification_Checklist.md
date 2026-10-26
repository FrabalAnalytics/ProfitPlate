# ProfitPlate V0.1 review status and verification checklist

Date: 25 October 2026
Status: Document review complete; implementation and database verification not performed.

## Artifact register

| Artifact | Review status |
| --- | --- |
| Master PRD v1.0 DOCX | Read; product and release requirements compared |
| V0.1 Engineering Specification and Design v1.0 DOCX | Read, including design addendum |
| 001_foundation.sql | Not supplied; not found in searched locations; not reviewed |
| CODEX_START_HERE.md | Not supplied; not found in searched locations; not reviewed |
| V0.1 closure addendum | Prepared as proposed resolutions; does not establish implemented behavior |

The configured `C:\Users\Hp\Desktop\ProfitPlate AI\web` directory was absent. Review artifacts are saved in the existing authorized `C:\Users\Hp\Desktop\ProfitPlate\web\docs` directory. No original DOCX was modified.

## Required acceptance evidence

All rows below are pending. They supplement, rather than replace, the original engineering specification's test matrix.

| ID | Scenario | Required outcome / evidence |
| --- | --- | --- |
| REV-01 | Fresh migration and reset | Original migration reviewed; clean Supabase reset succeeds; grants, functions, triggers, RLS and generated types match documented contracts |
| REV-02 | Two-tenant master access | Authenticated JWT tests deny guessed-ID cross-tenant reads/writes, including conversion history and audit filters |
| REV-03 | Sensitive table access | Direct ordinary-client writes to organizations, memberships, invitations, system units, and audit fail except narrowly granted approved RPCs |
| REV-04 | Bootstrap verification and retries | Anonymous/unverified bootstrap denied; successful retry returns same organization; independent second owned-org creation denied |
| REV-05 | Invitation identity | Wrong verified email, unverified email, invalid token, expired token, and revoked token cannot activate membership |
| REV-06 | Invitation race and retry | Concurrent accept/revoke has one valid result; repeated acceptance creates one membership and one acceptance event |
| REV-07 | Invitation delivery recovery | Provider failure is visible and retryable; resend invalidates old token; repeated invite does not create parallel pending invitations |
| REV-08 | Lost inviter authority | Acceptance after inviter suspension or loss of invite permission is denied |
| REV-09 | Suspended target | Invite or acceptance cannot bypass suspension; explicit authorized reactivation is audited |
| REV-10 | Ownership concurrency | Competing transfer/bootstrap/suspension attempts preserve exactly one owner per organization and at most one owned organization per user |
| REV-11 | Ownership authorization | Admin cannot grant owner, alter owner, or change own role; invalid recipient and failed transfer leave original ownership intact |
| REV-12 | Item identity | UI, API and direct database paths reject base-UOM/ID/tenant reassignment; inactive SKU cannot be recycled |
| REV-13 | Conversion rules | Fixed dimensional conversions are correct; invalid factors, ambiguous mappings, wrong targets and alternative fixed factors are denied |
| REV-14 | Conversion revisions | Updating factor creates retained immutable history; concurrent revisions leave one active mapping; clients cannot erase history |
| REV-15 | Packaging limits | Editor explains supported `each` example and unsupported multiple pack sizes; does not present carton/case support |
| REV-16 | Role visibility | Shared masters readable by active roles; team restricted to owner/admin; audit restricted to owner/admin/accountant |
| REV-17 | Suspension | Already-authenticated suspended user loses server and database access on next request |
| REV-18 | Resume setup | Reload/new session restores existing progress; solo owner and non-packaged items can complete relevant steps; no fake stock metrics |
| REV-19 | Mutation idempotency | Retried mutations return original results; different payload with reused key is rejected; failures can be retried safely |
| REV-20 | Audit integrity | All defined changes identify actual initiating actor; tokens/emails/secrets excluded from metadata; client forgery and edits denied |
| REV-21 | Audit search | Filters and stable pagination remain within tenant and permission scope; guessed filters reveal no foreign records or counts |
| REV-22 | Responsive accessibility | Required screens checked at 375/768/1440px; keyboard, focus, labels, errors, touch targets and contrast verified; screenshots retained |

## Engineering handoff sequence

1. Obtain the original SQL and original handoff file; preserve their provenance.
2. Reconcile the SQL with the proposed addendum, especially invitation schema, ownership enforcement, conversion revisions, audit attribution, and uniqueness rules.
3. Record accepted resolutions and any deliberate departures in version-controlled specifications. Convert remaining numeric precision and provider-specific recovery details into exact contracts before coding those paths.
4. Execute migration/RLS and concurrency tests against a real local or test Supabase instance before treating security as established.
5. Implement V0.1 increments and run the source specification's functional, security, build, responsive, and deployment checks.
6. Attach actual test output, migration version, recovery/rollback notes, unresolved defects, and release sign-off. Do not mark this checklist passed based on design review.

No executable SQL was invented, no application was built, and no deployment was performed during this review.
