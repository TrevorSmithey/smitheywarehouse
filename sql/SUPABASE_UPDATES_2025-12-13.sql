-- =============================================
-- SUPABASE UPDATES - December 13, 2025
-- Run these SQL statements in your Supabase SQL Editor
-- =============================================

-- =============================================
-- PART 1: B2B Soft-Delete Column Migration
-- =============================================
-- Add cancelled_at column to b2b_fulfilled table for soft-delete functionality
-- This preserves audit history instead of permanently deleting cancelled orders

ALTER TABLE b2b_fulfilled
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL;

-- Add partial index for filtering out cancelled orders (improves query performance)
CREATE INDEX IF NOT EXISTS idx_b2b_fulfilled_cancelled_at
ON b2b_fulfilled (cancelled_at)
WHERE cancelled_at IS NULL;

-- Comment for documentation
COMMENT ON COLUMN b2b_fulfilled.cancelled_at IS 'Timestamp when order was cancelled. NULL means active order.';

-- =============================================
-- PART 2: Update RPC Function to Filter Cancelled Orders
-- =============================================
-- The get_budget_actuals_v2 function needs to exclude cancelled B2B orders
-- We add "AND b.cancelled_at IS NULL" to the wholesale_sales CTE

DROP FUNCTION IF EXISTS get_budget_actuals_v2(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION get_budget_actuals_v2(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE(
  sku TEXT,
  display_name TEXT,
  category TEXT,
  retail_qty BIGINT,
  wholesale_qty BIGINT,
  total_qty BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH retail_sales AS (
    -- D2C sales: ALL orders (including cancelled) to match Excel/Coupler methodology
    SELECT
      lower(li.sku) AS sku_lower,
      SUM(li.quantity) AS qty
    FROM line_items li
    JOIN orders o ON li.order_id = o.id
    WHERE o.created_at >= p_start_date
      AND o.created_at < p_end_date
      AND li.sku IS NOT NULL
    -- NOTE: No canceled = false filter - we include ALL orders like Excel does
    GROUP BY lower(li.sku)
  ),
  wholesale_sales AS (
    -- B2B sales: ALL active (non-cancelled) orders from b2b_fulfilled
    -- Uses created_at (order date) for date filtering
    SELECT
      lower(b.sku) AS sku_lower,
      SUM(b.quantity) AS qty
    FROM b2b_fulfilled b
    WHERE b.created_at >= p_start_date
      AND b.created_at < p_end_date
      AND b.sku IS NOT NULL
      AND b.cancelled_at IS NULL  -- ADDED: Filter out cancelled B2B orders
    GROUP BY lower(b.sku)
  )
  SELECT
    p.sku,
    p.display_name,
    p.category,
    COALESCE(r.qty, 0)::BIGINT AS retail_qty,
    COALESCE(w.qty, 0)::BIGINT AS wholesale_qty,
    (COALESCE(r.qty, 0) + COALESCE(w.qty, 0))::BIGINT AS total_qty
  FROM products p
  LEFT JOIN retail_sales r ON lower(p.sku) = r.sku_lower
  LEFT JOIN wholesale_sales w ON lower(p.sku) = w.sku_lower
  WHERE p.is_active = true
  ORDER BY p.sku;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_budget_actuals_v2(TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;

-- =============================================
-- PART 3: Update Legacy get_budget_actuals v1 RPC
-- =============================================
-- This function is used by deprecated scripts but should still filter cancelled orders

DROP FUNCTION IF EXISTS get_budget_actuals(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION get_budget_actuals(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE(
  sku TEXT,
  display_name TEXT,
  category TEXT,
  retail_qty BIGINT,
  b2b_qty BIGINT,
  total_qty BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH retail_sales AS (
    SELECT
      lower(li.sku) AS sku_lower,
      SUM(li.quantity) AS qty
    FROM line_items li
    JOIN orders o ON li.order_id = o.id
    WHERE o.created_at >= p_start_date
      AND o.created_at < p_end_date
      AND o.canceled = false
      AND li.sku IS NOT NULL
    GROUP BY lower(li.sku)
  ),
  b2b_sales AS (
    SELECT
      lower(b.sku) AS sku_lower,
      SUM(b.quantity) AS qty
    FROM b2b_fulfilled b
    WHERE b.fulfilled_at >= p_start_date
      AND b.fulfilled_at < p_end_date
      AND b.sku IS NOT NULL
      AND b.cancelled_at IS NULL  -- ADDED: Filter out cancelled B2B orders
    GROUP BY lower(b.sku)
  )
  SELECT
    p.sku,
    p.display_name,
    p.category,
    COALESCE(r.qty, 0)::BIGINT AS retail_qty,
    COALESCE(b.qty, 0)::BIGINT AS b2b_qty,
    (COALESCE(r.qty, 0) + COALESCE(b.qty, 0))::BIGINT AS total_qty
  FROM products p
  LEFT JOIN retail_sales r ON lower(p.sku) = r.sku_lower
  LEFT JOIN b2b_sales b ON lower(p.sku) = b.sku_lower
  WHERE p.is_active = true
  ORDER BY p.sku;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_budget_actuals(TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;

-- =============================================
-- VERIFICATION QUERIES (Run after applying above)
-- =============================================

-- Verify the column was added:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'b2b_fulfilled' AND column_name = 'cancelled_at';

-- Verify the index was created:
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'b2b_fulfilled' AND indexname LIKE '%cancelled%';

-- Test the updated function (should work without errors):
-- SELECT * FROM get_budget_actuals_v2(
--   '2025-12-01T00:00:00Z'::TIMESTAMPTZ,
--   '2025-12-31T23:59:59Z'::TIMESTAMPTZ
-- ) LIMIT 5;
