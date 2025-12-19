-- ============================================================================
-- DATABASE OPTIMIZATION MIGRATION (Conservative)
-- Generated from comprehensive audit on 2025-12-19
--
-- NOTE: Indexes preserved for future use per user request
-- Focus: sync_logs cleanup, duplicate function removal, stats update
-- ============================================================================

-- ============================================================================
-- PHASE 1: CLEANUP SYNC_LOGS (retain only 7 days)
-- Currently 318K rows, 81 MB - mostly D2C logging every record
-- ============================================================================

-- Delete old sync logs (retain 7 days)
DELETE FROM sync_logs
WHERE started_at < NOW() - INTERVAL '7 days';

-- Add a policy comment
COMMENT ON TABLE sync_logs IS 'Sync job execution history. Retained for 7 days. Run cleanup_old_sync_logs() periodically.';

-- Update cleanup function to be more aggressive
CREATE OR REPLACE FUNCTION cleanup_old_sync_logs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM sync_logs
  WHERE started_at < NOW() - INTERVAL '7 days';
END;
$$;

-- ============================================================================
-- PHASE 2: REMOVE DUPLICATE LOCKING FUNCTIONS
-- Keep cron_lock functions (table-based), remove sync_lock functions (advisory)
-- ============================================================================

-- Drop old advisory lock functions (we use table-based now)
DROP FUNCTION IF EXISTS acquire_sync_lock(text);
DROP FUNCTION IF EXISTS release_sync_lock(text);
DROP FUNCTION IF EXISTS cleanup_old_lock_logs();

-- Drop the sync_lock_log table (no longer needed)
DROP TABLE IF EXISTS sync_lock_log;

-- ============================================================================
-- PHASE 3: ANALYZE TABLES TO UPDATE STATISTICS
-- pg_stat estimates were stale (showing wrong row counts)
-- ============================================================================

ANALYZE orders;
ANALYZE line_items;
ANALYZE shopify_customers;
ANALYZE shipments;
ANALYZE ns_wholesale_customers;
ANALYZE ns_wholesale_transactions;
ANALYZE ns_wholesale_line_items;
ANALYZE sync_logs;
ANALYZE b2b_fulfilled;
ANALYZE b2b_draft_orders;
ANALYZE inventory;
ANALYZE support_tickets;
ANALYZE abandoned_checkouts;
ANALYZE typeform_leads;

-- ============================================================================
-- FUTURE INDEX CLEANUP (preserved for reference)
-- ============================================================================
-- The following indexes were identified as unused or duplicate.
-- They are preserved but documented here for future cleanup if needed:
--
-- NEVER SCANNED (335 MB total):
-- - idx_shopify_customers_email (30 MB)
-- - idx_orders_total_price (23 MB)
-- - idx_shopify_customers_total_spent (23 MB)
-- - idx_orders_analytics_main (23 MB)
-- - idx_shopify_customers_shopify_created (17 MB)
-- - idx_shopify_customers_last_order (14 MB)
-- - idx_orders_discount (13 MB)
-- - idx_line_items_sku (12 MB)
-- - idx_shipments_order_id (11 MB)
-- ... and 40+ more
--
-- DUPLICATE PAIRS (60+ pairs):
-- - idx_orders_warehouse duplicates idx_orders_warehouse_status
-- - idx_cron_locks_expires duplicates idx_cron_locks_expires_at
-- - idx_ns_wholesale_customers_health duplicates idx_ns_wholesale_customers_health_status
-- ... and many more
--
-- Run this query to see current index usage:
-- SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
-- FROM pg_stat_user_indexes WHERE schemaname = 'public' ORDER BY idx_scan, pg_relation_size(indexrelid) DESC;
