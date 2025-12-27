-- Annual Sales Tracking table for full-year D2C revenue comparison
-- Year-agnostic design: supports any year without schema changes

CREATE TABLE IF NOT EXISTS annual_sales_tracking (
  year INTEGER NOT NULL,
  day_of_year INTEGER NOT NULL,      -- 1-365 (or 366 for leap years)
  date DATE NOT NULL,
  quarter INTEGER NOT NULL,          -- 1, 2, 3, or 4
  orders INTEGER NOT NULL DEFAULT 0,
  revenue DECIMAL(12, 2) NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (year, day_of_year)
);

-- Index for year queries (most common)
CREATE INDEX IF NOT EXISTS idx_annual_sales_year ON annual_sales_tracking(year);

-- Index for quarter filtering within a year
CREATE INDEX IF NOT EXISTS idx_annual_sales_quarter ON annual_sales_tracking(year, quarter);

-- Index for date lookups
CREATE INDEX IF NOT EXISTS idx_annual_sales_date ON annual_sales_tracking(date);

-- Comments
COMMENT ON TABLE annual_sales_tracking IS 'Full-year D2C sales tracking for YoY comparison';
COMMENT ON COLUMN annual_sales_tracking.year IS 'Calendar year (2024, 2025, etc.)';
COMMENT ON COLUMN annual_sales_tracking.day_of_year IS 'Day number within the year (1-365 or 1-366)';
COMMENT ON COLUMN annual_sales_tracking.quarter IS 'Quarter number (1=Jan-Mar, 2=Apr-Jun, 3=Jul-Sep, 4=Oct-Dec)';
COMMENT ON COLUMN annual_sales_tracking.orders IS 'Total D2C orders for the day';
COMMENT ON COLUMN annual_sales_tracking.revenue IS 'Total D2C revenue for the day';
