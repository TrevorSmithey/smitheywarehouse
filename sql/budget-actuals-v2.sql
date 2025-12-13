-- =============================================
-- BUDGET ACTUALS V2 RPC FUNCTION
-- Optimized aggregation matching Excel methodology:
-- - D2C: ALL orders (including cancelled) from line_items/orders
-- - B2B: ALL orders from b2b_fulfilled using created_at (order date)
-- - Channel breakdowns: retail vs wholesale
-- =============================================

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
    -- B2B sales: ALL orders from b2b_fulfilled using created_at (order date)
    -- b2b_fulfilled stores order creation date in 'created_at' field
    SELECT
      lower(b.sku) AS sku_lower,
      SUM(b.quantity) AS qty
    FROM b2b_fulfilled b
    WHERE b.created_at >= p_start_date
      AND b.created_at < p_end_date
      AND b.sku IS NOT NULL
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

-- Add index for b2b_fulfilled.created_at if not exists (for optimal query performance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_fulfilled_created_at
  ON b2b_fulfilled(created_at);
