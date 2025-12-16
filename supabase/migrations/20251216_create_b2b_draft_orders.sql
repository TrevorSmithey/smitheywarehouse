-- B2B Draft Orders table for tracking open draft orders from Shopify B2B
-- Stores line items denormalized for fast SKU aggregation
-- Full resync approach: truncate + insert on each sync

CREATE TABLE IF NOT EXISTS b2b_draft_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_order_id BIGINT NOT NULL,      -- Shopify draft order ID (numeric from GID)
  draft_order_name TEXT,                -- e.g., "#D1234"
  customer_name TEXT,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price DECIMAL(10,2),
  created_at TIMESTAMPTZ,               -- Draft order creation date
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draft_order_id, sku)           -- One row per SKU per draft order
);

-- Index for SKU aggregation queries
CREATE INDEX IF NOT EXISTS idx_b2b_draft_orders_sku ON b2b_draft_orders(sku);

-- Index for draft order lookups
CREATE INDEX IF NOT EXISTS idx_b2b_draft_orders_draft_id ON b2b_draft_orders(draft_order_id);

-- Enable RLS (table is internal, no public access needed)
ALTER TABLE b2b_draft_orders ENABLE ROW LEVEL SECURITY;

-- Allow service role can manage all data
CREATE POLICY "Service role can manage b2b_draft_orders" ON b2b_draft_orders
  FOR ALL USING (true) WITH CHECK (true);
