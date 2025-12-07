-- B2B/Wholesale fulfilled items
-- Denormalized for easy querying by fulfillment date (not order date)
-- B2B uses fulfillment date because orders may be placed weeks before shipping

CREATE TABLE b2b_fulfilled (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id BIGINT NOT NULL,
  order_name TEXT,
  customer_name TEXT,
  source_name TEXT,  -- e.g., "Crate & Barrel - DS", "wholesale portal"
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price DECIMAL(10,2),
  fulfilled_at TIMESTAMPTZ NOT NULL,  -- Key date for B2B metrics
  created_at TIMESTAMPTZ,  -- Order creation date (for reference)
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, sku, fulfilled_at)  -- Prevent duplicate syncs
);

-- Index for monthly aggregations by SKU
CREATE INDEX idx_b2b_fulfilled_sku_date ON b2b_fulfilled(sku, fulfilled_at);

-- Index for filtering by source
CREATE INDEX idx_b2b_fulfilled_source ON b2b_fulfilled(source_name, fulfilled_at);

-- Index for date range queries
CREATE INDEX idx_b2b_fulfilled_date ON b2b_fulfilled(fulfilled_at);

COMMENT ON TABLE b2b_fulfilled IS 'B2B/Wholesale fulfilled items - tracks by fulfillment date, not order date';
COMMENT ON COLUMN b2b_fulfilled.fulfilled_at IS 'Date item was fulfilled/shipped - use this for B2B MTD metrics';
COMMENT ON COLUMN b2b_fulfilled.source_name IS 'Channel: Crate & Barrel - DS, wholesale portal, etc.';
