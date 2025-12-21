-- Session and conversion metrics from Google Analytics / Shopify
-- Source: KPIs - Fathom.xlsx

CREATE TABLE IF NOT EXISTS session_metrics (
  id SERIAL PRIMARY KEY,
  month DATE NOT NULL UNIQUE,  -- First day of month (e.g., 2024-01-01)
  web_sessions INTEGER,
  web_orders INTEGER,
  conversion_rate DECIMAL(5,4),  -- Calculated: orders / sessions
  new_customers INTEGER,
  new_customer_revenue DECIMAL(12,2),
  new_customer_aov DECIMAL(8,2),
  returning_customers INTEGER,
  returning_customer_revenue DECIMAL(12,2),
  returning_customer_aov DECIMAL(8,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_session_metrics_month ON session_metrics(month DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_session_metrics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS session_metrics_updated_at ON session_metrics;
CREATE TRIGGER session_metrics_updated_at
  BEFORE UPDATE ON session_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_session_metrics_timestamp();
