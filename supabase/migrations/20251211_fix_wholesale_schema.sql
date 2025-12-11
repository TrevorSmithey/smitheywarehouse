-- Fix wholesale schema to match API expectations
-- This adds foreign keys and views that the API needs

-- ============================================================
-- 0. FIX TYPE MISMATCH: customers.ns_customer_id is TEXT, transactions is INTEGER
-- ============================================================

-- Convert customers.ns_customer_id from TEXT to INTEGER to match transactions
-- First check if it's already INTEGER
DO $$
DECLARE
    col_type TEXT;
BEGIN
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_name = 'ns_wholesale_customers'
    AND column_name = 'ns_customer_id';

    IF col_type = 'text' OR col_type = 'character varying' THEN
        -- Drop any existing constraints that reference this column
        -- Then alter the column type
        ALTER TABLE ns_wholesale_customers
        ALTER COLUMN ns_customer_id TYPE INTEGER USING ns_customer_id::INTEGER;
        RAISE NOTICE 'Converted ns_wholesale_customers.ns_customer_id to INTEGER';
    ELSE
        RAISE NOTICE 'ns_wholesale_customers.ns_customer_id is already type: %', col_type;
    END IF;
END $$;

-- ============================================================
-- 1. Add foreign key from transactions to customers
-- ============================================================

-- Add FK from transactions to customers (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ns_wholesale_transactions_customer'
    ) THEN
        -- First verify the ns_customer_id in customers exists for all transactions
        -- This might fail if there are orphaned transactions
        ALTER TABLE ns_wholesale_transactions
        ADD CONSTRAINT fk_ns_wholesale_transactions_customer
        FOREIGN KEY (ns_customer_id)
        REFERENCES ns_wholesale_customers(ns_customer_id)
        ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add FK on transactions->customers: %', SQLERRM;
END $$;

-- ============================================================
-- 2. Add foreign key from line_items to transactions
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ns_wholesale_line_items_transaction'
    ) THEN
        ALTER TABLE ns_wholesale_line_items
        ADD CONSTRAINT fk_ns_wholesale_line_items_transaction
        FOREIGN KEY (ns_transaction_id)
        REFERENCES ns_wholesale_transactions(ns_transaction_id)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add FK on line_items->transactions: %', SQLERRM;
END $$;

-- ============================================================
-- 3. Create SKU summary view
-- ============================================================

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
WHERE l.sku IS NOT NULL
  AND l.sku NOT LIKE 'Shopify%'
  AND l.sku NOT LIKE 'Tax%'
  AND l.sku NOT LIKE 'Shipping%'
GROUP BY l.sku, l.item_type
ORDER BY total_revenue DESC;

COMMENT ON VIEW ns_wholesale_sku_summary IS 'Aggregated SKU performance from wholesale transactions';

-- ============================================================
-- 4. Create monthly stats RPC function
-- ============================================================

CREATE OR REPLACE FUNCTION get_wholesale_monthly_stats()
RETURNS TABLE (
    month TEXT,
    transaction_count BIGINT,
    unique_customers BIGINT,
    total_units NUMERIC,
    total_revenue NUMERIC,
    avg_order_value NUMERIC,
    yoy_revenue_change NUMERIC,
    yoy_customer_change NUMERIC
) AS $$
WITH monthly_data AS (
    SELECT
        TO_CHAR(t.tran_date, 'YYYY-MM') as month,
        COUNT(DISTINCT t.ns_transaction_id) as transaction_count,
        COUNT(DISTINCT t.ns_customer_id) as unique_customers,
        COALESCE(SUM(ABS(l.quantity)), 0) as total_units,
        COALESCE(SUM(t.foreign_total), 0) as total_revenue
    FROM ns_wholesale_transactions t
    LEFT JOIN ns_wholesale_line_items l ON t.ns_transaction_id = l.ns_transaction_id
    WHERE t.tran_date >= (CURRENT_DATE - INTERVAL '24 months')
    GROUP BY TO_CHAR(t.tran_date, 'YYYY-MM')
),
with_yoy AS (
    SELECT
        m.month,
        m.transaction_count,
        m.unique_customers,
        m.total_units,
        m.total_revenue,
        CASE WHEN m.transaction_count > 0
             THEN m.total_revenue / m.transaction_count
             ELSE 0 END as avg_order_value,
        -- YoY calculations
        LAG(m.total_revenue, 12) OVER (ORDER BY m.month) as prev_year_revenue,
        LAG(m.unique_customers, 12) OVER (ORDER BY m.month) as prev_year_customers
    FROM monthly_data m
)
SELECT
    month,
    transaction_count,
    unique_customers,
    total_units,
    total_revenue,
    avg_order_value,
    CASE WHEN prev_year_revenue > 0
         THEN ((total_revenue - prev_year_revenue) / prev_year_revenue * 100)
         ELSE NULL END as yoy_revenue_change,
    CASE WHEN prev_year_customers > 0
         THEN ((unique_customers::NUMERIC - prev_year_customers::NUMERIC) / prev_year_customers::NUMERIC * 100)
         ELSE NULL END as yoy_customer_change
FROM with_yoy
ORDER BY month;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION get_wholesale_monthly_stats() IS 'Returns monthly wholesale stats with YoY comparisons for last 24 months';

-- ============================================================
-- 5. Create indexes for better query performance
-- ============================================================

-- Index on transactions for date range queries
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_txn_date_customer
ON ns_wholesale_transactions(tran_date, ns_customer_id);

-- Index on line items for transaction joins
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_line_items_txn_id
ON ns_wholesale_line_items(ns_transaction_id);

-- Index on line items for SKU aggregations
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_line_items_sku
ON ns_wholesale_line_items(sku) WHERE sku IS NOT NULL;

-- ============================================================
-- 6. Grant permissions (adjust role names as needed)
-- ============================================================

-- Grant access to the view and function
GRANT SELECT ON ns_wholesale_sku_summary TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_wholesale_monthly_stats() TO authenticated, anon, service_role;
