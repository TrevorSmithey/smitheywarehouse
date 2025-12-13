# Deprecated Scripts

This document tracks scripts that are no longer needed for regular operations.
These should be reviewed periodically and removed when confirmed obsolete.

## One-Time Migration Scripts (Safe to Delete)
These were used for specific data migrations and are no longer needed:

- `apply-sku-migration.ts` - SKU casing migration (completed Dec 2025)
- `apply-sku-migration-direct.ts` - Direct DB migration variant
- `backfill-2025-orders.ts` - One-time 2025 order backfill
- `backfill-customer-data-v2.ts` - Customer data backfill
- `backfill-delivery-state.ts` - Delivery state backfill
- `backfill-reamaze.ts` - Re:amaze ticket backfill
- `phase1-migration.ts` - Phase 1 data migration
- `migrate-support-tickets.ts` - Ticket migration
- `add-customer-columns.ts` - Schema migration (now in Supabase migrations)
- `fix-sku-casing-db.ts` - SKU casing fixes
- `fix-data-integrity.ts` - Data integrity fixes
- `fix-inventory-duplicates.ts` - Duplicate cleanup
- `fix-product-duplicates.ts` - Product duplicate cleanup
- `cleanup-bad-skus.ts` - Bad SKU cleanup
- `normalize-categories.ts` - Category normalization
- `reclassify-failed.ts` - Failed classification retry
- `resync-dec-b2b.ts` - December B2B resync
- `full-resync-b2b-2025.ts` - 2025 B2B full resync

## Debugging/Investigation Scripts (Archive Candidates)
These were created for debugging specific issues:

- `investigate-gap.ts` - Data gap investigation
- `investigate-today.ts` - Today's data investigation
- `investigate-b2b-gap.ts` - B2B gap investigation
- `investigate-cast-iron.ts` - Cast iron SKU investigation
- `check-cancelled.ts` - Cancelled order check
- `check-classification.ts` - Classification check
- `check-engraving.ts` - Engraving check
- `check-split.ts` - Split order check
- `check-dutch5.ts` - Dutch5 SKU check
- `check-missing-b2b-pos.ts` - Missing B2B POS check
- `check-missing-skus.ts` - Missing SKU check
- `check-negative.ts` - Negative inventory check
- `check-shopify-order.ts` - Shopify order check
- `check-sku-order.ts` - SKU order check
- `check-table.ts` - Table structure check
- `check-today-shopify.ts` - Today's Shopify check
- `check-today-sync.ts` - Today's sync check
- `check-b2b-shopify.ts` - B2B Shopify check
- `check-line-items-case.ts` - Line items casing check
- `compare-boundaries.ts` - Date boundary comparison
- `compare-excel.ts` - Excel comparison
- `compare-excel-actual.ts` - Excel vs actual comparison
- `compare-excel-cancelled.ts` - Cancelled order Excel comparison
- `compare-shopify-supabase.ts` - Shopify vs Supabase comparison
- `find-case-duplicates.ts` - Case duplicate finder
- `find-inventory-mismatches.ts` - Inventory mismatch finder
- `find-missing.ts` - Missing data finder
- `find-missing-orders.ts` - Missing orders finder
- `find-sku-duplicates.ts` - SKU duplicate finder
- `order-count-check.ts` - Order count verification
- `status-mismatch.ts` - Status mismatch check
- `reverse-mismatch.ts` - Reverse mismatch check
- `verify-calculations.ts` - Calculation verification
- `verify-canceled.ts` - Cancelled verification
- `verify-utc-fix.ts` - UTC fix verification
- `final-check.ts` - Final verification

## Audit Scripts (May Still Be Useful)
These provide data quality insights:

- `audit.ts` - General audit
- `audit-all.js` - Comprehensive audit
- `audit-b2b-dec.ts` - December B2B audit
- `audit-b2b-system.ts` - B2B system audit
- `audit-budgeted-only.ts` - Budget audit
- `audit-mtd-tickets.ts` - MTD ticket audit
- `audit-rpc-vs-fallback.ts` - RPC audit
- `audit-sku-casing.ts` - SKU casing audit
- `audit-supabase.ts` - Supabase audit

## Utility Scripts (Keep)
These are still useful for operations:

- `sync-inventory.ts` - Manual inventory sync
- `sync-b2b.ts` - Manual B2B sync
- `sync-holiday-tracking.ts` - Manual holiday sync
- `sync-channel-budgets.ts` - Channel budget sync
- `sync-assembly-tracking.ts` - Assembly tracking sync
- `bootstrap.ts` - Initial data bootstrap
- `bootstrap-tracking.ts` - Tracking bootstrap
- `bootstrap-assembly.ts` - Assembly bootstrap
- `seed-products.ts` - Product seeding
- `import-forecasts.ts` - Forecast import
- `import-tickets-from-excel.ts` - Ticket import
- `setup-forecasts-table.ts` - Forecasts table setup
- `setup-budgets-table.ts` - Budgets table setup
- `create-tickets-table.ts` - Tickets table setup
- `analyze-tickets.ts` - Ticket analysis
- `analyze-excel.ts` - Excel analysis

## Recommendation

1. Create a `scripts/deprecated/` folder and move one-time migration scripts there
2. Keep audit and utility scripts in main scripts folder
3. Consider removing investigation scripts after archiving
