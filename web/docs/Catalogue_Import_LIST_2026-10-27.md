# LIST.xlsx catalogue import — 27 October 2026

Imported into **ProfitPlate Test Kitchen**. Source SHA-256: `d11801130429e065c5e8d29ab96e8e49b57fa9ef6c1355556cd77cd4f0399386`.

| Category | New SKUs |
| --- | ---: |
| Raw material | 252 |
| Semi-finished | 30 |
| General supply | 44 |
| Total imported | 326 |

The existing `RAW-001` Fresh Tomatoes item was preserved; the business now has 327 items. There were no duplicate SKUs/names inside the workbook and no conflicting existing identities. No items were overwritten, merged or removed. Source workbook unchanged.

## Units and reference prices

Mapped LTR→l, ML→ml, Gram→g, Kg→kg. Counted units retain their meaning: piece, bottle, pack, roll, can, bag, finger, portion and wrap. The canonical count base is `each`, with an immutable stock-unit label displayed in the catalogue, recipe choices, stock, document previews and movement history. One pack remains one pack; no pack-to-piece or bottle-to-ml conversion was inferred from item names.

Column E had no header and was interpreted as the price column from the supplied template/context. All 326 date cells resolve to **20 October 2026**. Original Excel date serials and raw price strings are preserved alongside normalized references. Thirteen Excel binary-decimal artifacts were normalized to eight decimal places with original values retained.

Raw/general positive prices are explicitly labelled **Imported reference**. There are 281 positive purchase references. These do not create receipts, stock quantities, valuation balances or average costs. A subsequently posted approved receipt takes precedence over a reference. All 30 semi-finished reference amounts are preserved as legacy production references; they are not presented as supplier purchase prices and do not replace recipe or production costing.

## Values needing review

Fourteen zero values are preserved as **zero_unconfirmed**, displayed as **Unconfirmed (0)** for purchased items, rather than silently treating them as free materials. Two prices are missing:

| SKU | Item |
| --- | --- |
| RM-058 | Coconut cream |
| RM-237 | Ugba |

The zero-price SKUs are GS-014, GS-019, GS-030, RM-021, RM-034, RM-094, RM-151, RM-153, RM-155, RM-156, RM-157, RM-165, RM-173 and SF-029.

`RM-173` includes the description “Mozzarella Cheese (1000 Kg Per Kg)”. Its original name is retained and the suspicious packaging text is flagged; no conversion was created from it.

The full normalized catalogue and 31 review notes are retained locally in `.tooling/catalogue-imports/list/validated.csv` and `report.json`. The source-row archive remains in Supabase's RLS-protected, append-only catalogue import tables.

## Audit, verification and recovery

The import used the narrowly scoped database-maintenance path under the authenticated Supabase management connection, with `import_origin=database_maintenance`, the actual database session role, and no fabricated Auth actor. Ordinary authenticated imports require current inventory-editing permission and record their real Auth actor. Anonymous and service-role API imports are denied.

One guarded transaction locked the exact target business, imported all rows, and verified fingerprints of all pre-existing documents, lines, movements, balances, cost state, transit and sales evidence were unchanged. It also checked every existing item remained identical. The exact same guarded SQL was first tested twice in disposable PostgreSQL; re-execution does not duplicate items or the import batch.

Validation passed against the actual 326-row manifest, catalogue permission/idempotency/price tests, the native foundation/inventory/concurrency suites, production build, lint, and two browser workflows covering reference labels, counted units, approvals, production and sales. No staff accounts were created or appointed. Do not recover by deleting ledger records or pretending the import was a supplier receipt. Review the source-row archive before correcting catalogue identities; stock identities remain immutable.
