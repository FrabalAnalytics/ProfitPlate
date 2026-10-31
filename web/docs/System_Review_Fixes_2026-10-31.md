# System review fixes — 31 October 2026

This implements the changes recommended by [the overall review](System_Review_2026-10-31.md). The original report and reproduction evidence are retained as the baseline.

## Result

Approvals now read complete, counted evidence for their selected transactions. Orders, requests and counts use compact, searchable table indexes and focused detail pages. Stock, movements, recipes and document indexes have server pagination; master-data and detail tables share sorting, search, row pagination and responsive phone cards.

Financial date controls distinguish standard cycles from custom ranges and keep validation within Reports. Item maintenance, inspectable recipe versions and a scoped audit workspace complete previously missing workflows. Posted accounting calculations and existing SQL permissions remain unchanged.

## Findings addressed

| Review ID | Implemented change |
| --- | --- |
| R01 | `readAll` requests exact counts and reads successive ranges below the API cap. Missing, failed or changing count evidence returns no actionable rows. Approval children are scoped to selected parents; order lines also reconcile to the authoritative summary line count. Counts and requests reject empty detail reads for existing records. |
| R02 | Stable server pagination, search and status filters for operational indexes; durable order/request/count links; pagination for report revisions, reconciliations and management actions. Hard limits were removed from option/master/history collections in favor of counted range reads. |
| R03 | A full single calendar month compares with the preceding calendar month. Other custom ranges use an equal number of days ending before the selected start, including multi-month and annual ranges. Comparisons no longer overlap the selected period. |
| R04 | Daily, Weekly, Monthly and Custom range are explicit modes. Standard modes ignore retained custom end dates and derive their own boundaries. |
| R05 | Invalid, reversed or overlong dates show an inline error beside retained report controls, including directly entered URLs. |
| R06 | Shared tables align numbers to the right, use tabular digits, name their regions, support keyboard sorting, keep headers and record identity visible during desktop scrolling, and render labeled cards on phones. Sorting uses exact scaled integers for decimal strings. |
| R07 | Item detail/edit supports names, SKU and active status through the existing audited `update_item` command. Base unit/category/tenant identity are not exposed as editable fields. Only roles accepted by that command see the editing form. |
| R08 | Recipe detail shows yield, complete ingredient quantities, current cost completeness and immutable version history. Revision copies the selected definition, preserving exact editable decimal strings. The empty global revision form was replaced with a link to recipe details. |
| R09 | Audit history uses the existing scoped search RPC with actor, action, record/type, Lagos dates and stable cursor paging. Actor labels and links to supported record types make changes traceable. |
| R10 | Master sections have active states; recipe variants and new detail pages retain their Inventory context. Operational and business-record links are grouped. Queue counts link to work, and inapplicable Sales import/control shortcuts are omitted for department roles. Detail back links retain list filters and page. |
| R11 | Completed setup collapses into a compact business-details disclosure. Daily shortcuts include explicit additional duties and audit access, while queue counts remain role scoped. |
| R12 | List pages avoid fetching every transaction's children; detail pages load complete selected records. Report sections load their own supporting collections and only Overview requests a comparison. Recipe lists link to one selected cost/detail read instead of issuing a cost RPC for every listed recipe. Supplier mappings load for the selected supplier. Production-only recipe data loads when needed. |
| R13 | CI runs every unit-test file, including number formatting, period boundaries and complete-read regressions. Browser QA now owns and cleans up its exact local server processes rather than leaving Windows shell children running. |
| R14 | Table/body/help/navigation text uses a more readable scale, with visible focus, bounded desktop tables and phone sort controls. This is not a claim of full accessibility conformance. |
| R15 | Removed broken separators/replacement punctuation, corrected singular item wording and replaced test-user language in product instructions. Manual invitation delivery remains explicit. |

## Verification

- Production build, including TypeScript: passed.
- ESLint: passed.
- Unit tests: 17 passed, covering decimal display, exact currency/quantity sorting, display-date ordering, CSV validation, report boundaries/mode changes, overlapping-period regressions, API row caps, incomplete reads and changing evidence counts.
- Native PostgreSQL scenarios: 88 passed, including 18 independent-session concurrency races. No hosted data was used.
- Final browser run: **36 passed in 5.1 minutes**, with a clean runner exit. The focused cases exercise a 200-line order after more than 1,000 historical lines, 51-order discovery, injected incomplete details, report-mode changes, recoverable invalid dates, phone stock cards, item lifecycle, exact copied recipe quantities, immutable old versions and audit denial/filtering.

Existing browser workflows were updated to open orders, requests and counts from their compact indexes. Authorization and self-approval assertions remain in place. The new runner also refuses to start if a required local port is already occupied; it does not stop unrelated applications.

After removing duplicate table controls from server-paginated indexes, all 10 affected purchasing, reporting and review-regression browser cases passed again in 2.7 minutes. Final evidence includes the [purchasing index](reviews/2026-10-31/fixed-purchasing-index-1440.png), [complete approval](reviews/2026-10-31/fixed-approval-1440.png) and [phone stock layout](reviews/2026-10-31/fixed-stock-375.png).

## Deployment and remaining checks

These are application and test-tooling changes. No new SQL migration is required; the target still needs the existing migration history through 018. No hosted records, credentials or deployment settings were changed.

Before release, perform the hosted operator walkthrough, verify actual Auth/PostgREST behavior and deployed schema parity, and measure production latency with realistic data/network conditions. The local fixture now enforces a 1,000-row API cap but does not replace hosted integration evidence. Full assistive-technology/accessibility validation and production restore verification remain release checks.

Previously excluded accounting features—approved transaction reversals, invoice/payment workflows, transfer-shortage settlement, reorder alerts and scheduling—remain separate release-scope decisions. This work does not invent a correction procedure or mutate historical accounting evidence.
