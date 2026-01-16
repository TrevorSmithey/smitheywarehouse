-- ============================================================================
-- FIX: Order interval calculation was including split shipments
-- ============================================================================
--
-- PROBLEM:
-- The get_customer_order_intervals RPC was counting ALL intervals between
-- transactions, including same-day and next-day intervals that represent
-- split shipments (multiple invoices for one order), not separate orders.
--
-- IMPACT:
-- Customers who order quarterly (90-day intervals) were showing as ordering
-- every 15 days because split shipment intervals (1-6 days) dragged down
-- the median. This made everything appear "critical" in ordering anomalies.
--
-- EXAMPLE (Woody's Mercantile):
--   Before fix: 15 days median (WRONG)
--   After fix:  90 days median (CORRECT)
--
-- FIX:
-- Filter out intervals < 7 days to match the TypeScript logic in
-- lib/pattern-recognition.ts:155-156 which correctly excludes split shipments.
-- ============================================================================

-- Drop the old function first (required to change return type)
DROP FUNCTION IF EXISTS get_customer_order_intervals(INTEGER);

-- Recreate with the fix
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
      (od.tran_date - od.prev_date) AS interval_days
    FROM order_dates od
    WHERE od.prev_date IS NOT NULL
      -- FIX: Filter out intervals < 7 days (split shipments, not separate orders)
      -- Matches logic in lib/pattern-recognition.ts:155-156
      AND (od.tran_date - od.prev_date) >= 7
  ),
  -- Count VALID intervals (>= 7 days), not all transactions
  customer_valid_intervals AS (
    SELECT
      i.ns_customer_id,
      COUNT(*) AS valid_interval_count
    FROM intervals i
    GROUP BY i.ns_customer_id
    -- Need at least 3 valid intervals to establish a pattern
    HAVING COUNT(*) >= 3
  )
  SELECT
    i.ns_customer_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.interval_days)::NUMERIC AS median_interval,
    AVG(i.interval_days)::NUMERIC AS mean_interval,
    STDDEV(i.interval_days)::NUMERIC AS std_dev
  FROM intervals i
  JOIN customer_valid_intervals cvi ON i.ns_customer_id = cvi.ns_customer_id
  GROUP BY i.ns_customer_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Permissions
GRANT EXECUTE ON FUNCTION get_customer_order_intervals(INTEGER) TO anon, authenticated, service_role;

-- Updated comment
COMMENT ON FUNCTION get_customer_order_intervals IS
  'Calculates order interval statistics (median, mean, std dev) for customers. '
  'Filters out intervals < 7 days to exclude split shipments. '
  'Requires at least 3 valid intervals to establish a pattern.';
