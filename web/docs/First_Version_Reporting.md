# First-version roles and reporting

## Current number display policy ? 29 October 2026

Monetary amounts (including unit prices, ingredient costs, COGS, revenue, profit and inventory values) and percentages display exactly two decimal places. Quantities, yields, reserved/available stock and conversion quantities display exactly three. This supersedes earlier notes describing a uniform three-decimal display. The policy applies to tables, approval summaries, mobile cards and report CSV exports. Currency grouping uses exact decimal-string rounding, including large values; unknown evidence remains unavailable. Stored database precision, posting arithmetic and historical evidence are unchanged. Editable defaults remove only redundant padding and never silently round meaningful input digits.


This document supersedes earlier GM/production-role rollout recommendations. The owner authorized reporting in the first version, including sales import, COGS, gross profit, gross margin and food cost. The forest green and warm neutral interface remains.

## Roles

General Manager is retired. Existing GM appointments migrate to Operations Manager without deleting their audit history. Multiple different people can hold Operations Manager appointments; nobody can approve their own transaction. Operations Managers approve adjustments and other controlled transactions of any value, and can reopen closed periods with an audited reason. Finance reviews costs and prepares reconciliations, but cannot approve inventory adjustments unless separately appointed Operations Manager.

There is no Production Manager role. Kitchen production stays in the existing Kitchen workflow with scaled standard inputs and declared output. Administrator handles setup and access; it does not automatically grant stock posting, purchasing, financial reports or approval rights. Owner remains the oversight/team role. The owner can explicitly assign an additional Inventory, Procurement or Finance duty under Team and access. Extra duties do not bypass self-approval or department controls. Department working roles remain location-scoped. A separately assigned global Inventory/Finance duty intentionally grants its wider scope.

On 28 October 2026 the purchasing permission was tightened: preparing/submitting purchase orders and maintaining procurement masters require an explicit Procurement role/duty. Operations Manager appointments alone grant review, approval/rejection and controlled cancellation, without order creation. An Owner performing purchasing must explicitly hold the Procurement duty. The two-account test guide uses Owner + Procurement + Operations for account A and Storekeeper + Operations for account B; both accounts retain creator/approver separation.

Later on 28 October 2026 the owner simplified version-one PO receiving: Store acceptance against an approved purchase order posts inventory immediately. There is no second receipt-approval checkpoint. Approved quantities, frozen packs/prices, period checks, tenant scope, retries and immutable ledger evidence remain enforced. Receipt `posting_basis=approved_purchase_order` records the original PO as authority, `received_by` records the actual receiver and `approved_by` is left null rather than inventing a second approver. Existing unposted linked receipts require their original receiver to explicitly accept them; no saved drafts are automatically posted during migration. Direct receipts without an approved PO and other controlled transactions retain their independent approval workflow. Guide version 2.2 reflects this change.

## Sales evidence

The existing four-column sales CSV remains valid for stock depletion. The optional fifth column `net_sales` is the total net revenue for that source line, after discounts and excluding sales tax, in NGN. It is not unit price. Empty/missing revenue stays unavailable; explicit zero means an intentionally free line. Negative quantities/revenue and returns require a separately reviewed correction and are rejected by this importer; a refund must never automatically restore ingredients.

See `templates/sales-with-revenue-template.csv`. Replace its example codes with active menu mappings. Set each menu's sales category to Food, Beverage or Other before importing: preparation location alone does not define whether a sale is food. Revenue classification, recipe versions, source IDs, quantities and costs are retained with the sale. Re-imported posted POS line IDs cannot deplete stock twice.

Sales posting captures two separate costs: the carrying value of inventory deducted by standard quantities, and theoretical recipe cost using the ingredient costs effective at posting. Stocked semi-finished ingredients use their carrying value for stock depletion and recursive recipe cost for theoretical costing; they are not expanded and deducted a second time. Later purchases or recipe changes do not recompute those sale costs. Legacy posted sales without captured evidence are marked incomplete, rather than reconstructed using today's costs.

## Report measures

| Measure | Definition and readiness |
| --- | --- |
| Net sales | Sum of supplied net revenue for posted imported lines. Coverage is disclosed; complete POS coverage still requires a reconciliation. |
| Theoretical COGS | Captured standard recipe ingredient costs scaled to sales quantities. Missing costing evidence blocks the total. |
| Standard-quantity inventory depletion cost | Captured carrying value of the stock deducted for sales; this is not proof of measured consumption or accounting COGS. |
| Theoretical gross profit | Net sales minus theoretical COGS, when all posted imported lines have revenue and costs. |
| Theoretical gross margin | Theoretical gross profit / net sales × 100, only with a positive denominator. |
| Theoretical food cost % | Captured theoretical cost of Food-classified sales / corresponding net food sales × 100. Beverage and Other sales are excluded. |
| Finance-reconciled COGS | Finance/owner-supplied accounting cost supported by an identified reconciliation/schedule, matched to the report's POS line count and net revenue, independently approved by Operations. It is not automatically inferred from purchases, transfers or uncounted stock. |
| Gross profit / gross margin | Net sales minus approved Finance-reconciled COGS; divide by net sales for margin. Unreconciled figures remain unavailable. |
| Food cost / food cost % | Optional reconciled actual food cost, supported by the same evidence; divide by classified net food sales. Missing food classification or nonpositive revenue blocks the percentage. |
| Accepted purchase receipt value | Recorded receipt acquisition value, distinct from orders committed, invoices issued or cash paid. |
| Waste and count adjustments | Separate posted movement types. A count adjustment is not automatically recorded again as waste. Do not document the same loss twice. |

The supplied accounting amounts are evidence declarations, not a replacement for an accounting system, source document verification or external audit. No financial statement or actual consumption claim is inferred solely from approved software transactions.

## Periods, publication and trust

Reports support Daily, Monday–Sunday Weekly, Monthly and custom date ranges up to 367 days, with explicit dates and Africa/Lagos business dates. Periods use transaction business dates; automatic restaurant shift-cutoff scheduling is not included. Whole-business figures include stock in transit. Department reports expose authorized operational quantities, never company financial cards or saved financial snapshots.

Inventory opening and closing quantities/values come from immutable movement evidence up to the selected business-date cutoff, not current balance projections. Values retain posting-order weighted-average costs. A backdated event does not trigger historical cost restatement. Location values are allocated historical movement values, not a reconstruction at today's global average. The report exposes its observation timestamp and late entries.

Reconciliation is allowed only for completed business dates, with matching imported POS line count/net sales and no pending stock documents/counts in that period. Finance/owner prepares; a different Operations Manager approves. New or backdated source movements invalidate the matching reconciliation for live reports. Missing coverage remains partial.

Publication and completeness are separate: a partial report may be published with warnings. Published snapshots retain exact values, period/location filters, formula version, source fingerprint, source movement/document links, creator and observation/publication timestamps. Re-publication creates a new linked revision and mandatory reason. A new receipt or reconciliation cannot mutate an older snapshot. Live drafts show previous-period comparisons; historical snapshots retain their selected-period evidence.

CSV spreadsheet exports use saved snapshots, enforce Finance/Owner/Operations access and log export events. Formula-like spreadsheet text is escaped. Automated email distribution, PDF layouts and configurable reporting schedules remain later work.

## Counts and management follow-up

Count selected items at an authorized location, including zero, and save the physical results against an exact server cutoff/book quantity. Pause movements for those items while counting and until approval. The counter submits; a different Operations Manager approves. Intervening location movements block stale approval and require a new count. Positive/negative adjustments post at current inventory valuation, conserve audit history and never overwrite balances directly. A positive variance without an established inventory cost cannot post; controlled opening/receipt evidence is required first. A count of selected items is not a declaration that every SKU/location has been counted.

Management actions record finding/evidence, assigned owner, priority, due date and progress notes. Finance/Owner/Operations can create them; assignees can read and update their own actions. Progress changes never create inventory transactions or amend published figures. Actions remain visibly live alongside historical reports.

## Verification and remaining scope

Migrations 011–014 add explicit extra duties, retire GM, capture sales cost/revenue, introduce counts, protected reports/reconciliations and management actions. No dummy accounts, purchase orders, stock, sales, recipes or revenue are seeded in the hosted restaurant. Existing item IDs, imported reference prices and ledger history are preserved.

Isolated tests exercise exact COGS/margin golden values, incomplete/zero revenue, historical cost preservation, stale reconciliation, self-approval denial, scoped reads/exports, count cutoffs, retry safety and management action ownership. Browser tests cover revenue import through approval/reconciliation/publication/export and department count adjustment at phone and desktop widths.

Supplier invoice/payment workflows, approved transaction reversals, transfer-shortage settlement, configured reorder alerts, automatic schedules/shift closing and production release sign-off remain outside this increment. A full hosted operator walkthrough is still required before production use.

On 27 October 2026 migrations 011–014 were applied to the linked Supabase project. Hosted verification confirmed all eight new tables have RLS, no ordinary-client write grants exist, the four new public RPCs deny anonymous/service-role execution, published snapshots are immutable, no GM appointments remain and all 327 catalogue items are preserved. Anonymous API denial checks passed without reading restaurant financial records. Local verification passed 81 native PostgreSQL scenarios, 31 browser scenarios, three revenue CSV tests and three period-boundary tests, plus TypeScript, lint and the production build. Phone and desktop report previews were inspected. These checks do not replace a hosted operator walkthrough or production release sign-off.


## Sales approval review (29 October 2026)

Sales documents and the manager approval queue lead with imported sales, not ingredients. Document-scoped review shows date, reference, uploader, source system, locations, menu codes, sold quantities, unit net prices, net revenue, recipe COGS, gross profit and margin. Ingredient deductions are collapsed beneath the sales review. The same independent approval atomically records sales and posts corresponding stock deductions.

Before posting, recipe COGS and margin are estimates using the captured recipe version with current business-wide ingredient costs. After posting, costs come from immutable sales-cost evidence and ingredient details come from posted movements. Changing purchases cannot rewrite posted margins or displayed inventory costs. Finance-reconciled actual COGS remains separate. Unknown revenue or cost remains unavailable; zero revenue never produces a margin percentage. Warnings cover missing revenue/costs, unavailable stock after reservations, duplicate pending or posted source IDs, mapping changes, inactive locations/items, unsupported scaled precision and closed/future dates. Posting permissions and validation remain enforced by the existing atomic command.

The document-scoped financial summary is available to Finance, managers and explicitly authorized global stock operators who handle sales imports; it does not open business-wide financial reports or finance evidence tables to other roles. Department viewers retain their existing ingredient/location scope and receive no sales financial summary. No customer sales are posted by deploying this read-only review change.

Verification for migration 018: 88 native PostgreSQL scenarios (including 18 independent-session races), five inventory/reporting browser scenarios, TypeScript, lint and production build passed. Browser checks cover sales-first totals, missing revenue, collapsed ingredient details, three-decimal formatting, both approval routes and responsive layout. Hosted verification uses scripts/verify-sales-approval-summary.sql; deployment creates no customer transactions.


## Large sales batches (29 October 2026)

The shared sales review uses compact metadata and four batch totals, with a searchable, paginated sales list (15 rows by default; 30, 60 or 100 selectable). Multiple-location batches offer a location filter. The list has a bounded scroll area and sticky desktop headers. On phones, each sales line shows quantities, revenue, recipe COGS, gross profit and margin in a compact card. Source line IDs, unit net price and recipe-version details expand on demand. Ingredient deductions and detailed cost explanations remain secondary. Long warning lists show five entries initially with the remainder available on demand.

Searching, filtering and changing pages never changes the approval payload or batch totals. A visible note states that approval covers every imported line, including lines on other pages or hidden by filters. The actual approval command still receives only the original document ID. Existing accounting calculations, permissions and posted evidence are unchanged. The CSS loader excludes module styles so Next can scope and apply them correctly.

Large-batch verification passed all four reporting browser scenarios, including a 60-line import, page navigation and scroll reset, source-ID search, empty results, changing page size, CSS grid sizing at 1440px/375px, phone financial cards and approval while only one filtered line is visible. The posted batch retains all 60 rows and its full revenue/cost totals. Type checks, lint and production build passed. Test screenshots are under .tooling/previews/sales-sixty-1440.png and sales-sixty-375.png. No hosted sales or stock were changed.


## Focused sales review (29 October 2026)

Inventory now includes a Sales batches tab. Sales batches appear as compact rows with date, import reference, location, line count, net sales, status and uploader. Review opens /workspace/[organizationId]/sales/[documentId], where the batch has one header, short financial labels, sales lines, secondary inventory deductions and collapsed audit information. Sales imports open this page directly; submit, approve and reject return to the same page. The manager queue links to this shared review instead of embedding full sales details. Stock documents no longer embed sales reviews. Legacy document deep links for sales redirect to the focused route.

Search, location filtering, page-size selection and pagination are hidden for batches of 15 or fewer lines. Larger batches retain the existing controls and full-batch approval semantics. Singular line counts are corrected. Posted status is explained once, allowing the short labels Net sales, Recipe COGS, Recipe profit and Margin. No costing, authorization, SQL migration or accounting changes were required.

Focused-review verification: reporting browser scenarios passed, including one-line reviews without unnecessary controls, import-to-review navigation, approval queue links, unchanged full-batch approval under filtering, mobile batch cards, return navigation and unavailable-document screens. The inventory workflow checks passed with the new review links. TypeScript, lint and production build passed. Screenshot evidence: .tooling/previews/sales-focused-one-1440.png, sales-focused-one-375.png and sales-sixty-1440.png / sales-sixty-375.png. No hosted sales, approvals or stock were modified by this UI change.

Number-format verification: six formatter/report-period unit tests and all eight purchasing, inventory and reporting browser scenarios passed. Checks include exact two-decimal monetary cells, two-decimal margins, three-decimal quantities, mobile summaries and exported CSV values. Large-value and negative rounding checks passed without conversion through JavaScript Number. TypeScript, lint and production build passed. No database migration or customer transaction changes were made.


## Reports workspace layout (29 October 2026)

Reports now opens with a compact Overview. A four-cell financial strip shows net sales, Finance-reconciled COGS, gross profit with margin, and food cost with its percentage. Recipe benchmarks and purchasing/losses appear alongside one another on desktop. Supporting definitions and prior-period comparison expand on demand. Missing actual accounting evidence stays unavailable; no recipe-cost fallback is substituted.

The other report sections are Inventory details (cutoff balances and movement evidence), Finance review (submission, independent approval and reconciliation history), Actions (management follow-up) and Saved reports (publication history and CSV downloads). Section links preserve the chosen dates, cadence, location and saved-snapshot context. Date-filter submission stays in the selected section. Finance and saved-report sections are available only to roles with financial-report access. Reconciliation submission returns to Finance review, approval returns to Overview and publication returns to Saved reports. Money/percentages remain two decimals and quantities remain three. No report formulas, stored values, stock movements or historical snapshots were changed.

Report-layout verification passed the reporting browser suite, including reconciliation, immutable publication/CSV export, department visibility and large sales batches. The final mobile navigation and department-inventory checks passed again after label polish. TypeScript, lint and production build passed. Desktop/phone overview screenshots are .tooling/previews/report-overview-1440.png and report-overview-375.png. No hosted transactions, Finance evidence or report snapshots were modified.
