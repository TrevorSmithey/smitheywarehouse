-- RPC Functions Documentation
-- This migration documents all custom RPC functions used by the application
-- Most functions already exist; this adds missing documentation and ensures permissions

-- ============================================================================
-- SYNC LOCK FUNCTIONS (from advisory_locks migration)
-- ============================================================================
-- acquire_sync_lock(lock_name TEXT) - Acquires advisory lock for cron deduplication
-- release_sync_lock(lock_name TEXT) - Releases advisory lock

-- ============================================================================
-- CUSTOMER METRICS
-- ============================================================================

-- compute_customer_metrics: Computes derived fields for wholesale customers
-- Called by: sync-netsuite-customers cron after customer sync
-- Updates: health_status, segment, days_since_last_order, yoy_revenue_change_pct, etc.
COMMENT ON FUNCTION compute_customer_metrics IS
  'Computes derived fields (health_status, segment, metrics) for wholesale customers. Called by netsuite customer sync.';

-- get_customer_order_intervals: Calculates order frequency stats for a customer
-- Called by: /api/wholesale/customer/[id] and /api/wholesale (bulk)
-- Returns: avg_days_between_orders, expected_next_order_date
COMMENT ON FUNCTION get_customer_order_intervals IS
  'Calculates average days between orders and expected next order date for a customer.';

-- ============================================================================
-- WHOLESALE ANALYTICS
-- ============================================================================

-- get_wholesale_monthly_stats: Returns monthly revenue/order stats by channel
-- Called by: /api/wholesale
-- Returns: year_month, channel, revenue, order_count, customer_count
COMMENT ON FUNCTION get_wholesale_monthly_stats IS
  'Returns monthly revenue and order statistics by sales channel (Web/Wholesale).';

-- ============================================================================
-- BUDGET/P&L FUNCTIONS
-- ============================================================================

-- get_budget_actuals_v2: Primary budget vs actuals calculation
-- Called by: /api/budget
-- Returns: SKU-level budget vs actual comparison with variance analysis
COMMENT ON FUNCTION get_budget_actuals_v2 IS
  'Calculates budget vs actual revenue by SKU for a date range. V2 includes category breakdown.';

-- ============================================================================
-- METRICS/DASHBOARD FUNCTIONS
-- ============================================================================

-- get_order_counts: Consolidated order counts by status
-- Called by: /api/metrics
-- Returns: total_orders, pending_orders, fulfilled_orders, etc.
COMMENT ON FUNCTION get_order_counts IS
  'Returns consolidated order counts by status for the metrics dashboard.';

-- get_engraving_queue_stats: Engraving queue analytics
-- Called by: /api/metrics
-- Returns: queue depth, by-SKU breakdown, estimated completion
COMMENT ON FUNCTION get_engraving_queue_stats IS
  'Returns engraving queue statistics including depth by SKU and priority.';

-- ============================================================================
-- LEAD ANALYTICS
-- ============================================================================

-- refresh_lead_funnel_stats: Materialized view refresh for lead funnel
-- Called by: /api/cron/analyze-leads
-- Updates: lead_funnel_stats materialized view
COMMENT ON FUNCTION refresh_lead_funnel_stats IS
  'Refreshes the lead_funnel_stats materialized view with current conversion data.';

-- refresh_lead_volume_by_month: Materialized view refresh for lead volume
-- Called by: /api/cron/analyze-leads
-- Updates: lead_volume_by_month materialized view
COMMENT ON FUNCTION refresh_lead_volume_by_month IS
  'Refreshes the lead_volume_by_month materialized view with current lead data.';

-- ============================================================================
-- KLAVIYO ANALYTICS
-- ============================================================================

-- calculate_klaviyo_period_stats: Period-over-period Klaviyo stats
-- Called by: /api/cron/sync-klaviyo
-- Returns: opens, clicks, revenue by period
COMMENT ON FUNCTION calculate_klaviyo_period_stats IS
  'Calculates period-over-period Klaviyo email engagement statistics.';

-- ============================================================================
-- ENSURE PERMISSIONS
-- ============================================================================

-- Grant execute permissions to service_role for all RPC functions
DO $$
DECLARE
  func_name text;
  func_list text[] := ARRAY[
    'compute_customer_metrics',
    'get_customer_order_intervals',
    'get_wholesale_monthly_stats',
    'get_budget_actuals_v2',
    'get_order_counts',
    'get_engraving_queue_stats',
    'refresh_lead_funnel_stats',
    'refresh_lead_volume_by_month',
    'calculate_klaviyo_period_stats',
    'acquire_sync_lock',
    'release_sync_lock',
    'cleanup_old_sync_logs',
    'cleanup_old_lock_logs'
  ];
BEGIN
  FOREACH func_name IN ARRAY func_list
  LOOP
    BEGIN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I TO service_role', func_name);
      RAISE NOTICE 'Granted execute on %', func_name;
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'Function % does not exist yet - skipping', func_name;
    END;
  END LOOP;
END $$;

-- ============================================================================
-- USAGE INDEX
-- ============================================================================
--
-- RPC Function                      | Called By                           | Frequency
-- ----------------------------------|-------------------------------------|----------
-- acquire_sync_lock                 | All cron jobs                       | Every cron run
-- release_sync_lock                 | All cron jobs                       | Every cron run
-- compute_customer_metrics          | sync-netsuite-customers cron        | Daily 6am
-- get_customer_order_intervals      | /api/wholesale, customer detail     | On demand
-- get_wholesale_monthly_stats       | /api/wholesale                      | On demand
-- get_budget_actuals_v2             | /api/budget                         | On demand
-- get_order_counts                  | /api/metrics                        | On demand
-- get_engraving_queue_stats         | /api/metrics                        | On demand
-- refresh_lead_funnel_stats         | /api/cron/analyze-leads             | Daily 7am
-- refresh_lead_volume_by_month      | /api/cron/analyze-leads             | Daily 7am
-- calculate_klaviyo_period_stats    | /api/cron/sync-klaviyo              | Hourly
