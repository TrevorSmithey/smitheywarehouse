-- ============================================================================
-- DATABASE ARCHITECTURE FIXES
-- December 18, 2025
--
-- Addresses critical gaps identified in architecture review:
-- 1. RPC functions not defined in migrations (only documented)
-- 2. Missing indexes on ns_wholesale_customers
-- 3. FK constraint verification
--
-- Run: supabase db push OR execute in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- PART 1: RPC FUNCTION DEFINITIONS
-- These functions are called by the application but were created manually
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1 get_order_counts - Consolidated order count query
-- Called by: /api/metrics (replaces 20+ individual count queries)
-- Returns: Array of warehouse metrics rows
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_order_counts(
  p_today_start TIMESTAMPTZ,
  p_today_end TIMESTAMPTZ,
  p_seven_days_ago TIMESTAMPTZ,
  p_thirty_days_ago TIMESTAMPTZ,
  p_prev_range_start TIMESTAMPTZ,
  p_prev_range_end TIMESTAMPTZ,
  p_range_start TIMESTAMPTZ,
  p_range_end TIMESTAMPTZ,
  p_one_day_ago TIMESTAMPTZ,
  p_three_days_ago TIMESTAMPTZ
)
RETURNS TABLE(
  warehouse TEXT,
  unfulfilled BIGINT,
  partial BIGINT,
  fulfilled_today BIGINT,
  fulfilled_7d BIGINT,
  fulfilled_30d BIGINT,
  prev_period BIGINT,
  in_range BIGINT,
  waiting_1d BIGINT,
  waiting_3d BIGINT,
  waiting_7d BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.warehouse,
    -- Unfulfilled orders (no fulfillment_status, not cancelled, not restoration)
    COUNT(*) FILTER (
      WHERE o.fulfillment_status IS NULL
        AND o.canceled = false
        AND o.is_restoration = false
    ) AS unfulfilled,
    -- Partial orders
    COUNT(*) FILTER (
      WHERE o.fulfillment_status = 'partial'
        AND o.canceled = false
        AND o.is_restoration = false
    ) AS partial,
    -- Fulfilled today (EST)
    COUNT(*) FILTER (
      WHERE o.fulfilled_at >= p_today_start
        AND o.fulfilled_at <= p_today_end
        AND o.canceled = false
        AND o.is_restoration = false
    ) AS fulfilled_today,
    -- Fulfilled last 7 days
    COUNT(*) FILTER (
      WHERE o.fulfilled_at >= p_seven_days_ago
        AND o.canceled = false
        AND o.is_restoration = false
    ) AS fulfilled_7d,
    -- Fulfilled last 30 days
    COUNT(*) FILTER (
      WHERE o.fulfilled_at >= p_thirty_days_ago
        AND o.canceled = false
        AND o.is_restoration = false
    ) AS fulfilled_30d,
    -- Previous period (for WoW comparison)
    COUNT(*) FILTER (
      WHERE o.fulfilled_at >= p_prev_range_start
        AND o.fulfilled_at <= p_prev_range_end
        AND o.canceled = false
        AND o.is_restoration = false
    ) AS prev_period,
    -- Current range
    COUNT(*) FILTER (
      WHERE o.fulfilled_at >= p_range_start
        AND o.fulfilled_at <= p_range_end
        AND o.canceled = false
        AND o.is_restoration = false
    ) AS in_range,
    -- Queue health: waiting > 1 day
    COUNT(*) FILTER (
      WHERE o.fulfillment_status IS NULL
        AND o.canceled = false
        AND o.is_restoration = false
        AND o.created_at < p_one_day_ago
    ) AS waiting_1d,
    -- Queue health: waiting > 3 days
    COUNT(*) FILTER (
      WHERE o.fulfillment_status IS NULL
        AND o.canceled = false
        AND o.is_restoration = false
        AND o.created_at < p_three_days_ago
    ) AS waiting_3d,
    -- Queue health: waiting > 7 days
    COUNT(*) FILTER (
      WHERE o.fulfillment_status IS NULL
        AND o.canceled = false
        AND o.is_restoration = false
        AND o.created_at < p_seven_days_ago
    ) AS waiting_7d
  FROM orders o
  WHERE o.warehouse IS NOT NULL
  GROUP BY o.warehouse;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_order_counts(TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;

COMMENT ON FUNCTION get_order_counts IS 'Consolidated order counts by warehouse for metrics dashboard. Replaces 20+ individual count queries.';

-- ----------------------------------------------------------------------------
-- 1.2 get_engraving_queue_stats - Engraving queue depth
-- Called by: /api/metrics
-- Returns: total_units, order_count for Smithey engraving orders
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_engraving_queue_stats()
RETURNS TABLE(
  total_units BIGINT,
  order_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(li.quantity - li.fulfilled_quantity), 0)::BIGINT AS total_units,
    COUNT(DISTINCT o.id)::BIGINT AS order_count
  FROM line_items li
  JOIN orders o ON li.order_id = o.id
  WHERE o.warehouse = 'smithey'
    AND o.canceled = false
    AND o.is_restoration = false
    AND (o.fulfillment_status IS NULL OR o.fulfillment_status = 'partial')
    AND li.sku LIKE '%ENG%'  -- Engraving SKUs
    AND (li.quantity - li.fulfilled_quantity) > 0;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_engraving_queue_stats() TO anon, authenticated, service_role;

COMMENT ON FUNCTION get_engraving_queue_stats IS 'Returns total unfulfilled engraving units and order count for Smithey warehouse.';

-- ----------------------------------------------------------------------------
-- 1.3 compute_customer_metrics - Derived fields for wholesale customers
-- Called by: /api/cron/sync-netsuite-customers after customer sync
-- Updates: health_status, segment, metrics on ns_wholesale_customers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION compute_customer_metrics()
RETURNS void AS $$
DECLARE
  current_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE);
  prior_year INTEGER := current_year - 1;
BEGIN
  -- Update computed metrics from transaction data
  WITH customer_stats AS (
    SELECT
      t.ns_customer_id,
      COUNT(DISTINCT t.ns_transaction_id) AS lifetime_orders,
      COALESCE(SUM(t.foreign_total), 0) AS lifetime_revenue,
      MIN(t.tran_date) AS first_sale_date,
      MAX(t.tran_date) AS last_sale_date,
      COALESCE(SUM(CASE WHEN EXTRACT(YEAR FROM t.tran_date) = current_year THEN t.foreign_total ELSE 0 END), 0) AS ytd_revenue,
      COUNT(CASE WHEN EXTRACT(YEAR FROM t.tran_date) = current_year THEN 1 END) AS ytd_orders,
      COALESCE(SUM(CASE WHEN EXTRACT(YEAR FROM t.tran_date) = prior_year THEN t.foreign_total ELSE 0 END), 0) AS prior_year_revenue
    FROM ns_wholesale_transactions t
    GROUP BY t.ns_customer_id
  )
  UPDATE ns_wholesale_customers c
  SET
    lifetime_orders = COALESCE(cs.lifetime_orders, 0),
    lifetime_revenue = COALESCE(cs.lifetime_revenue, 0),
    first_sale_date = cs.first_sale_date,
    last_sale_date = cs.last_sale_date,
    ytd_revenue = COALESCE(cs.ytd_revenue, 0),
    ytd_orders = COALESCE(cs.ytd_orders, 0),
    prior_year_revenue = COALESCE(cs.prior_year_revenue, 0),
    avg_order_value = CASE
      WHEN COALESCE(cs.lifetime_orders, 0) > 0
      THEN COALESCE(cs.lifetime_revenue, 0) / cs.lifetime_orders
      ELSE 0
    END,
    days_since_last_order = CASE
      WHEN cs.last_sale_date IS NOT NULL
      THEN EXTRACT(DAYS FROM (CURRENT_DATE - cs.last_sale_date))
      ELSE NULL
    END,
    yoy_revenue_change_pct = CASE
      WHEN COALESCE(cs.prior_year_revenue, 0) > 0
      THEN ((COALESCE(cs.ytd_revenue, 0) - cs.prior_year_revenue) / cs.prior_year_revenue) * 100
      ELSE NULL
    END,
    updated_at = NOW()
  FROM customer_stats cs
  WHERE c.ns_customer_id = cs.ns_customer_id;

  -- Compute health_status based on order patterns
  UPDATE ns_wholesale_customers c
  SET health_status = CASE
    -- New: first order within last 90 days
    WHEN c.first_sale_date >= CURRENT_DATE - INTERVAL '90 days' THEN 'new'
    -- One-time: only 1 order ever
    WHEN COALESCE(c.lifetime_orders, 0) = 1 THEN 'one_time'
    -- Churned: 365+ days since last order
    WHEN c.days_since_last_order >= 365 THEN 'churned'
    -- Churning: 270-365 days since last order
    WHEN c.days_since_last_order >= 270 THEN 'churning'
    -- At risk: 180-270 days since last order
    WHEN c.days_since_last_order >= 180 THEN 'at_risk'
    -- Declining: negative YoY revenue change
    WHEN COALESCE(c.yoy_revenue_change_pct, 0) < -20 THEN 'declining'
    -- Thriving: positive YoY and recent orders
    WHEN COALESCE(c.yoy_revenue_change_pct, 0) > 20 AND c.days_since_last_order < 90 THEN 'thriving'
    -- Stable: moderate activity
    WHEN c.days_since_last_order < 180 THEN 'stable'
    -- Default
    ELSE 'at_risk'
  END,
  is_at_risk = CASE
    WHEN c.days_since_last_order >= 180 THEN true
    ELSE false
  END
  WHERE c.lifetime_orders > 0 OR c.first_sale_date IS NOT NULL;

  -- Compute segment based on lifetime revenue
  UPDATE ns_wholesale_customers c
  SET segment = CASE
    WHEN COALESCE(c.lifetime_revenue, 0) >= 50000 THEN 'major'
    WHEN COALESCE(c.lifetime_revenue, 0) >= 20000 THEN 'large'
    WHEN COALESCE(c.lifetime_revenue, 0) >= 10000 THEN 'mid'
    WHEN COALESCE(c.lifetime_revenue, 0) >= 5000 THEN 'small'
    WHEN COALESCE(c.lifetime_revenue, 0) >= 2000 THEN 'starter'
    ELSE 'minimal'
  END;

  -- Mark corporate customers based on category field
  UPDATE ns_wholesale_customers c
  SET is_corporate = CASE
    WHEN c.category = 'Corporate' OR c.category = '4' THEN true
    ELSE false
  END;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION compute_customer_metrics() TO service_role;

COMMENT ON FUNCTION compute_customer_metrics IS 'Computes derived fields (health_status, segment, metrics) for wholesale customers. Called by netsuite customer sync.';

-- ----------------------------------------------------------------------------
-- 1.4 get_customer_order_intervals - Order frequency stats
-- Called by: /api/wholesale (for ordering anomaly detection)
-- Returns: median_interval, mean_interval, std_dev per customer
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_customer_order_intervals(min_order_count INTEGER DEFAULT 4)
RETURNS TABLE(
  ns_customer_id INTEGER,
  median_interval NUMERIC,
  mean_interval NUMERIC,
  std_dev NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH order_dates AS (
    SELECT
      t.ns_customer_id,
      t.tran_date,
      LAG(t.tran_date) OVER (PARTITION BY t.ns_customer_id ORDER BY t.tran_date) AS prev_date
    FROM ns_wholesale_transactions t
  ),
  intervals AS (
    SELECT
      od.ns_customer_id,
      EXTRACT(DAYS FROM (od.tran_date - od.prev_date)) AS interval_days
    FROM order_dates od
    WHERE od.prev_date IS NOT NULL
  ),
  customer_counts AS (
    SELECT
      t.ns_customer_id,
      COUNT(DISTINCT t.ns_transaction_id) AS order_count
    FROM ns_wholesale_transactions t
    GROUP BY t.ns_customer_id
    HAVING COUNT(DISTINCT t.ns_transaction_id) >= min_order_count
  )
  SELECT
    i.ns_customer_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.interval_days)::NUMERIC AS median_interval,
    AVG(i.interval_days)::NUMERIC AS mean_interval,
    STDDEV(i.interval_days)::NUMERIC AS std_dev
  FROM intervals i
  JOIN customer_counts cc ON i.ns_customer_id = cc.ns_customer_id
  GROUP BY i.ns_customer_id;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_customer_order_intervals(INTEGER) TO anon, authenticated, service_role;

COMMENT ON FUNCTION get_customer_order_intervals IS 'Calculates order interval statistics (median, mean, std dev) for customers with N+ orders.';

-- ============================================================================
-- PART 2: MISSING INDEXES ON ns_wholesale_customers
-- These columns are filtered/sorted in /api/wholesale queries
-- ============================================================================

-- Index for sorting by lifetime_revenue (used in ORDER BY)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_lifetime_revenue
ON ns_wholesale_customers(lifetime_revenue DESC NULLS LAST);

-- Index for filtering by health_status (used in WHERE clauses)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_health_status
ON ns_wholesale_customers(health_status);

-- Index for filtering by segment (used in aggregations)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_segment
ON ns_wholesale_customers(segment);

-- Index for filtering by is_corporate (used to exclude corporate gifting)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_is_corporate
ON ns_wholesale_customers(is_corporate)
WHERE is_corporate = true;

-- Composite index for common filter pattern (B2B only, sorted by revenue)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_b2b_revenue
ON ns_wholesale_customers(lifetime_revenue DESC NULLS LAST)
WHERE is_corporate = false OR is_corporate IS NULL;

-- Index for YTD revenue (used in corporate customer sorting)
CREATE INDEX IF NOT EXISTS idx_ns_wholesale_customers_ytd_revenue
ON ns_wholesale_customers(ytd_revenue DESC NULLS LAST);

-- ============================================================================
-- PART 3: FK CONSTRAINT VERIFICATION AND FIXES
-- ============================================================================

-- 3.1 Verify ns_wholesale_transactions FK status
-- This was attempted in 20251211_fix_wholesale_schema.sql but may have failed

DO $$
DECLARE
  fk_exists BOOLEAN;
  orphan_count INTEGER;
BEGIN
  -- Check if FK already exists
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_ns_wholesale_transactions_customer'
  ) INTO fk_exists;

  IF NOT fk_exists THEN
    -- Count orphaned transactions (transactions without matching customer)
    SELECT COUNT(*) INTO orphan_count
    FROM ns_wholesale_transactions t
    LEFT JOIN ns_wholesale_customers c ON t.ns_customer_id = c.ns_customer_id
    WHERE c.ns_customer_id IS NULL;

    IF orphan_count > 0 THEN
      RAISE WARNING 'Found % orphaned transactions without matching customers. FK not added.', orphan_count;

      -- Create a table to log orphaned transactions for investigation
      CREATE TABLE IF NOT EXISTS orphaned_transactions_log (
        ns_transaction_id INTEGER,
        ns_customer_id INTEGER,
        tran_date DATE,
        logged_at TIMESTAMPTZ DEFAULT NOW()
      );

      INSERT INTO orphaned_transactions_log (ns_transaction_id, ns_customer_id, tran_date)
      SELECT t.ns_transaction_id, t.ns_customer_id, t.tran_date
      FROM ns_wholesale_transactions t
      LEFT JOIN ns_wholesale_customers c ON t.ns_customer_id = c.ns_customer_id
      WHERE c.ns_customer_id IS NULL;

      RAISE NOTICE 'Orphaned transactions logged to orphaned_transactions_log table.';
    ELSE
      -- Safe to add FK
      ALTER TABLE ns_wholesale_transactions
      ADD CONSTRAINT fk_ns_wholesale_transactions_customer
      FOREIGN KEY (ns_customer_id)
      REFERENCES ns_wholesale_customers(ns_customer_id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;

      RAISE NOTICE 'FK constraint fk_ns_wholesale_transactions_customer added successfully.';
    END IF;
  ELSE
    RAISE NOTICE 'FK constraint fk_ns_wholesale_transactions_customer already exists.';
  END IF;
END $$;

-- 3.2 Document b2b_fulfilled order_id intentional lack of FK
-- b2b_fulfilled.order_id is intentionally NOT a FK because:
-- - B2B orders come from Shopify B2B (different ID space than D2C orders)
-- - The order_id may reference orders not synced to our orders table
-- - This is a denormalized table for analytics, not transactional integrity

COMMENT ON COLUMN b2b_fulfilled.order_id IS 'Shopify B2B order ID. NOT a foreign key to orders table - B2B orders are a separate ID space from D2C orders.';

-- ============================================================================
-- PART 4: ENSURE COLUMN EXISTENCE
-- Add columns that may not exist from earlier migrations
-- ============================================================================

-- Ensure ns_wholesale_customers has all computed columns
DO $$
BEGIN
  -- Add lifetime_orders if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'lifetime_orders') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN lifetime_orders INTEGER DEFAULT 0;
  END IF;

  -- Add lifetime_revenue if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'lifetime_revenue') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN lifetime_revenue DECIMAL(12,2) DEFAULT 0;
  END IF;

  -- Add avg_order_value if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'avg_order_value') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN avg_order_value DECIMAL(10,2) DEFAULT 0;
  END IF;

  -- Add ytd_revenue if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'ytd_revenue') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN ytd_revenue DECIMAL(12,2) DEFAULT 0;
  END IF;

  -- Add ytd_orders if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'ytd_orders') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN ytd_orders INTEGER DEFAULT 0;
  END IF;

  -- Add prior_year_revenue if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'prior_year_revenue') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN prior_year_revenue DECIMAL(12,2) DEFAULT 0;
  END IF;

  -- Add days_since_last_order if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'days_since_last_order') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN days_since_last_order INTEGER;
  END IF;

  -- Add yoy_revenue_change_pct if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'yoy_revenue_change_pct') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN yoy_revenue_change_pct DECIMAL(10,2);
  END IF;

  -- Add health_status if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'health_status') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN health_status TEXT;
  END IF;

  -- Add segment if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'segment') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN segment TEXT;
  END IF;

  -- Add is_corporate if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'is_corporate') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN is_corporate BOOLEAN DEFAULT false;
  END IF;

  -- Add is_at_risk if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'is_at_risk') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN is_at_risk BOOLEAN DEFAULT false;
  END IF;

  -- Add is_excluded if missing (for test accounts)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'is_excluded') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN is_excluded BOOLEAN DEFAULT false;
  END IF;

  -- Add is_manually_churned if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'is_manually_churned') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN is_manually_churned BOOLEAN DEFAULT false;
  END IF;

  -- Add updated_at if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ns_wholesale_customers' AND column_name = 'updated_at') THEN
    ALTER TABLE ns_wholesale_customers ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION QUERIES (Run after migration to verify success)
-- ============================================================================

-- Verify RPC functions exist:
-- SELECT proname FROM pg_proc WHERE proname IN (
--   'get_order_counts',
--   'get_engraving_queue_stats',
--   'compute_customer_metrics',
--   'get_customer_order_intervals'
-- );

-- Verify indexes exist:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'ns_wholesale_customers'
-- AND indexname LIKE 'idx_ns_wholesale%';

-- Verify FK constraint:
-- SELECT conname FROM pg_constraint
-- WHERE conname = 'fk_ns_wholesale_transactions_customer';

-- Test get_order_counts:
-- SELECT * FROM get_order_counts(
--   '2025-12-18T00:00:00-05:00'::TIMESTAMPTZ,
--   '2025-12-18T23:59:59-05:00'::TIMESTAMPTZ,
--   NOW() - INTERVAL '7 days',
--   NOW() - INTERVAL '30 days',
--   NOW() - INTERVAL '14 days',
--   NOW() - INTERVAL '7 days',
--   NOW() - INTERVAL '7 days',
--   NOW(),
--   NOW() - INTERVAL '1 day',
--   NOW() - INTERVAL '3 days'
-- );

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
