
-- =============================================
-- PHASE 1: PERFORMANCE INDEXES
-- Run in Supabase SQL Editor
-- =============================================

-- Index 1: line_items by order_id (speeds up joins)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_line_items_order_id
  ON line_items(order_id);

-- Index 2: line_items by lowercase SKU (speeds up aggregations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_line_items_sku_lower
  ON line_items(lower(sku)) WHERE sku IS NOT NULL;

-- Index 3: orders by created_at for non-canceled (date range queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at_active
  ON orders(created_at) WHERE canceled = false;

-- Index 4: orders by fulfilled_at (fulfillment analytics)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_fulfilled_at
  ON orders(fulfilled_at) WHERE fulfilled_at IS NOT NULL AND canceled = false;

-- Index 5: orders by warehouse + status (queue counts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_warehouse_status
  ON orders(warehouse, fulfillment_status) WHERE canceled = false;

-- Index 6: b2b_fulfilled by date (B2B aggregations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_fulfilled_date
  ON b2b_fulfilled(fulfilled_at);
