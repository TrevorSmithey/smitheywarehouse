-- ============================================================================
-- UPGRADE: Replace historical median with EWMA (Exponentially Weighted Moving Average)
-- ============================================================================
--
-- PROBLEM:
-- Historical median doesn't reflect when customer behavior changes.
-- Forager's historical median is 18 days, but their recent pattern is 50 days.
-- This made them perpetually appear "critical" when they're actually on-pattern.
--
-- SOLUTION:
-- EWMA naturally weights recent intervals more heavily.
-- With α=0.3, recent behavior dominates while historical data provides stability.
--
-- FORMULA: EMA_n = α × value_n + (1 - α) × EMA_{n-1}
--
-- VALIDATION:
-- - Forager: 18d → 49d (reflects actual recent behavior)
-- - Woody's: 91d → 118d (slight increase, mostly stable)
-- - Blackberry: 28d → 27d (stable customer, minimal change)
-- ============================================================================

-- Drop the existing function to recreate with new return type
DROP FUNCTION IF EXISTS get_customer_order_intervals(INTEGER);

-- Recreate with EWMA calculation
CREATE OR REPLACE FUNCTION get_customer_order_intervals(min_order_count INTEGER DEFAULT 4)
RETURNS TABLE(
  ns_customer_id INTEGER,
  median_interval NUMERIC,      -- Keep for reference (historical)
  ewma_interval NUMERIC,        -- NEW: EWMA-based typical interval
  mean_interval NUMERIC,
  std_dev NUMERIC,
  p75_interval NUMERIC,         -- 75th percentile for overdue threshold
  interval_count INTEGER        -- Number of valid intervals
) AS $$
BEGIN
  RETURN QUERY
  WITH order_dates AS (
    SELECT
      t.ns_customer_id,
      t.tran_date,
      LAG(t.tran_date) OVER (PARTITION BY t.ns_customer_id ORDER BY t.tran_date) AS prev_date
    FROM ns_wholesale_transactions t
    -- Filter out $0 invoices (credits, adjustments)
    WHERE COALESCE(t.foreign_total, 0) > 0
  ),
  intervals AS (
    SELECT
      od.ns_customer_id,
      od.tran_date,
      (od.tran_date - od.prev_date) AS interval_days,
      ROW_NUMBER() OVER (PARTITION BY od.ns_customer_id ORDER BY od.tran_date) AS interval_num,
      COUNT(*) OVER (PARTITION BY od.ns_customer_id) AS total_intervals
    FROM order_dates od
    WHERE od.prev_date IS NOT NULL
      -- Filter out intervals < 7 days (split shipments)
      AND (od.tran_date - od.prev_date) >= 7
  ),
  -- Filter to customers with at least 3 valid intervals
  valid_customers AS (
    SELECT DISTINCT ns_customer_id
    FROM intervals
    WHERE total_intervals >= 3
  ),
  -- Calculate EWMA using recursive-like approach
  -- Weight = α * (1-α)^(total_intervals - interval_num) where α = 0.3
  ewma_calc AS (
    SELECT
      i.ns_customer_id,
      i.interval_days,
      i.interval_num,
      i.total_intervals,
      -- Calculate weight: most recent gets highest weight
      -- Using α = 0.3, so decay factor = 0.7
      POWER(0.7, i.total_intervals - i.interval_num)::NUMERIC AS weight
    FROM intervals i
    JOIN valid_customers vc ON i.ns_customer_id = vc.ns_customer_id
  ),
  ewma_weighted AS (
    SELECT
      ns_customer_id,
      -- EWMA approximation: weighted average with exponential decay
      SUM(interval_days * weight) / NULLIF(SUM(weight), 0) AS ewma_value
    FROM ewma_calc
    GROUP BY ns_customer_id
  )
  SELECT
    i.ns_customer_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.interval_days)::NUMERIC AS median_interval,
    COALESCE(ew.ewma_value, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.interval_days))::NUMERIC AS ewma_interval,
    AVG(i.interval_days)::NUMERIC AS mean_interval,
    STDDEV(i.interval_days)::NUMERIC AS std_dev,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY i.interval_days)::NUMERIC AS p75_interval,
    COUNT(*)::INTEGER AS interval_count
  FROM intervals i
  JOIN valid_customers vc ON i.ns_customer_id = vc.ns_customer_id
  LEFT JOIN ewma_weighted ew ON i.ns_customer_id = ew.ns_customer_id
  GROUP BY i.ns_customer_id, ew.ewma_value;
END;
$$ LANGUAGE plpgsql STABLE;

-- Also create single-customer version for detail page
DROP FUNCTION IF EXISTS get_single_customer_order_intervals(INTEGER);

CREATE OR REPLACE FUNCTION get_single_customer_order_intervals(target_customer_id INTEGER)
RETURNS TABLE(
  ns_customer_id INTEGER,
  median_interval NUMERIC,
  ewma_interval NUMERIC,
  mean_interval NUMERIC,
  std_dev NUMERIC,
  p75_interval NUMERIC,
  interval_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH order_dates AS (
    SELECT
      t.ns_customer_id,
      t.tran_date,
      LAG(t.tran_date) OVER (ORDER BY t.tran_date) AS prev_date
    FROM ns_wholesale_transactions t
    WHERE t.ns_customer_id = target_customer_id
      AND COALESCE(t.foreign_total, 0) > 0
  ),
  intervals AS (
    SELECT
      od.tran_date,
      (od.tran_date - od.prev_date) AS interval_days,
      ROW_NUMBER() OVER (ORDER BY od.tran_date) AS interval_num,
      COUNT(*) OVER () AS total_intervals
    FROM order_dates od
    WHERE od.prev_date IS NOT NULL
      AND (od.tran_date - od.prev_date) >= 7
  ),
  ewma_calc AS (
    SELECT
      interval_days,
      POWER(0.7, total_intervals - interval_num)::NUMERIC AS weight
    FROM intervals
    WHERE total_intervals >= 3
  )
  SELECT
    target_customer_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.interval_days)::NUMERIC,
    COALESCE(
      (SELECT SUM(interval_days * weight) / NULLIF(SUM(weight), 0) FROM ewma_calc),
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.interval_days)
    )::NUMERIC,
    AVG(i.interval_days)::NUMERIC,
    STDDEV(i.interval_days)::NUMERIC,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY i.interval_days)::NUMERIC,
    COUNT(*)::INTEGER
  FROM intervals i
  HAVING COUNT(*) >= 3;
END;
$$ LANGUAGE plpgsql STABLE;

-- Permissions
GRANT EXECUTE ON FUNCTION get_customer_order_intervals(INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_single_customer_order_intervals(INTEGER) TO anon, authenticated, service_role;

-- Comments
COMMENT ON FUNCTION get_customer_order_intervals IS
  'Calculates order interval statistics including EWMA (α=0.3) for typical interval. '
  'EWMA weights recent behavior more heavily, adapting to pattern changes. '
  'Filters: $0 invoices excluded, intervals < 7 days excluded (split shipments).';

COMMENT ON FUNCTION get_single_customer_order_intervals IS
  'Single-customer version of get_customer_order_intervals. '
  'More efficient for detail page - avoids computing 700+ customers.';
