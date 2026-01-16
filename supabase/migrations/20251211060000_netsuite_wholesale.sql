-- NetSuite Wholesale Data Tables
-- Stores wholesale customers and transactions from NetSuite (Cash Sales + Invoices)

-- Wholesale Customers table
CREATE TABLE IF NOT EXISTS ns_wholesale_customers (
  id SERIAL PRIMARY KEY,
  ns_customer_id INTEGER UNIQUE NOT NULL,  -- NetSuite internal ID
  entity_id TEXT NOT NULL,                 -- NetSuite entity ID (visible ID like "432")
  company_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  first_sale_date DATE,
  last_sale_date DATE,
  first_order_date DATE,
  last_order_date DATE,
  date_created TIMESTAMPTZ,
  last_modified TIMESTAMPTZ,
  is_inactive BOOLEAN DEFAULT FALSE,
  parent_id INTEGER,                       -- For sub-customers
  terms TEXT,
  category TEXT,
  entity_status TEXT,
  -- Calculated fields (updated by triggers/sync)
  total_revenue DECIMAL(12,2) DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_entity ON ns_wholesale_customers(entity_id);
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_name ON ns_wholesale_customers(company_name);
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_last_sale ON ns_wholesale_customers(last_sale_date);

-- Wholesale Transactions table (header level)
CREATE TABLE IF NOT EXISTS ns_wholesale_transactions (
  id SERIAL PRIMARY KEY,
  ns_transaction_id INTEGER UNIQUE NOT NULL,  -- NetSuite internal ID
  tran_id TEXT NOT NULL,                      -- Document number (e.g., INV-12345)
  transaction_type TEXT NOT NULL,             -- 'CashSale' or 'CustInvc'
  tran_date DATE NOT NULL,
  ns_customer_id INTEGER NOT NULL REFERENCES ns_wholesale_customers(ns_customer_id),
  foreign_total DECIMAL(12,2),
  status TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ns_wholesale_txn_date ON ns_wholesale_transactions(tran_date);
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_txn_customer ON ns_wholesale_transactions(ns_customer_id);
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_txn_type ON ns_wholesale_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_txn_tran_id ON ns_wholesale_transactions(tran_id);

-- Wholesale Transaction Line Items table
CREATE TABLE IF NOT EXISTS ns_wholesale_line_items (
  id SERIAL PRIMARY KEY,
  ns_line_id INTEGER NOT NULL,
  ns_transaction_id INTEGER NOT NULL REFERENCES ns_wholesale_transactions(ns_transaction_id),
  ns_item_id INTEGER,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  rate DECIMAL(10,2),
  net_amount DECIMAL(10,2),
  foreign_amount DECIMAL(10,2),
  item_type TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ns_transaction_id, ns_line_id)
);

CREATE INDEX IF NOT EXISTS idx_ns_wholesale_lines_txn ON ns_wholesale_line_items(ns_transaction_id);
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_lines_sku ON ns_wholesale_line_items(sku);
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_lines_item ON ns_wholesale_line_items(ns_item_id);

-- Monthly aggregation view
CREATE OR REPLACE VIEW ns_wholesale_monthly AS
SELECT
  DATE_TRUNC('month', t.tran_date)::DATE as month,
  t.transaction_type,
  COUNT(DISTINCT t.ns_transaction_id) as transaction_count,
  COUNT(DISTINCT t.ns_customer_id) as unique_customers,
  SUM(l.quantity) as total_units,
  SUM(l.net_amount) as total_revenue
FROM ns_wholesale_transactions t
JOIN ns_wholesale_line_items l ON t.ns_transaction_id = l.ns_transaction_id
GROUP BY DATE_TRUNC('month', t.tran_date), t.transaction_type
ORDER BY month DESC, transaction_type;

-- Customer summary view
CREATE OR REPLACE VIEW ns_wholesale_customer_summary AS
SELECT
  c.ns_customer_id,
  c.entity_id,
  c.company_name,
  c.first_sale_date,
  c.last_sale_date,
  COUNT(DISTINCT t.ns_transaction_id) as order_count,
  SUM(l.net_amount) as total_revenue,
  MAX(t.tran_date) as last_order_date
FROM ns_wholesale_customers c
LEFT JOIN ns_wholesale_transactions t ON c.ns_customer_id = t.ns_customer_id
LEFT JOIN ns_wholesale_line_items l ON t.ns_transaction_id = l.ns_transaction_id
GROUP BY c.ns_customer_id, c.entity_id, c.company_name, c.first_sale_date, c.last_sale_date
ORDER BY total_revenue DESC NULLS LAST;

-- SKU summary view
CREATE OR REPLACE VIEW ns_wholesale_sku_summary AS
SELECT
  l.sku,
  l.item_type,
  COUNT(DISTINCT t.ns_transaction_id) as order_count,
  SUM(ABS(l.quantity)) as total_units,
  SUM(ABS(l.net_amount)) as total_revenue,
  MIN(t.tran_date) as first_sold,
  MAX(t.tran_date) as last_sold
FROM ns_wholesale_line_items l
JOIN ns_wholesale_transactions t ON l.ns_transaction_id = t.ns_transaction_id
WHERE l.sku NOT LIKE 'Shipping%'
  AND l.sku NOT LIKE 'Shopify%'
  AND l.sku NOT LIKE 'Tax%'
GROUP BY l.sku, l.item_type
ORDER BY total_revenue DESC;

COMMENT ON TABLE ns_wholesale_customers IS 'Wholesale customers from NetSuite (excludes entityid 493 - D2C default)';
COMMENT ON TABLE ns_wholesale_transactions IS 'Wholesale transactions from NetSuite - includes both CashSale (historical) and CustInvc (current)';
COMMENT ON TABLE ns_wholesale_line_items IS 'Line items from wholesale transactions - SKUs, quantities, prices';
