# Role workspaces, master data and procurement

The subsequent [first-version reporting increment](First_Version_Reporting.md) supersedes this document's GM approval and implicit Owner/Administrator stock/purchasing permissions, and adds counts and reporting. Earlier implementation details below record the state before that revision.

The 28 October receiving revision also supersedes the second receipt-approval step below: Store acceptance of an approved PO delivery now posts stock directly. See the first-version contract for current controls and compatibility with already-saved receiving drafts.

This increment adds separate daily workspaces for Procurement Officer, Storekeeper, Kitchen Lead, Bar Lead, Operations Manager, General Manager, Accountant and Viewer. Owner/Administrator workspaces retain setup and team controls. Manager appointments remain separate from working roles. Every action rechecks live database permissions; hiding a button is not the permission boundary.

## Master data

| Master | Storage and behavior |
| --- | --- |
| Items | Existing `items`: raw materials, semi-finished SKUs and general supplies; imported stock labels and reference prices preserved. |
| Final recipes | `final_recipe_master`, a view of final `recipes` and their latest immutable versions. Ingredient standards and current recipe costs remain in the existing engine. |
| Sub-recipes | `sub_recipe_master`, a view of versioned sub-recipes linked to semi-finished output SKUs. Production consumes standard Kitchen inputs scaled to the batch and adds declared output. |
| Vendors | `vendors`: stable supplier code, name, contacts and active status. Historical orders retain their vendor name snapshot. |
| Supplier items | `vendor_items`: supplier SKU, explicit purchase pack, measured stock-unit conversion and optional quote. Quotes never change inventory valuation or last purchase price. |
| Menu items | `menu_items`: POS code, final recipe, usual preparation area and active status. Sales capture recipe versions and original source codes. |
| Units | Existing fixed units and versioned item conversions. Supplier packaging is explicit; no bag/carton size or density is inferred. |
| Locations | Existing locations mapped to exactly Main Store, Kitchen and Bar operating areas. |
| People and periods | Live memberships, separate manager appointments and explicit open/closed inventory periods. |

Separate recipe views avoid maintaining two inconsistent copies of recipe definitions. The UI offers dedicated Final recipe and Sub-recipe screens under Master data.

## Purchase workflow

Procurement maintains vendors and supplier items, prepares an order in purchase units and submits it. A different Operations Manager or General Manager approves any value. An approved order moves no stock. Pack size, negotiated price and normalized stock-unit cost are frozen on its immutable order lines.

A different stock operator records actual accepted delivery against the approved order. Rejected quantities are documented and do not enter stock. Receiving drafts are submitted for independent manager approval. Posting atomically checks remaining order quantities, stock period and active records, then updates inventory movements, business-wide weighted average and latest posted purchase price. Multiple partial deliveries remain visible. Competing pending receiving drafts cannot over-receive when approved. Cancelling an order retains posted receipts and blocks outstanding drafts from posting.

Procurement alone cannot receive/post stock or approve transactions. The order creator cannot receive their own order. Accountants can review supplier and purchase records without editing. Supplier payments, invoices, tax calculations and price-variance approval rules are outside this increment; unexpected prices require a corrected order rather than silently changing an approved receipt cost.

## Department workflow

Kitchen/Bar prepares a Main Store requisition in stock units. An independent manager approves it. The Storekeeper dispatches available quantities within the approved outstanding demand; the original manager approval authorizes that dispatch, avoiding a second approval for identical quantities. The approving manager cannot dispatch it themselves, and their appointment must still be active.

New dispatches reserve quantities in Main Store without reducing its book balance. Acceptance posts matching source deductions and destination additions atomically, using the current business-wide weighted average. Receiving departments can partially accept or reject individual items. Undecided quantities stay pending; rejected quantities stay reserved until Store confirms their physical return. Confirmed returns release the reservation and reopen the corresponding request demand. Available-to-issue quantities exclude all reservations, including when approving consumption, waste, or another transfer. Requests and approvals do not reserve stock; dispatch does. Closing remaining demand preserves delivery obligations. Earlier dispatched transfers retain their original in-transit ledger and finish through compatible acceptance/return handling; no historic movements are rewritten. Source counts for reserved items are blocked until delivery obligations are resolved.

Department users read their own location's balances, relevant documents, movements and sales rows. They can read shared item/recipe costs but cannot read other departments' stock quantities or supplier contacts. A manager appointment grants the wider review scope. Mixed-location sales previews filter their lines for department viewers.

Waste at all three locations, Kitchen production and imported sales retain independent manager approval. Once menu mappings exist, sales imports must resolve active menu codes to final recipes. The import's explicit target location determines deduction. Existing historical recipe versions, one business-wide weighted average, live movement posting and period/backdating rules remain in effect.

## Team setup while testing

Owner/Administrator can generate an invitation from **Team and access** using an email and working role. No email is sent by this flow. Share the generated access code privately. The recipient signs in with that verified email, opens **Join business** and pastes the code. Codes expire, can be replaced/revoked, are stored as hashes and are never placed in page addresses. Replacing a code invalidates the old one. Suspended membership cannot be reactivated by an invitation. Only the owner appoints Operations/General Managers after they join.

Automated tests use fictitious identities in an isolated local fixture. No hosted fake accounts, vendors, stock, recipes or transactions are seeded by these migrations. Real operator testing will still require separate verified accounts; a single account cannot simulate independent approval.

## Implementation and verification

Migrations `20261027000800_roles_and_masters.sql`, `20261027000900_purchasing_and_requisitions.sql` and `20261027001000_department_read_scope.sql` add 12 RLS tables and security-invoker read views. Ordinary clients have read-only table access; authenticated command RPCs enforce mutations, strict payloads, idempotency, tenant locks and audit records. Anonymous/service-role access to these public mutation RPCs is denied.

Run `npm run db:test:native -- --types` for the foundation, inventory, catalogue and business scenarios plus independent-session races. Run `npm run test:ui` for authentication, locations, inventory, team onboarding and the multi-role procurement/request walkthrough. Browser fixtures emulate Auth locally and exercise actual SQL permissions; they do not prove hosted email delivery. `scripts/verify-business.sql` checks hosted metadata and aggregate catalogue preservation without printing user identities.

Remaining release work includes physical-count cutoff/adjustment screens, approved reversals, transfer-shortage resolution, supplier invoice/payment processing and a complete hosted operator walkthrough. Do not describe this development increment as a production release.

On 27 October 2026 all three migrations were applied to the linked Supabase project. Hosted checks confirmed all 12 new tables have RLS, no ordinary-client write grants exist, all four new public RPCs reject anonymous/service-role execution, Procurement roles are supported and all 327 catalogue items remain present. Public API denial checks passed. Local verification passed 72 native PostgreSQL scenarios (including 16 independent-session races), the existing 26 browser scenarios and two new multi-role/team browser scenarios, two CSV boundary tests, TypeScript, lint and the production build. The Kitchen stock screen was checked at 375px and 1440px; the phone view scrolls wide tables within their panel. This is development verification; no hosted staff accounts or restaurant transactions were fabricated.


On 28 October 2026, migration 017 changed transfer posting to department acceptance. Delivery acceptance, rejection, and returned-goods forms are available within Stock requests as well as Inventory documents. The actual dispatch operator cannot accept their own delivery; an approving manager may act as the independent receiver when testing combined duties. All displayed operational quantities, prices, costs, values and percentages use three decimal places; stored numeric precision, calculations, and immutable evidence retain their original precision. Editable defaults remove redundant padding without rounding meaningful digits.

Migration 017 verification: 87 native PostgreSQL scenarios (including 18 independent-session concurrency checks), seven relevant browser scenarios, TypeScript, lint and production build passed. Hosted metadata verification confirmed all reservation/decision helpers remain private, new views use security-invoker access, ordinary writes remain denied and all 328 catalogue items remain present. No restaurant transactions were created or accepted during deployment.
