-- Assembly SKU Daily Production
-- Stores daily production by SKU for T7 calculations

CREATE TABLE IF NOT EXISTS assembly_sku_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, sku)
);

-- Index for fast T7 lookups
CREATE INDEX IF NOT EXISTS idx_assembly_sku_daily_sku ON assembly_sku_daily(sku);
CREATE INDEX IF NOT EXISTS idx_assembly_sku_daily_date ON assembly_sku_daily(date DESC);
