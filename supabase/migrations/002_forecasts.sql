-- Forecasts table for DOI calculations
-- Stores monthly sales forecasts by SKU

CREATE TABLE IF NOT EXISTS forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL,
  month TEXT NOT NULL, -- YYYY-MM format
  forecast_qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sku, month)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_forecasts_sku ON forecasts(sku);
CREATE INDEX IF NOT EXISTS idx_forecasts_month ON forecasts(month);

-- Comments
COMMENT ON TABLE forecasts IS 'Monthly sales forecasts for DOI calculations';
COMMENT ON COLUMN forecasts.month IS 'Month in YYYY-MM format';
COMMENT ON COLUMN forecasts.forecast_qty IS 'Forecasted units to sell this month';
