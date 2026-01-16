-- Migration: Simplify Customer Segments from 6-tier to 3-tier
-- Date: 2026-01-15
--
-- Changes:
--   1. Migrate existing segment values: large → major, starter/minimal → small
--   2. Update compute_customer_metrics() with simplified thresholds:
--      - major: >= $20,000
--      - mid: >= $5,000
--      - small: < $5,000
--
-- Rationale: The 6-tier system was too granular for actionable sales prioritization.
-- The new 3-tier system creates clear buckets: Key accounts (Major), Growth (Mid), Emerging (Small).

-- Step 1: Migrate existing segment values
UPDATE ns_wholesale_customers
SET segment = CASE
  WHEN segment = 'large' THEN 'major'
  WHEN segment IN ('starter', 'minimal') THEN 'small'
  ELSE segment
END
WHERE segment IN ('large', 'starter', 'minimal');

-- Step 2: Replace compute_customer_metrics() with simplified segment logic
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
      THEN (CURRENT_DATE - cs.last_sale_date)
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

  -- Compute health_status based on order patterns (unchanged)
  UPDATE ns_wholesale_customers c
  SET health_status = (CASE
    WHEN c.first_sale_date >= CURRENT_DATE - INTERVAL '90 days' THEN 'new'
    WHEN COALESCE(c.lifetime_orders, 0) = 1 THEN 'one_time'
    WHEN c.days_since_last_order >= 365 THEN 'churned'
    WHEN c.days_since_last_order >= 270 THEN 'churning'
    WHEN c.days_since_last_order >= 180 THEN 'at_risk'
    WHEN COALESCE(c.yoy_revenue_change_pct, 0) < -20 THEN 'declining'
    WHEN COALESCE(c.yoy_revenue_change_pct, 0) > 20 AND c.days_since_last_order < 90 THEN 'thriving'
    WHEN c.days_since_last_order < 180 THEN 'stable'
    ELSE 'at_risk'
  END)::customer_health_status,
  is_at_risk = CASE
    WHEN c.days_since_last_order >= 180 THEN true
    ELSE false
  END
  WHERE c.lifetime_orders > 0 OR c.first_sale_date IS NOT NULL;

  -- UPDATED 2026-01-15: Simplified 3-tier segment classification
  -- - major: >= $20,000 lifetime revenue (key accounts)
  -- - mid: >= $5,000 lifetime revenue (growth accounts)
  -- - small: < $5,000 lifetime revenue (emerging accounts)
  UPDATE ns_wholesale_customers c
  SET segment = (CASE
    WHEN COALESCE(c.lifetime_revenue, 0) >= 20000 THEN 'major'
    WHEN COALESCE(c.lifetime_revenue, 0) >= 5000 THEN 'mid'
    ELSE 'small'
  END)::customer_segment;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compute_customer_metrics IS 'Computes derived fields for wholesale customers. Updated 2026-01-15: Simplified to 3-tier segments (major >= $20k, mid >= $5k, small < $5k).';
