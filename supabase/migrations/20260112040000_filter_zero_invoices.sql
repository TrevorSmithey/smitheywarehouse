-- ============================================================================
-- FIX: Filter out $0 invoices from interval calculations
-- ============================================================================
--
-- PROBLEM:
-- $0 invoices (credits, adjustments, corrections) were being counted as
-- separate ordering events, creating artificial intervals.
--
-- IMPACT:
-- 224 $0 invoices across system (3% of all transactions)
-- Some customers have 10%+ $0 invoices (Ruhlin Group: 21, Forager: 3)
--
-- FIX:
-- Filter WHERE foreign_total > 0 to only count real orders.
-- ============================================================================

DROP FUNCTION IF EXISTS get_customer_order_intervals(INTEGER);

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
    -- FIX: Only count real orders, not $0 invoices (credits, adjustments)
    WHERE COALESCE(t.foreign_total, 0) > 0
  ),
  intervals AS (
    SELECT
      od.ns_customer_id,
      (od.tran_date - od.prev_date) AS interval_days
    FROM order_dates od
    WHERE od.prev_date IS NOT NULL
      -- Filter out intervals < 7 days (split shipments)
      AND (od.tran_date - od.prev_date) >= 7
  ),
  customer_valid_intervals AS (
    SELECT
      i.ns_customer_id,
      COUNT(*) AS valid_interval_count
    FROM intervals i
    GROUP BY i.ns_customer_id
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

GRANT EXECUTE ON FUNCTION get_customer_order_intervals(INTEGER) TO anon, authenticated, service_role;

COMMENT ON FUNCTION get_customer_order_intervals IS
  'Calculates order interval statistics (median, mean, std dev) for customers. '
  'Filters out: 1) $0 invoices (credits/adjustments), 2) intervals < 7 days (split shipments). '
  'Requires at least 3 valid intervals to establish a pattern.';
