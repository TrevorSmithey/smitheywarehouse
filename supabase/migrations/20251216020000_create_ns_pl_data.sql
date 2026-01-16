-- NetSuite P&L Data Tables
-- Stores monthly revenue and COGS data by channel and product category

-- Monthly P&L summary by channel and category
CREATE TABLE IF NOT EXISTS ns_pl_monthly (
  id SERIAL PRIMARY KEY,
  year_month VARCHAR(7) NOT NULL, -- e.g., '2025-06'
  channel VARCHAR(20) NOT NULL, -- 'Web' or 'Wholesale'
  category VARCHAR(50) NOT NULL, -- 'Cast Iron', 'Carbon Steel', 'Glass Lids', 'Accessories', 'Engraving', 'Services', 'Other'
  revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cogs NUMERIC(14, 2), -- NULL if not tracked at this level
  gross_profit NUMERIC(14, 2) GENERATED ALWAYS AS (revenue - COALESCE(cogs, 0)) STORED,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(year_month, channel, category)
);

-- Revenue by income account (for reconciliation with NS P&L report)
CREATE TABLE IF NOT EXISTS ns_pl_by_account (
  id SERIAL PRIMARY KEY,
  year_month VARCHAR(7) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  account_number VARCHAR(20) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(year_month, channel, account_number)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ns_pl_monthly_year_month ON ns_pl_monthly(year_month);
CREATE INDEX IF NOT EXISTS idx_ns_pl_monthly_channel ON ns_pl_monthly(channel);
CREATE INDEX IF NOT EXISTS idx_ns_pl_by_account_year_month ON ns_pl_by_account(year_month);

-- Comments
COMMENT ON TABLE ns_pl_monthly IS 'Monthly P&L data by channel and product category, synced from NetSuite';
COMMENT ON TABLE ns_pl_by_account IS 'Monthly revenue by income account and channel, for reconciliation';
