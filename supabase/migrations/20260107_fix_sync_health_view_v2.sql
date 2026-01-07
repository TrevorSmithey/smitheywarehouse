-- Fix Sync Health View to Include ad_sync_logs
--
-- Problem: sync_health view only looked at sync_logs table, missing ad_sync_logs
-- which is where Meta, Google, and compute_ad_metrics log.
--
-- Also fixes expected_syncs naming mismatches.

-- ============================================================================
-- 1. Fix expected_syncs naming to match actual sync_type values
-- ============================================================================
UPDATE expected_syncs SET sync_type = 'google' WHERE sync_type = 'google_ads';
UPDATE expected_syncs SET sync_type = 'compute_ad_metrics' WHERE sync_type = 'ad_metrics';
UPDATE expected_syncs SET sync_type = 'lead_analysis' WHERE sync_type = 'analyze_leads';
UPDATE expected_syncs SET sync_type = 'daily-snapshot' WHERE sync_type = 'daily_snapshot';
UPDATE expected_syncs SET sync_type = 'weekly_maintenance' WHERE sync_type = 'weekly-maintenance';
UPDATE expected_syncs SET sync_type = 'b2b_draft_orders' WHERE sync_type = 'b2b_drafts';
UPDATE expected_syncs SET sync_type = 'tracking_check' WHERE sync_type = 'tracking-check';

-- ============================================================================
-- 2. Update sync_health view to UNION sync_logs and ad_sync_logs
-- ============================================================================
DROP VIEW IF EXISTS sync_health;

CREATE OR REPLACE VIEW sync_health AS
WITH all_sync_logs AS (
  -- Regular sync_logs
  SELECT
    sync_type,
    status,
    started_at,
    completed_at,
    records_expected,
    records_synced,
    error_message,
    duration_ms
  FROM sync_logs

  UNION ALL

  -- Ad sync logs (google, meta, compute_ad_metrics)
  SELECT
    sync_type,
    status,
    started_at,
    completed_at,
    NULL as records_expected,  -- ad_sync_logs doesn't have this column
    records_synced,
    error_message,
    NULL as duration_ms  -- ad_sync_logs stores in metadata
  FROM ad_sync_logs
),
latest_syncs AS (
  SELECT DISTINCT ON (sync_type)
    sync_type,
    status,
    started_at,
    completed_at,
    records_expected,
    records_synced,
    CASE WHEN records_expected > 0
      THEN ROUND((records_synced::NUMERIC / records_expected * 100))::INTEGER
      ELSE 100 END as success_rate,
    error_message,
    duration_ms,
    ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(completed_at, started_at))) / 3600, 1) as hours_since_success
  FROM all_sync_logs
  WHERE status != 'running'  -- Exclude stuck running entries
  ORDER BY sync_type, started_at DESC
),
expected AS (
  SELECT
    sync_type,
    display_name,
    stale_threshold_hours,
    is_active
  FROM expected_syncs
  WHERE is_active = TRUE
)
SELECT
  COALESCE(l.sync_type, e.sync_type) as sync_type,
  COALESCE(l.status, 'never_ran') as status,
  l.started_at,
  l.completed_at,
  l.records_expected,
  l.records_synced,
  COALESCE(l.success_rate, 0) as success_rate,
  COALESCE(l.error_message, CASE WHEN l.sync_type IS NULL THEN 'Sync has never run - check vercel.json and cron configuration' END) as error_message,
  l.duration_ms,
  l.hours_since_success,
  e.display_name,
  e.stale_threshold_hours,
  CASE
    WHEN l.sync_type IS NULL THEN TRUE
    WHEN l.hours_since_success IS NULL THEN FALSE
    WHEN l.hours_since_success > COALESCE(e.stale_threshold_hours, 24) THEN TRUE
    ELSE FALSE
  END as is_stale,
  CASE WHEN l.sync_type IS NULL THEN TRUE ELSE FALSE END as never_ran
FROM expected e
FULL OUTER JOIN latest_syncs l ON l.sync_type = e.sync_type
WHERE e.is_active = TRUE OR l.sync_type IS NOT NULL;

COMMENT ON VIEW sync_health IS 'Comprehensive sync health including both sync_logs and ad_sync_logs tables. Excludes stuck running entries.';
