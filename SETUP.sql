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

-- Shipments table (for tracking)
CREATE TABLE IF NOT EXISTS shipments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,
  carrier TEXT,
  shipped_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_transit',
  last_scan_at TIMESTAMPTZ,
  last_scan_location TEXT,
  days_without_scan INTEGER DEFAULT 0,
  easypost_tracker_id TEXT,
  checked_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delivery_state TEXT,
  transit_days INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, tracking_number)
);

-- Indexes for shipments
CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_shipped_at ON shipments(shipped_at);
CREATE INDEX IF NOT EXISTS idx_shipments_checked_at ON shipments(checked_at);

-- Enable Row Level Security (optional - disable for internal tool)
-- ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;

-- Grant access to anon and authenticated users (if RLS disabled)
-- This allows the dashboard to read data without authentication
GRANT SELECT ON orders TO anon;
GRANT SELECT ON line_items TO anon;
GRANT ALL ON orders TO service_role;
GRANT ALL ON line_items TO service_role;
GRANT SELECT ON shipments TO anon;
GRANT ALL ON shipments TO service_role;

-- ============================================
-- ShipHero Inventory Integration Tables
-- ============================================

-- Products master table (from nomenclature.xlsx)
-- Source of truth for SKU → display name mapping
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL, -- cast_iron, carbon_steel, accessory, glass_lid, factory_second
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Warehouses reference table
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL -- pipefitter, hobson, selery, hq
);

-- Insert warehouse data (idempotent)
INSERT INTO warehouses (id, name, code) VALUES
  (120758, 'Pipefitter', 'pipefitter'),
  (77373, 'Hobson', 'hobson'),
  (93742, 'Selery', 'selery'),
  (120759, 'HQ', 'hq')
ON CONFLICT (id) DO NOTHING;

-- Inventory snapshots (synced from ShipHero every 15 min)
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  on_hand INTEGER DEFAULT 0,
  available INTEGER DEFAULT 0,
  reserved INTEGER DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sku, warehouse_id)
);

-- Inventory history (for DOI calculations, trends)
CREATE TABLE IF NOT EXISTS inventory_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL,
  on_hand INTEGER DEFAULT 0,
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sku, warehouse_id, snapshot_date)
);

-- Indexes for inventory queries
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_sku ON inventory(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse ON inventory(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_history_date ON inventory_history(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_inventory_history_sku ON inventory_history(sku);

-- Grants for inventory tables
GRANT SELECT ON products TO anon;
GRANT SELECT ON warehouses TO anon;
GRANT SELECT ON inventory TO anon;
GRANT SELECT ON inventory_history TO anon;
GRANT ALL ON products TO service_role;
GRANT ALL ON warehouses TO service_role;
GRANT ALL ON inventory TO service_role;
GRANT ALL ON inventory_history TO service_role;
