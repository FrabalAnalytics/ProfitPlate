# ProfitPlate overall system review

Date: 31 October 2026, Africa/Lagos. Baseline: commit `155e4df`.

Implementation follow-up: [review fixes and verification](System_Review_Fixes_2026-10-31.md). The findings below describe the original baseline, with its evidence preserved.

## Assessment

ProfitPlate has a substantial operational foundation and a recognizable visual identity. The financial evidence model, independent approvals, immutable posting history and role controls deserve preservation. The interface is not yet at the product owner's requested standard for navigation, table usability and daily operation at scale.

The first improvement should be trustworthy retrieval and review of complete records. A new local volume check reproduced a submitted 200-line purchase order displaying **zero lines with Approve still available**. A separate limit made the oldest of 51 purchase orders disappear from Purchasing. These are higher priority than cosmetic changes.

The green and warm-neutral palette can remain. Improve the information hierarchy, typography and table interactions around it. The focused sales review and Reports overview provide useful patterns for the rest of the application.

## Evidence and scope

- Read the workspace routes, shared navigation/forms, role resolution, report calculations/export, relevant SQL migrations, verification scripts, CI workflows and current implementation documentation.
- Ran fresh local Chromium walkthroughs as Owner, Kitchen, Procurement and Operations Manager. Inspected desktop and 375px layouts, empty states, stock tables, report filters/error recovery, master-data navigation and larger purchasing/approval datasets.
- Used the loopback Auth/PostgREST fixture and real SQL through PGlite. The fixture emulates Auth and is not a full hosted Supabase service. No restaurant data, hosted transactions or production configuration changed. No approval was executed in the volume reproduction.
- The immediately preceding commit verification recorded a passing production build, lint, nine unit tests and 88 native PostgreSQL scenarios. All 32 browser cases reported passing, but the runner needed termination during shutdown. Those broad checks were not repeated for this documentation-only review.
- This review adds focused observations; it does not certify production security, hosted migration parity, accessibility conformance, disaster recovery or performance under production load.

Fresh evidence is retained in [reviews/2026-10-31](reviews/2026-10-31/): [walkthrough observations](reviews/2026-10-31/observations.json), [volume observations](reviews/2026-10-31/large-observations.json), and screenshots linked below. The reproduction scripts are local scratch files under `.tooling/system-review`.

## Priority register

P1: address before operational rollout. P2: important correctness or usability improvement. P3: polish. “Reproduced” means exercised during this review; “source” means established by the implementation, without a new end-to-end reproduction.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| R01 | P1 | Approval and receiving evidence can be incomplete | Reproduced; related paths inspected |
| R02 | P1 | Lists make older or excess records unreachable | Reproduced for purchasing; source elsewhere |
| R03 | P2 | Previous-period comparison overlaps multi-month ranges | Reproduced with exported function |
| R04 | P2 | Report-cycle selection conflicts with retained custom dates | Browser reproduced |
| R05 | P2 | Invalid report dates eject users to a generic error page | Browser reproduced |
| R06 | P2 | Operational tables lack consistent numeric and mobile presentation | Browser and visual review |
| R07 | P2 | Item maintenance has creation but no edit/deactivation workflow | Source |
| R08 | P2 | Recipe maintenance does not expose the full current definition | Source |
| R09 | P2 | Audit records are stored but have no searchable workspace | Source |
| R10 | P2 | Navigation loses context across master-data and inventory screens | Source and browser review |
| R11 | P2 | Owner dashboard keeps onboarding content after setup is complete | Browser reproduced |
| R12 | P2 | Screens fetch unrelated data and fan out requests | Source; production latency not measured |
| R13 | P2 | CI omits two existing correctness test files | Source |
| R14 | P2 | Small text weakens readability and visual hierarchy | Computed styles and visual review |
| R15 | P3 | Product copy still contains test language and broken punctuation | Source and screenshots |

## Findings and required outcomes

### R01 — Fetch complete evidence for the selected transaction

**Observed:** In a disposable organization, created six 200-line orders followed by 45 one-line orders. Submitted orders 1 and 6. Order 6 had 200 persisted lines, but Approvals rendered zero body rows while its Approve button remained visible. Approval was not clicked. See [screenshot](reviews/2026-10-31/incomplete-approval-1440.png).

**Cause:** `approvals/page.tsx:65` fetches up to 1,000 purchase-order lines across the organization, then `:392` filters that truncated result for each submitted order. Purchasing uses the same pattern at `purchasing/page.tsx:56` and `:252`; its receiving controls depend on the remaining visible lines. Requests and counts use similar independent child queries. The configured local API maximum is 1,000 rows (`supabase/config.toml:17`), while count pages ask for 25,000; the browser fixture does not emulate that service maximum.

**Impact:** Reviewers can approve a full transaction without seeing its contents. Receiving or fulfilment controls can omit outstanding lines. This is a presentation/completeness defect; it does not establish a bypass of atomic SQL posting checks.

**Change:** Fetch details by selected parent IDs or a document-scoped read model; page child collections explicitly. Return authoritative total line counts and detect incomplete responses. Withhold approval when review evidence cannot be loaded completely. Keep the original transaction ID and database permission checks as posting authority.

**Acceptance:** With more than 1,000 historical lines, every line of the selected 200-line order/count/request remains reviewable; displayed counts agree with the database. Simulate a partial detail response and verify a clear error plus no approval control. Repeat through actual PostgREST with its row cap.

### R02 — Reach every record and keep outstanding work discoverable

**Observed:** Created 51 purchase orders; Purchasing displayed 50 articles and omitted the oldest submitted order. It has no next-page, reference search, status filter or order-detail route. An older approved order would face the same retrieval limit when a receiver needs it.

**Evidence:** `purchasing/page.tsx:55`, `requests/page.tsx:33`, `counts/page.tsx:26`, `inventory/page.tsx:310`, `:384`, `:453`, `:610`; master lists use 500-row limits, and Reports lists only 30 snapshots/reconciliations. Existing document deep links help with known inventory document IDs but do not make the list searchable. Pagination inside a sales batch does not page the batch index.

**Change:** Use server-side search, status/location/date filters and stable pagination for list pages. Give orders, requests and counts durable detail URLs. Default daily workflows to outstanding work and make completed history separately accessible. Show result counts and current filters.

**Acceptance:** After 51 orders and 101 movements, users can find the oldest by reference and navigate all pages. An old approved, partially received order remains discoverable until fulfilled. Include duplicate timestamps in pagination checks. Do not merely raise hard limits.

### R03 — Compare against a distinct previous period

**Observed:** `previousReportPeriod('2026-07-01','2026-09-30')` returns **2026-06-01 through 2026-08-31**, overlapping July and August with the selected quarter. August–September similarly compares against July–August.

**Cause:** `lib/reporting.ts:54` treats any month-boundary range as a single month and shifts each endpoint back only one month. Reports uses this calculation for its financial comparison.

**Change:** Make the comparison policy explicit: a monthly cycle compares with the previous calendar month; a custom range can use an equal-duration period ending the day before the selected start. If multi-month calendar comparisons are supported, shift the entire number of months. Preserve the displayed comparison dates.

**Acceptance:** Test quarter, two-month, year, leap-year and ordinary custom ranges. The comparison must not overlap the selected range and must follow the chosen calendar/duration policy. Retain existing single-month behavior.

### R04 — Make custom range an explicit report mode

**Observed:** Opened Reports for 26–27 October, chose Weekly and submitted. The URL contained `cadence=weekly`, while the report still covered 26–27 October. `reportPeriod` intentionally gives an explicit end date precedence, and `reports/page.tsx:198` retains that end date. The user-facing cycle does not explain the conflict.

**Change:** Offer Daily, Weekly, Monthly and Custom range as explicit choices. Standard cycles derive both dates; only Custom exposes an editable end date. Switching cycles must visibly update the effective range. Preserve filters when moving between report sections.

**Acceptance:** Switching from a custom range to Weekly produces Monday–Sunday; Monthly produces that calendar month. Browser tests must exercise mode changes, not just helper calls.

### R05 — Keep report validation and recovery within Reports

**Observed:** `start=2026-10-31&end=2026-10-01` produced “We couldn’t load this page,” with Try again and Return to sign in. The date controls disappeared, and retrying the same URL cannot correct the range. See [screenshot](reviews/2026-10-31/invalid-report-period-1440.png).

**Evidence:** `reports/page.tsx:93` throws the RPC validation failure; `app/error.tsx` presents a generic boundary.

**Change:** Validate valid dates, start/end order and maximum duration before the report call. Retain the filter form and show a specific, focused validation message. Reserve the generic boundary for unexpected failures.

**Acceptance:** Invalid, reversed and overlong periods keep users in Reports with editable dates and an accessible error. Existing saved reports stay accessible.

### R06 — Establish one operational table pattern

**Observed:** Stock quantities and costs are left aligned. At 375px, the stock wrapper is 287px wide with 601px of content; availability and costs require horizontal scrolling without a visible cue. The page itself does not overflow. See [phone screenshot](reviews/2026-10-31/stock-375.png).

**Evidence:** `app/globals.css:1487`–`:1505` provides horizontal scrolling and globally left-aligned cells. Most operational tables lack captions/accessibility names and explicit scroll-region focus treatment. Sales review already has a bounded list, sticky headers and phone cards, but other screens do not share that pattern. Actual keyboard behavior of scrolling regions needs browser-specific verification.

**Change:** Use consistent column order, right-aligned numeric headers/cells, tabular digits, currency/unit labels and intentional column widths. Add sticky headers for long tables, useful search/filter controls, visible scroll affordances and an accessible table name. On phones, prioritize item, location and available quantity with an expandable row/card for secondary values. Keep money/percentages at two decimals and quantities at three.

**Acceptance:** Stock, purchasing, requests, counts and reports support reading the same row at 375/768/1440px, keyboard navigation, 200% zoom, long names and large/negative values. Row identities remain visible while inspecting secondary columns. No loss of columns or evidence.

### R07 — Complete the item lifecycle

**Evidence:** The item list in `inventory/page.tsx:951` has identity/category/unit/price/status columns and a creation form, but no edit or deactivate action. `lib/database-contract.ts:14` already defines `update_item`; the operational action dispatcher does not expose that workflow.

**Change:** Add an authorized item detail/edit screen for supported mutable fields and explicit deactivation/reactivation. Preserve tenant, item identity, base-unit immutability, SKU reservations and existing audit rules. Derive permitted fields from the database contract.

**Acceptance:** An authorized operator can correct a name and retire an item without SQL access; unauthorized edits fail, and historical documents retain their evidence. Do not infer category/base-unit editability from this recommendation.

### R08 — Let operators inspect recipes before revising them

**Evidence:** `inventory/page.tsx:441`–`:588` displays name, kind and live cost, plus creation and new-version forms. It offers no recipe-detail link showing the selected version's ingredient quantities, standard yield or historical versions. The revision form starts with an empty ingredient list.

**Change:** Provide recipe detail with current version, yield, ingredients, units and cost completeness; expose prior immutable versions. Start revision from the selected definition and make replacement of the full list explicit.

**Acceptance:** Kitchen/Finance can inspect a complete recipe without creating a transaction. A permitted revision starts from visible existing quantities and creates a new version; posted sales and old drafts retain their original versions.

### R09 — Make audit history usable

**Evidence:** `public.search_audit_events` exists in migration 001 and database tests cover scoped search, but no workspace route calls it. The focused sales page exposes limited document audit information, not searchable organization history.

**Change:** Add an audit workspace for the existing permitted roles, with actor, action, record, date and stable pagination. Link relevant records to their detail pages. Keep sensitive invitation data excluded and use the existing authorization boundary.

**Acceptance:** Authorized reviewers can trace an item change, duty assignment, approval and period reopen. Other roles and foreign-organization filters reveal no events or counts.

### R10 — Preserve navigation context and show relevant actions

**Observed/source:** Master data links Final recipes and Sub-recipes into Inventory. Neither destination marks the Recipes tab active because the test is only `view === key` (`inventory/page.tsx:1044`). Master-data section links do not set an active state. Kitchen sees all eight inventory tabs, including Sales import and Operating controls, although import is restricted and controls are largely informational for that role. Daily queue counts are plain text rather than links to the corresponding work.

**Change:** Map related route variants to a coherent active section. Give master-data sections active states and clear return paths. Group daily operations separately from setup/administration. Show permitted primary actions prominently while retaining necessary authorized read access. Link queue counts to filtered work.

**Acceptance:** From Menu mapping → Final recipe → back, context stays clear. Owner, Admin, Operations, Procurement, Store, Kitchen, Bar, Finance and Viewer have purposeful entry points. Extra duties remain visible and do not grant self-approval.

### R11 — Let the owner dashboard graduate from setup

**Observed:** A business with three active locations and an item still shows the full foundation banner and completed setup checklist. The owner has quick links but no compact operational summary. See [screenshot](reviews/2026-10-31/owner-overview-1440.png). `RoleWorkspace` selects one action group by a priority chain, which can hide shortcuts for additional duties.

**Change:** Collapse completed onboarding into a small setup-status link. Lead with linked pending work, delivery exceptions and financial evidence readiness using the existing role-scoped read models. Include shortcuts for explicitly assigned duties. Keep incomplete or unavailable metrics clearly identified.

**Acceptance:** A new owner gets setup guidance; a configured business gets a useful daily overview. No fabricated zero values or implicit stock/purchasing privileges.

### R12 — Load the data needed by the current screen

**Evidence:** Inventory loads item/location/price collections before choosing the active section; recipe costs fan out into one RPC per recipe (`inventory/page.tsx:457`). Approvals fetches a preview for every selected stock document. Reports loads saved snapshots, reconciliations, actions, people and a prior report even when the selected section does not display them (`reports/page.tsx:99`–`:144`). An unrelated query failure can prevent the current section from rendering.

**Change:** Separate list summaries from selected-record details, load section-specific data, and batch repeated read operations where useful. Add measured timing and query-count evidence before choosing caching. Do not cache current permissions or historical evidence incorrectly.

**Acceptance:** Measure representative 327-item and larger catalogues with realistic network latency. Set and verify screen response targets; opening Inventory details should not require unrelated Finance/action queries. Recheck suspension and role changes after optimization.

### R13 — Run the existing correctness tests in CI

**Evidence:** `.github/workflows/web-ui.yml` runs the CSV tests, build and browser suite, but neither workflow runs `tests/number-format.test.mjs` or `tests/reporting-periods.test.mjs`. The existing period tests also omit the multi-month counterexample in R03.

**Change:** Add one unit-test command covering all three current test files and invoke it in CI. Add regression coverage for the confirmed retrieval and reporting defects when fixing them. Verify the actual hosted CI result rather than treating workflow definitions as a passing run.

**Acceptance:** A broken decimal-format or period assertion fails CI. Real PostgREST integration covers row caps; browser tests cover record discovery beyond the first page. Diagnose the local test-runner shutdown hang separately from test assertions.

### R14 — Raise small text to a deliberate readable scale

**Observed:** Computed owner-dashboard explanatory text is often 9px, action/refresh help 11px and some labels 8px. Stock tables use 12px; Reports and sales components use a separate rem-based scale. The result is an uneven reading experience even where layouts fit.

**Change:** Define shared body, table, label and supporting-text sizes with comfortable line heights. Reserve tiny text for nonessential decoration. Review contrast, zoom, focus visibility, target sizes and text spacing with keyboard and assistive-technology checks. Small font size alone is not a claim of standards nonconformance.

**Acceptance:** Essential instructions, values and statuses remain legible at 375px and 200% zoom without relying on a screenshot scaled to fit. Include long labels and validation messages.

### R15 — Remove unfinished copy and punctuation

**Evidence:** Approvals says “Both managers” despite supporting multiple Operations Managers. Team invitations and role shortcuts still refer to intended “test” users/operational testing. The sales import helper contains a replacement character in “line’s”; operational report summaries contain literal question-mark separators. Some singular counts read “1 active inventory items.”

**Change:** Use consistent user-facing terms, correct encoding and pluralization, and keep implementation/testing instructions in the guides. Preserve the explicit notice that invitation codes are manual and no email is sent.

**Acceptance:** A copy pass covers every role and empty/error/success state; UTF-8 source scanning finds no unintended replacement characters.

## What to preserve

- Database-enforced tenant boundaries and live membership checks; session transport alone does not authorize protected reads.
- Independent creators/approvers, explicit additional duties and department scopes.
- Atomic/idempotent posting, reservation and transfer-acceptance rules, and period locking.
- Captured historical sales costs and immutable report revisions; current purchases do not recompute posted evidence.
- Clear separation of theoretical recipe cost from approved Finance-reconciled COGS; unavailable evidence remains unavailable.
- Exact decimal-string display formatting, CSV formula-prefix protection, export authorization/auditing and private no-store responses.
- Focused sales review, full-batch approval semantics, mobile sales cards, explicit form labels, error focus and reduced-motion support.

These strengths are supported by the inspected implementation and prior local scenarios; they are not a substitute for the remaining hosted checks.

## Implementation sequence

1. **Complete evidence and retrieval:** R01–R02. Build a complete selected-record read path and searchable, paginated indexes before restyling them. Verify against actual PostgREST row limits.
2. **Reporting accuracy and recovery:** R03–R05, plus R13 regression coverage. Make date-mode and comparison behavior explicit.
3. **Navigation and table foundation:** R06, R10, R14. Apply the pattern first to stock, purchasing, requests and counts; retain the stronger sales-review interactions.
4. **Daily workflows:** R07–R09 and R11. Finish item maintenance, inspectable recipe versions, audit search and the operational dashboard. Address R12 with measured query reductions.
5. **Finish and validate:** R15, all-role walkthroughs, accessibility checks, hosted integration and release sign-off.

For each increment, retain screenshots at 375/768/1440px, meaningful correctness tests, the affected-role matrix and a clear record of remaining limitations. Visual improvements must not change posting authority or accounting formulas unintentionally.

## Remaining release decisions and verification

The current documentation explicitly leaves approved transaction reversals, supplier invoice/payment workflows, transfer-shortage settlement, reorder alerts and scheduling outside this increment. Agree the required operational correction path before using the system as a daily source of record; failed/incorrect approved transactions must have a supported resolution procedure that preserves history.

Complete a hosted operator walkthrough with the intended roles, confirm the deployed migration history through 018, and collect real Auth/PostgREST evidence. The local fixture does not establish email-provider behavior, production service caps, deploy-time configuration or restore capability. Existing documentation contains historical pending statuses; reconcile them into one dated release checklist with actual evidence and unresolved defects.

This review delivers findings and an implementation order. It changes no application behavior, database schema, financial formula or hosted record.
