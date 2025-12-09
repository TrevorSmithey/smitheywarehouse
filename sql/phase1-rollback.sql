
-- =============================================
-- ROLLBACK: Run if issues occur
-- =============================================

-- Drop function
DROP FUNCTION IF EXISTS get_budget_actuals(TIMESTAMPTZ, TIMESTAMPTZ);

-- Drop indexes
DROP INDEX CONCURRENTLY IF EXISTS idx_line_items_order_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_line_items_sku_lower;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_created_at_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_fulfilled_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_warehouse_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_b2b_fulfilled_date;
