-- Smithey Warehouse Dashboard - Database Setup
-- Run this in your Supabase SQL Editor

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY,                    -- Shopify order ID
  order_name TEXT NOT NULL,                 -- Human-readable #12345
  warehouse TEXT,                           -- 'smithey' or 'selery' (from tags)
  fulfillment_status TEXT,                  -- null, 'partial', 'fulfilled'
  canceled BOOLEAN DEFAULT FALSE,           -- Exclude from metrics when true
  created_at TIMESTAMPTZ NOT NULL,          -- Order placed date
  fulfilled_at TIMESTAMPTZ,                 -- When fully fulfilled
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Line items table
CREATE TABLE IF NOT EXISTS line_items (
  id BIGINT PRIMARY KEY,                    -- Shopify line item ID
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT,                                 -- Product SKU
  title TEXT,                               -- Product title (for display)
  quantity INT NOT NULL,                    -- Ordered quantity
  fulfilled_quantity INT DEFAULT 0,         -- Fulfilled so far
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_orders_warehouse ON orders(warehouse);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_fulfilled_at ON orders(fulfilled_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_canceled ON orders(canceled);

-- Indexes for line items
CREATE INDEX IF NOT EXISTS idx_line_items_order_id ON line_items(order_id);
CREATE INDEX IF NOT EXISTS idx_line_items_sku ON line_items(sku);

-- Enable Row Level Security (optional - disable for internal tool)
-- ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;

-- Grant access to anon and authenticated users (if RLS disabled)
-- This allows the dashboard to read data without authentication
GRANT SELECT ON orders TO anon;
GRANT SELECT ON line_items TO anon;
GRANT ALL ON orders TO service_role;
GRANT ALL ON line_items TO service_role;
