
-- =============================================
-- PHASE 1: BUDGET ACTUALS RPC FUNCTION
-- Aggregates sales at database level instead of JS
-- =============================================

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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_budget_actuals(TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;
