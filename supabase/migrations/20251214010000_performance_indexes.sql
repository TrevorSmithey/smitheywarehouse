-- Performance indexes for slow queries
-- Based on Supabase slow query report

-- Orders table indexes (top slow queries are JOINs with orders)
CREATE INDEX IF NOT EXISTS idx_orders_created_at
ON orders(created_at);

CREATE INDEX IF NOT EXISTS idx_orders_fulfilled_at
ON orders(fulfilled_at);

CREATE INDEX IF NOT EXISTS idx_orders_canceled_warehouse
ON orders(canceled, warehouse);

CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status_canceled
ON orders(fulfillment_status, canceled);

-- Line items indexes (frequently JOINed with orders)
CREATE INDEX IF NOT EXISTS idx_line_items_order_id
ON line_items(order_id);

CREATE INDEX IF NOT EXISTS idx_line_items_sku
ON line_items(sku);

-- NetSuite wholesale tables indexes
CREATE INDEX IF NOT EXISTS idx_ns_transactions_tran_date
ON ns_wholesale_transactions(tran_date);

CREATE INDEX IF NOT EXISTS idx_ns_line_items_transaction_id
ON ns_wholesale_line_items(ns_transaction_id);

-- Shipments table indexes
CREATE INDEX IF NOT EXISTS idx_shipments_status_delivered_at
ON shipments(status, delivered_at);

CREATE INDEX IF NOT EXISTS idx_shipments_status_days_without_scan
ON shipments(status, days_without_scan);
