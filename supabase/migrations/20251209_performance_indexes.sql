-- ============================================
-- PERFORMANCE INDEXES
-- ============================================
--
-- Add indexes for frequently queried columns to improve query performance.
-- These indexes are based on analysis of the metrics API queries.
--
-- Run: supabase db push
-- Or execute directly in Supabase SQL Editor

-- ============================================
-- ORDERS TABLE INDEXES
-- ============================================

-- Index for unfulfilled orders queries (most common query pattern)
-- Used by: metrics API unfulfilled counts, queue health, oldest orders
DROP INDEX IF EXISTS idx_orders_unfulfilled;
CREATE INDEX idx_orders_unfulfilled
ON orders (warehouse, canceled, fulfillment_status)
WHERE fulfillment_status IS NULL AND canceled = false;

-- Index for fulfilled orders queries (range scans on fulfilled_at)
-- Used by: metrics API fulfilled counts, lead time calculations
DROP INDEX IF EXISTS idx_orders_fulfilled_at;
CREATE INDEX idx_orders_fulfilled_at
ON orders (fulfilled_at, warehouse, canceled)
WHERE fulfilled_at IS NOT NULL;

-- Index for created_at range queries
-- Used by: daily orders, aging analysis
DROP INDEX IF EXISTS idx_orders_created_at;
CREATE INDEX idx_orders_created_at
ON orders (created_at, warehouse, canceled);

-- ============================================
-- LINE_ITEMS TABLE INDEXES
-- ============================================

-- Index for SKU queue queries (unfulfilled line items)
-- Used by: metrics API SKU queue, engraving queue
DROP INDEX IF EXISTS idx_line_items_order_sku;
CREATE INDEX idx_line_items_order_sku
ON line_items (order_id, sku);

-- Index for restoration item queries (SKUs with -Rest-)
-- Used by: metrics API restoration filtering
DROP INDEX IF EXISTS idx_line_items_restoration;
CREATE INDEX idx_line_items_restoration
ON line_items (sku)
WHERE sku ILIKE '%-Rest-%';

-- ============================================
-- SHIPMENTS TABLE INDEXES
-- ============================================

-- Index for stuck shipments queries
-- Used by: metrics API stuck shipments
DROP INDEX IF EXISTS idx_shipments_in_transit;
CREATE INDEX idx_shipments_in_transit
ON shipments (status, days_without_scan)
WHERE status = 'in_transit';

-- Index for transit analytics queries (delivered shipments)
-- Used by: metrics API transit analytics
DROP INDEX IF EXISTS idx_shipments_delivered;
CREATE INDEX idx_shipments_delivered
ON shipments (delivered_at, status)
WHERE status = 'delivered';

-- ============================================
-- B2B_FULFILLED TABLE INDEXES
-- ============================================

-- Index for date range queries
-- Used by: budget API B2B sales aggregation
DROP INDEX IF EXISTS idx_b2b_fulfilled_date;
CREATE INDEX idx_b2b_fulfilled_date
ON b2b_fulfilled (fulfilled_at);

-- Index for SKU aggregation
DROP INDEX IF EXISTS idx_b2b_fulfilled_sku;
CREATE INDEX idx_b2b_fulfilled_sku
ON b2b_fulfilled (sku);

-- ============================================
-- INVENTORY TABLE INDEXES
-- ============================================

-- Index for warehouse inventory queries
DROP INDEX IF EXISTS idx_inventory_warehouse;
CREATE INDEX idx_inventory_warehouse
ON inventory (warehouse_id, sku);

-- ============================================
-- Done. These indexes should significantly improve query performance
-- for the metrics and budget API endpoints.
-- ============================================
