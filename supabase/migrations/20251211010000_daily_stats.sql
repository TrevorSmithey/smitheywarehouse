-- Daily Stats table for Shopify revenue and order metrics
-- Used for Klaviyo email % of revenue calculations and general reporting

CREATE TABLE IF NOT EXISTS daily_stats (
  date DATE PRIMARY KEY,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_revenue DECIMAL(12, 2) NOT NULL DEFAULT 0,
  avg_order_value DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date DESC);

-- Comments
COMMENT ON TABLE daily_stats IS 'Daily aggregated stats from Shopify - revenue, order counts';
COMMENT ON COLUMN daily_stats.total_orders IS 'Count of D2C orders for the day';
COMMENT ON COLUMN daily_stats.total_revenue IS 'Total revenue from Shopify orders';
COMMENT ON COLUMN daily_stats.avg_order_value IS 'Average order value for the day';
