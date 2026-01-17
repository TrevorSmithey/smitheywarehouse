-- Create v_b2b_customers view
-- SINGLE SOURCE OF TRUTH for B2B customer analytics
--
-- This view computes:
-- - days_since_last_sale: Days since last transaction
-- - computed_retention_health: healthy/at_risk/churning/churned based on days
-- - is_active_door: TRUE if <365 days AND NOT manually_churned
--
-- Used by both Wholesale and Door Health dashboards to ensure
-- "Active Doors" count is identical across all views.

CREATE OR REPLACE VIEW v_b2b_customers AS
SELECT
  *,
  -- Computed days since last sale
  CASE
    WHEN last_sale_date IS NOT NULL
    THEN FLOOR(EXTRACT(EPOCH FROM NOW() - last_sale_date::timestamp) / 86400)::integer
    ELSE NULL
  END AS days_since_last_sale,

  -- Computed retention health bucket
  CASE
    WHEN last_sale_date IS NULL THEN 'churned'
    WHEN FLOOR(EXTRACT(EPOCH FROM NOW() - last_sale_date::timestamp) / 86400) < 180 THEN 'healthy'
    WHEN FLOOR(EXTRACT(EPOCH FROM NOW() - last_sale_date::timestamp) / 86400) < 270 THEN 'at_risk'
    WHEN FLOOR(EXTRACT(EPOCH FROM NOW() - last_sale_date::timestamp) / 86400) < 365 THEN 'churning'
    ELSE 'churned'
  END AS computed_retention_health,

  -- Is this customer an "Active Door"?
  -- TRUE if: has ordered within 365 days AND not manually marked as churned
  CASE
    WHEN last_sale_date IS NULL THEN false
    WHEN FLOOR(EXTRACT(EPOCH FROM NOW() - last_sale_date::timestamp) / 86400) >= 365 THEN false
    WHEN COALESCE(is_manually_churned, false) = true THEN false
    ELSE true
  END AS is_active_door
FROM ns_wholesale_customers
WHERE
  -- Exclude inactive customers
  COALESCE(is_inactive, false) = false
  -- Exclude explicitly excluded customers (is_excluded flag)
  AND COALESCE(is_excluded, false) = false
  -- Exclude corporate gifting (is_corporate is GENERATED from is_corporate_gifting)
  AND COALESCE(is_corporate, false) = false
  -- Must have at least one order
  AND COALESCE(lifetime_orders, 0) > 0;

-- Add comment for documentation
COMMENT ON VIEW v_b2b_customers IS 'Single source of truth for B2B customer analytics. Filters out inactive, excluded, and corporate customers. Computes is_active_door for consistent Active Doors count across dashboards.';
