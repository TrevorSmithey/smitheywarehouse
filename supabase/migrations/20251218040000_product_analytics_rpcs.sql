-- Product Analytics RPCs for Cross-Sell Analysis
-- Computation RPC + Query RPCs

-- ============================================================================
-- COMPUTATION RPC: compute_product_analytics
-- Runs nightly to populate all three analytics tables
-- ============================================================================
CREATE OR REPLACE FUNCTION compute_product_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '600000'  -- 10 minute timeout for heavy computation
AS $$
DECLARE
  result JSONB;
  start_time TIMESTAMPTZ;
BEGIN
  start_time := NOW();

  -- 1. PRODUCT REPEAT RATES
  -- For each customer's first order, extract products
  -- Track if that customer ever ordered again

  TRUNCATE product_repeat_rates;

  INSERT INTO product_repeat_rates (product_title, product_sku, category, first_buyers, repeat_buyers, repeat_rate, avg_days_to_second)
  WITH first_orders AS (
    SELECT
      o.shopify_customer_id,
      o.id as order_id,
      o.created_at as first_order_date,
      li.title,
      li.sku
    FROM orders o
    JOIN line_items li ON li.order_id = o.id
    WHERE o.canceled = false
      AND o.financial_status != 'refunded'
      AND o.shopify_customer_id IS NOT NULL
      AND o.created_at = (
        SELECT MIN(o2.created_at)
        FROM orders o2
        WHERE o2.shopify_customer_id = o.shopify_customer_id
          AND o2.canceled = false
          AND o2.financial_status != 'refunded'
      )
  ),
  customer_orders AS (
    SELECT
      shopify_customer_id,
      COUNT(DISTINCT id) as total_orders,
      MIN(created_at) as first_order_date,
      (ARRAY_AGG(created_at ORDER BY created_at))[2] as second_order_date
    FROM orders
    WHERE canceled = false AND financial_status != 'refunded'
    GROUP BY shopify_customer_id
  )
  SELECT
    fo.title,
    fo.sku,
    CASE
      WHEN fo.title ILIKE '%set%' THEN 'set'
      WHEN fo.title ILIKE '%skillet%' OR fo.title ILIKE '%no.%' THEN 'skillet'
      WHEN fo.title ILIKE '%dutch%' THEN 'dutch_oven'
      WHEN fo.title ILIKE '%carbon%' THEN 'carbon_steel'
      WHEN fo.title ILIKE '%scrubber%' OR fo.title ILIKE '%oil%' OR fo.title ILIKE '%sleeve%'
           OR fo.title ILIKE '%spatula%' OR fo.title ILIKE '%lid%' THEN 'accessory'
      ELSE 'other'
    END as category,
    COUNT(DISTINCT fo.shopify_customer_id) as first_buyers,
    COUNT(DISTINCT CASE WHEN co.total_orders > 1 THEN fo.shopify_customer_id END) as repeat_buyers,
    ROUND(COUNT(DISTINCT CASE WHEN co.total_orders > 1 THEN fo.shopify_customer_id END)::numeric
          / NULLIF(COUNT(DISTINCT fo.shopify_customer_id), 0) * 100, 1) as repeat_rate,
    AVG(CASE WHEN co.second_order_date IS NOT NULL
        THEN EXTRACT(DAY FROM co.second_order_date - co.first_order_date) END) as avg_days
  FROM first_orders fo
  JOIN customer_orders co ON co.shopify_customer_id = fo.shopify_customer_id
  GROUP BY fo.title, fo.sku, 3
  HAVING COUNT(DISTINCT fo.shopify_customer_id) >= 50;  -- minimum sample size

  -- 2. CROSS-SELL SEQUENCES
  -- For customers with 2+ orders, what did they buy on order 2?

  TRUNCATE cross_sell_sequences;

  INSERT INTO cross_sell_sequences (first_product, second_product, sequence_count, avg_days_between)
  WITH customer_order_sequence AS (
    SELECT
      o.shopify_customer_id,
      o.id as order_id,
      o.created_at,
      ROW_NUMBER() OVER (PARTITION BY o.shopify_customer_id ORDER BY o.created_at) as order_num
    FROM orders o
    WHERE o.canceled = false
      AND o.financial_status != 'refunded'
      AND o.shopify_customer_id IS NOT NULL
  ),
  first_order_items AS (
    SELECT cos.shopify_customer_id, li.title as first_product, cos.created_at as first_date
    FROM customer_order_sequence cos
    JOIN line_items li ON li.order_id = cos.order_id
    WHERE cos.order_num = 1
  ),
  second_order_items AS (
    SELECT cos.shopify_customer_id, li.title as second_product, cos.created_at as second_date
    FROM customer_order_sequence cos
    JOIN line_items li ON li.order_id = cos.order_id
    WHERE cos.order_num = 2
  )
  SELECT
    foi.first_product,
    soi.second_product,
    COUNT(*) as sequence_count,
    AVG(EXTRACT(DAY FROM soi.second_date - foi.first_date))::int as avg_days
  FROM first_order_items foi
  JOIN second_order_items soi ON soi.shopify_customer_id = foi.shopify_customer_id
  WHERE foi.first_product != soi.second_product  -- exclude re-buying same item
  GROUP BY foi.first_product, soi.second_product
  HAVING COUNT(*) >= 20;  -- minimum sequence count

  -- 3. BASKET AFFINITY
  -- Products bought together in same order

  TRUNCATE basket_affinity;

  INSERT INTO basket_affinity (product_a, product_b, co_occurrence, support, confidence_a_to_b, confidence_b_to_a)
  WITH order_items AS (
    SELECT DISTINCT o.id as order_id, li.title
    FROM orders o
    JOIN line_items li ON li.order_id = o.id
    WHERE o.canceled = false AND o.financial_status != 'refunded'
  ),
  total_orders AS (SELECT COUNT(DISTINCT order_id) as cnt FROM order_items),
  product_counts AS (
    SELECT title, COUNT(DISTINCT order_id) as order_count
    FROM order_items
    GROUP BY title
  ),
  pairs AS (
    SELECT
      a.title as product_a,
      b.title as product_b,
      COUNT(DISTINCT a.order_id) as co_occurrence
    FROM order_items a
    JOIN order_items b ON a.order_id = b.order_id AND a.title < b.title
    GROUP BY a.title, b.title
    HAVING COUNT(DISTINCT a.order_id) >= 50
  )
  SELECT
    p.product_a,
    p.product_b,
    p.co_occurrence,
    ROUND(p.co_occurrence::numeric / t.cnt, 4) as support,
    ROUND(p.co_occurrence::numeric / pc_a.order_count, 4) as confidence_a_to_b,
    ROUND(p.co_occurrence::numeric / pc_b.order_count, 4) as confidence_b_to_a
  FROM pairs p
  CROSS JOIN total_orders t
  JOIN product_counts pc_a ON pc_a.title = p.product_a
  JOIN product_counts pc_b ON pc_b.title = p.product_b;

  SELECT jsonb_build_object(
    'product_repeat_rates', (SELECT COUNT(*) FROM product_repeat_rates),
    'cross_sell_sequences', (SELECT COUNT(*) FROM cross_sell_sequences),
    'basket_affinity', (SELECT COUNT(*) FROM basket_affinity),
    'computed_at', NOW(),
    'duration_seconds', EXTRACT(EPOCH FROM (NOW() - start_time))
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================================
-- QUERY RPC: get_product_repeat_rates
-- Fast read from pre-computed table
-- ============================================================================
CREATE OR REPLACE FUNCTION get_product_repeat_rates(
  p_category TEXT DEFAULT NULL,
  p_min_buyers INT DEFAULT 100,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  product_title TEXT,
  category TEXT,
  first_buyers INT,
  repeat_buyers INT,
  repeat_rate DECIMAL,
  avg_days_to_second DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.product_title,
    pr.category,
    pr.first_buyers,
    pr.repeat_buyers,
    pr.repeat_rate,
    pr.avg_days_to_second
  FROM product_repeat_rates pr
  WHERE (p_category IS NULL OR pr.category = p_category)
    AND pr.first_buyers >= p_min_buyers
  ORDER BY pr.repeat_rate DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- QUERY RPC: get_cross_sell_for_product
-- Get cross-sell sequences for a specific product
-- ============================================================================
CREATE OR REPLACE FUNCTION get_cross_sell_for_product(
  p_product TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  second_product TEXT,
  sequence_count INT,
  avg_days_between INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.second_product,
    cs.sequence_count,
    cs.avg_days_between
  FROM cross_sell_sequences cs
  WHERE cs.first_product ILIKE '%' || p_product || '%'
  ORDER BY cs.sequence_count DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- QUERY RPC: get_basket_affinity
-- Get basket affinity pairs, optionally filtered by product
-- ============================================================================
CREATE OR REPLACE FUNCTION get_basket_affinity(
  p_product TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  product_a TEXT,
  product_b TEXT,
  co_occurrence INT,
  confidence DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ba.product_a,
    ba.product_b,
    ba.co_occurrence,
    GREATEST(ba.confidence_a_to_b, ba.confidence_b_to_a) as confidence
  FROM basket_affinity ba
  WHERE p_product IS NULL
    OR ba.product_a ILIKE '%' || p_product || '%'
    OR ba.product_b ILIKE '%' || p_product || '%'
  ORDER BY ba.co_occurrence DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- QUERY RPC: get_top_gateway_products
-- Get products with highest repeat rates (gateway products)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_top_gateway_products(
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  product_title TEXT,
  category TEXT,
  first_buyers INT,
  repeat_rate DECIMAL,
  avg_days_to_second DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.product_title,
    pr.category,
    pr.first_buyers,
    pr.repeat_rate,
    pr.avg_days_to_second
  FROM product_repeat_rates pr
  WHERE pr.first_buyers >= 500  -- significant sample size
  ORDER BY pr.repeat_rate DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION compute_product_analytics() TO service_role;
GRANT EXECUTE ON FUNCTION get_product_repeat_rates(TEXT, INT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_cross_sell_for_product(TEXT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_basket_affinity(TEXT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_top_gateway_products(INT) TO anon, authenticated, service_role;
