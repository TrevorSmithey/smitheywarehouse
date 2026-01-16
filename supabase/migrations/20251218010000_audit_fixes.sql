-- ============================================================================
-- Audit Fixes Migration
-- Addresses issues identified in production readiness audit
-- ============================================================================

-- ============================================================================
-- 1. B2B Draft Orders: Add sync_batch_id for atomic sync
-- Prevents race condition where truncate+insert could leave empty table
-- ============================================================================
ALTER TABLE b2b_draft_orders 
ADD COLUMN IF NOT EXISTS sync_batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_b2b_draft_orders_sync_batch 
ON b2b_draft_orders(sync_batch_id);

COMMENT ON COLUMN b2b_draft_orders.sync_batch_id IS 'Batch ID for atomic sync - old batches are deleted after new batch is inserted';

-- ============================================================================
-- 2. Wholesale Customer Indexes for Common Query Patterns
-- Dashboard queries filter/sort by these computed fields
-- ============================================================================

-- Index for revenue sorting (most common sort)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_lifetime_revenue 
ON ns_wholesale_customers(lifetime_revenue DESC NULLS LAST);

-- Index for health status filtering
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_health_status 
ON ns_wholesale_customers(health_status) WHERE health_status IS NOT NULL;

-- Index for corporate customer filtering
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_is_corporate 
ON ns_wholesale_customers(is_corporate_gifting) WHERE is_corporate_gifting = true;

-- Index for segment filtering
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_segment 
ON ns_wholesale_customers(segment) WHERE segment IS NOT NULL;

-- Composite index for the common dashboard query: active customers sorted by revenue
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_active_by_revenue 
ON ns_wholesale_customers(lifetime_revenue DESC) 
WHERE is_excluded IS NOT TRUE;

-- Index for YTD revenue (common metric)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_ytd_revenue 
ON ns_wholesale_customers(ytd_revenue DESC NULLS LAST);

-- Index for days since last order (health calculations)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_days_since 
ON ns_wholesale_customers(days_since_last_order) 
WHERE days_since_last_order IS NOT NULL;

-- ============================================================================
-- 3. Metrics Staleness Detection
-- Track when customer metrics were last computed
-- ============================================================================
ALTER TABLE ns_wholesale_customers 
ADD COLUMN IF NOT EXISTS metrics_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN ns_wholesale_customers.metrics_computed_at IS 'When customer metrics (health_status, segment, revenue) were last computed';

-- View to identify stale customer metrics (not updated in 25+ hours)
CREATE OR REPLACE VIEW ns_wholesale_stale_metrics AS
SELECT 
  ns_customer_id,
  company_name,
  metrics_computed_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - metrics_computed_at)) / 3600, 1) as hours_since_update
FROM ns_wholesale_customers
WHERE metrics_computed_at IS NULL 
   OR metrics_computed_at < NOW() - INTERVAL '25 hours';

COMMENT ON VIEW ns_wholesale_stale_metrics IS 'Customers with stale or missing computed metrics. Should be empty after daily sync.';

-- ============================================================================
-- 4. Transaction Covering Index for Wholesale API
-- Avoids table lookup for the main transaction list query
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_txn_covering
ON ns_wholesale_transactions(tran_date DESC, ns_customer_id, foreign_total, status)
WHERE status IS NOT NULL;

-- Customer + date composite for joins
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_txn_customer_date 
ON ns_wholesale_transactions(ns_customer_id, tran_date DESC);

-- ============================================================================
-- 5. Deprecation Comments on Stale Columns
-- Document which columns should not be used in new code
-- ============================================================================
COMMENT ON COLUMN ns_wholesale_customers.last_order_date IS 
  'DEPRECATED: Use last_sale_date instead. This column may be stale from old sync.';

COMMENT ON COLUMN ns_wholesale_customers.first_order_date IS 
  'DEPRECATED: Use first_sale_date instead. This column may be null or stale.';
