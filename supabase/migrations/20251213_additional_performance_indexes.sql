-- ============================================
-- ADDITIONAL PERFORMANCE INDEXES
-- ============================================
--
-- These indexes address patterns identified in the December 2025 audit.
-- They complement the existing indexes in 20251209_performance_indexes.sql
--
-- Run: supabase db push
-- Or execute directly in Supabase SQL Editor

-- ============================================
-- ORDERS TABLE: Restoration Filtering
-- ============================================

-- Index for non-restoration orders (used when excluding restoration SKUs)
-- Used by: metrics API when filtering out restoration items
-- The is_restoration column is frequently filtered in WHERE clauses
DROP INDEX IF EXISTS idx_orders_restoration_false;
CREATE INDEX idx_orders_restoration_false
ON orders (warehouse, fulfillment_status, canceled)
WHERE is_restoration = false;

-- Optimized unfulfilled queue index with restoration filter
-- Used by: metrics API unfulfilled queue counts
-- This specifically targets the common query pattern:
--   WHERE fulfillment_status IS NULL AND canceled = false AND is_restoration = false
DROP INDEX IF EXISTS idx_orders_unfulfilled_queue;
CREATE INDEX idx_orders_unfulfilled_queue
ON orders (warehouse)
WHERE fulfillment_status IS NULL AND canceled = false AND is_restoration = false;

-- ============================================
-- B2B_FULFILLED TABLE: Active Records by Date
-- ============================================

-- Index for active B2B records (non-cancelled) with date filtering
-- Used by: wholesale API SKU aggregation, Top SKUs queries
-- Filters: cancelled_at IS NULL (common exclusion)
DROP INDEX IF EXISTS idx_b2b_active_by_date;
CREATE INDEX idx_b2b_active_by_date
ON b2b_fulfilled (created_at, sku)
WHERE cancelled_at IS NULL;

-- ============================================
-- VERIFICATION QUERIES (optional, for testing)
-- ============================================
-- After running this migration, you can verify with:
--
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename IN ('orders', 'b2b_fulfilled')
-- AND indexname LIKE '%restoration%' OR indexname LIKE '%unfulfilled_queue%' OR indexname LIKE '%active_by_date%';
--
-- ============================================
