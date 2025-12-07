-- Holiday tracking data (Q4 comparison: 2024 vs 2025)
CREATE TABLE IF NOT EXISTS holiday_tracking (
  id SERIAL PRIMARY KEY,
  day_number INTEGER NOT NULL,           -- Day 1-92 of Q4

  -- 2024 data
  date_2024 DATE,
  orders_2024 INTEGER,
  sales_2024 DECIMAL(12,2),
  cumulative_orders_2024 INTEGER,
  cumulative_sales_2024 DECIMAL(12,2),

  -- 2025 data
  date_2025 DATE,
  orders_2025 INTEGER,
  sales_2025 DECIMAL(12,2),
  cumulative_orders_2025 INTEGER,
  cumulative_sales_2025 DECIMAL(12,2),

  -- Calculated deltas (stored for quick access)
  daily_orders_delta DECIMAL(6,4),       -- % change
  daily_sales_delta DECIMAL(6,4),
  cumulative_orders_delta DECIMAL(6,4),
  cumulative_sales_delta DECIMAL(6,4),

  synced_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(day_number)
);

-- Index for date lookups
CREATE INDEX IF NOT EXISTS idx_holiday_tracking_dates ON holiday_tracking(date_2024, date_2025);

COMMENT ON TABLE holiday_tracking IS 'Q4 holiday season comparison data (Oct 1 - Dec 31)';
