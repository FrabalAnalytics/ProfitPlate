# ProfitPlate operational contract — 1.0

The subsequent [first-version reporting contract](First_Version_Reporting.md) supersedes General Manager references: Operations Managers approve controlled transactions and reopen periods; no self-approval is allowed. It also documents separate Administrator duties, counts and approved adjustments, first-version reporting, net sales evidence and metric readiness.

Confirmed by the owner on 27 October 2026. This supersedes the earlier MVP exclusion of production and sales consumption. Implement incrementally; an approved requirement is not evidence that its screen is available.

## Confirmed operating rules

- Three operating areas: Main Store, Kitchen, Bar. Reuse the existing Kitchen; never erase other customer records to enforce a number.
- Items: raw_material, semi_finished, general. General supplies are consumed through explicit usage, not recipes.
- Immutable recipe versions: final recipes can contain raw ingredients and stocked sub-recipes. Each stocked sub-recipe produces one semi-finished SKU. No cycles. A stocked intermediate is consumed once, without expanding it again at sale time.
- Production deducts standard recipe quantities scaled to planned output; actual declared output increases Kitchen semi-finished stock. Expected and actual output are retained. Inputs and output commit together.
- Posted sales imports deplete the specified Kitchen/Bar. Stable source-system and source-line identities prevent repeated depletion. Import is previewed and approved; malformed, unmapped, duplicated, or insufficient-stock batches do not partially post. Refunds do not automatically restore ingredients.
- Waste is supported at Main Store, Kitchen and Bar; reason, quantity and event date are mandatory. Pending waste is visible but does not alter the ledger before approval.
- Business-wide moving weighted average per stock item. Current recipe costs roll up current procurement ingredient averages through stocked sub-recipes. Missing costs are incomplete, never silently zero. Historical movement costs remain unchanged.
- Operations Manager or General Manager can approve controlled transactions of any value. They are explicit operational appointments attached to active memberships, not automatically inferred from owner/admin status. Creators cannot approve their own documents. A separate eligible manager must act; an owner has no hidden self-approval bypass.
- Backdated documents in open periods require manager approval and a reason. Closed periods block posting. Only a General Manager can reopen a period, with a reason and audit event.
- Every posted opening, receipt, dispatch, confirmation, production input/output, sale, usage, waste, adjustment and reversal produces immutable movements and synchronous balances. No negative available quantities. Retries do not double-post.

## Posting and valuation details

Quantities use base units with six decimal places; unit costs use eight; values use eight, with PostgreSQL numeric arithmetic and explicit rounding. Boundary input is plain decimal strings, never exponent notation or client floating point calculations. Versioned recipe lines use base-unit quantities. Pack purchasing must be normalized through a separately validated pack/conversion workflow before it reaches posting; arbitrary bags/cartons are not inferred.

Inventory unit cost is the explicitly entered inventory acquisition cost. No tax percentage, recoverability, supplier payment, or general-ledger treatment is inferred. An accountant-approved tax policy is needed before automating tax composition. This slice does not process supplier payments.

New receipts blend cost into business-wide remaining quantity/value. Internal transfers move quantity without changing business-wide quantity/value. Dispatch creates in-transit stock; receipt moves it to the destination. Production consumes inputs at current inventory averages and blends their total into the output SKU using actual output. Live recipe costs recursively use current ingredient averages; the historical cost of already produced semi-finished inventory is a separate figure.

The ledger is authoritative; synchronous balance and cost state are projections changed in the same database transaction. Organization locks serialize postings, approvals, period changes and operational appointments. All identities come from verified Auth and live membership. Foreign IDs fail under composite tenant references and RPC checks. Ordinary clients receive read-only tables and narrow command RPCs, not ledger-write privileges.

Event date is the physical/business date in Africa/Lagos. Posting time is actual server time. This first implementation uses posting-order weighted average: approving a backdated document does not silently recalculate old costs. Reports must expose both dates; event-date quantity reporting must not be labelled a historical restated valuation. A future restatement engine requires its own reviewed contract.

Periods are explicit nonoverlapping date ranges. Posting requires a configured open period. Closing/reopening does not change existing entries. All controlled documents require independent manager approval in this first operational increment; automatic receipt/production exception tolerances are deferred until explicitly defined.

## Document lifecycle

Draft → Submitted → Posted, or Submitted → Rejected. Approval and posting are one atomic operation. Draft contents are immutable in this first increment; create a corrected draft if rejected. A transfer becomes Dispatched on approval, then Received after recipient acknowledgement. Requisitions and purchase orders authorize intent but never create stock movements; receipt/transfer documents must explicitly execute fulfilment. Partial fulfilment must remain visible rather than silently closing a request.

Counts require a stable cutoff/snapshot before they can generate controlled adjustments. An arbitrary balance overwrite is forbidden. Reversals must reference original entries, be independently approved and preserve historical cost links. A workflow is not available until its command, tests and UI are present; no generic adjustment is presented as a completed physical-count or reversal workflow.

## Delivery gates

1. Operational roles, item categories, three-area setup, periods, approval records and immutable recipe versions.
2. Atomic stock posting: openings, receipts, transfer/in-transit, waste/usage, production and validated sales batches; current recipe costs and movement history.
3. Usable screens and import preview, independent approval queue, discrepancy handling, counts/reversals, team invitation delivery and permission QA.
4. Full isolated PostgreSQL concurrency tests, browser tests, hosted migration/permission verification and a real operator walkthrough before production release.

No automatic stock baseline or synthetic production/sales records may be created in the user's restaurant. No claim of complete operational readiness may be made solely from database tests.

## Implemented first operational increment

The first-increment description below is historical. The subsequent [role workspaces and procurement increment](Role_Workspaces_and_Procurement.md) implements purchasing, requisition fulfilment, manual team onboarding, separate recipe masters and department read scopes. Physical counts, adjustments/reversals and production release sign-off remain pending.

Migrations `20261027000300_operational_controls.sql`, `20261027000400_inventory_engine.sql` and `20261027000500_inventory_read_models.sql` are additive. They preserve existing location/item IDs and introduce 14 RLS-protected tables, two security-invoker read views and four authenticated-only public RPCs. Item categories are immutable. Foundational ownership/admin roles are unchanged; operational managers are separate appointments, made/removed only by the owner. A role appointment does not invent a second authenticated person.

The Inventory workspace provides Items, Stock on hand, Movements, Recipes, Documents & approvals, Sales import and Operating controls. Setup creates only missing operating locations and reuses a matching existing Kitchen. If names are ambiguous, the owner chooses exact existing locations manually. Area remapping is blocked after movement posting. There is no synthetic opening stock.

The document forms cover opening stock, direct receipts, transfers, production, waste and general-supply usage. Creators save and submit immutable drafts. A different Operations/General Manager reviews item-level quantities/costs and approves/posts atomically. Rejection retains evidence and requires a corrected new draft. Transfers support partial receipts, outstanding transit and receipt retry protection. Posting checks current period, active locations/items, live authority and sufficient stock at commit.

CSV sales import accepts exactly `external_id,menu_code,quantity,location`, at most 500 lines/200 KB, for one business date. Quoting, escaped quotes and CRLF are supported. Preview shows source rows; server validation maps final-recipe codes and unambiguous active location names/codes. The draft exposes ingredient deductions before submission/independent approval. Source-system IDs are normalized uppercase; source-line IDs are preserved exactly. Unposted/rejected drafts do not permanently reserve POS line IDs; successfully posted source keys are unique across the business. No refund automatically restores ingredients.

Quantities/costs are returned as exact strings in stock/movement views. Stock changes are synchronous on posting. Visible stock/movement pages refresh every 15 seconds; this is periodic refresh, not an offline queue or WebSocket guarantee. Transfer legs retain dispatch cost. Production output retains exactly the total input value even where division by actual yield rounds the displayed unit cost.

Remaining outside this increment: PO/requisition fulfilment documents, physical-count cutoff capture, approved adjustments/reversals, transfer-shortage resolution, supplier/tax automation, arbitrary pack purchase units, XLSX import, team invitation delivery/acceptance UI and production release sign-off. These features must not be described as complete. Existing controlled invitation RPCs remain available; manager appointment currently requires an already active verified business member. Do not bypass independent approval to work around missing team onboarding. This UI is for a controlled test walkthrough, not a complete restaurant operating-cycle release.

## Verification and recovery

`npm run inventory:test` runs real PostgreSQL/PGlite scenarios. `npm run db:test:native -- --types` also runs foundation scenarios and independent-session races in disposable native PostgreSQL, then regenerates Supabase types. `npm run inventory:csv:test` validates malformed/quoted/duplicate/oversized CSV boundaries. `npm run test:ui` includes a two-user walkthrough of operating-area reuse, manager appointment, categories, opening approval, production, sales import and resulting balances, with 375/1440px screenshots. Fixtures never contact hosted Auth or write hosted stock.

Apply after clean native tests and build/browser verification. Use `supabase db push --linked --dry-run` to inspect pending migrations and `scripts/verify-inventory.sql` for read-only hosted privilege/RLS verification. No destructive reset is required. On deployment trouble, hide Inventory navigation and deploy a forward fix; retain tables and movement evidence. Never recover by deleting posted ledger rows or dropping tables with history. Existing authentication/location workflows remain available.

On 27 October 2026 all three migrations were applied to the linked Supabase project. Read-only hosted checks confirmed all 14 tables have RLS, ordinary clients have SELECT-only table grants, and all four public inventory RPCs deny anonymous/service-role execution. Native PostgreSQL verification passed 28 foundation cases, 14 inventory cases, eight foundation races and six inventory races. The existing 24 authentication/location browser cases passed; the new two-user inventory walkthrough passed a focused rerun after making file selection wait until its client preview handler is ready. CSV validation tests, production build and lint passed. This is development verification, not release sign-off or a hosted full-cycle operator test.

The owner confirmed this remains test work; real staff accounts are not available. Automated approval tests use separate fictitious identities solely inside the disposable loopback fixture. No real manager appointment, invitation delivery, or hosted stock posting was made during implementation.

## Last purchase price and SKU sheet intake

Migration `20261027000600_last_purchase_price.sql` adds a security-invoker item view and appends last-purchase fields to the balance view. Items and Stock on hand show the latest approved/posted receipt unit cost per base unit across the business. "Latest" means purchase event date, followed by posting time and document ID for deterministic ties; an older backdated purchase cannot displace a newer dated purchase. Openings, drafts, rejected receipts, transfers and production are excluded. Explicit zero purchase prices remain zero; missing prices are not substituted with average cost. Semi-finished items display "Produced in-house". Existing prices and ledger records are not edited by this migration.

SKU sheets can be supplied as XLSX or CSV. Map SKU, item name, category and base unit; validate unique canonical names/SKUs, existing-item collisions, the three categories and supported base units before invoking authenticated, audited creation commands. See `templates/inventory-sku-template.csv`. No workbook has been supplied or imported yet. Purchase prices, pack definitions and opening quantities require separate source validation; a catalogue import must not fabricate purchase receipts or opening stock.

Subsequently, `LIST.xlsx` was supplied and its 326 rows imported through migration `20261027000700`'s validated catalogue-import command. See [the import report](Catalogue_Import_LIST_2026-10-27.md). Imported price provenance, unknown zeros, legacy semi-finished costs and counted-unit labels are preserved without inventing stock. Receipt prices take precedence. The preceding paragraph records the state before this workbook arrived.
