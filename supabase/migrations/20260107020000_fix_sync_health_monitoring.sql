-- Fix Sync Health Monitoring System
--
-- Problems fixed:
-- 1. Column name mismatch: view outputs 'hours_since_run', code expects 'hours_since_success'
-- 2. No registry of expected syncs - can't detect syncs that SHOULD run but never have
-- 3. Silent failures go undetected when syncs crash before logging

-- ============================================================================
-- 1. Create expected_syncs registry - single source of truth for all crons
-- ============================================================================
CREATE TABLE IF NOT EXISTS expected_syncs (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  schedule TEXT NOT NULL,              -- Cron schedule (e.g., "*/15 * * * *")
  stale_threshold_hours INTEGER NOT NULL DEFAULT 24,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE expected_syncs IS 'Registry of all sync jobs that SHOULD be running. Used to detect missing/orphaned syncs.';
COMMENT ON COLUMN expected_syncs.stale_threshold_hours IS 'Hours before this sync is considered stale. Should be ~2x the schedule interval.';

-- Populate with all syncs from vercel.json (as of 2026-01-07)
INSERT INTO expected_syncs (sync_type, display_name, schedule, stale_threshold_hours, description) VALUES
  ('inventory', 'Inventory', '*/15 * * * *', 1, 'ShipHero inventory sync every 15 min'),
  ('b2b', 'B2B Orders', '*/15 * * * *', 1, 'ShipHero B2B order sync every 15 min'),
  ('reamaze', 'Re:amaze', '*/5 * * * *', 1, 'Re:amaze ticket sync every 5 min'),
  ('klaviyo', 'Klaviyo', '0 6 * * *', 24, 'Klaviyo profile sync daily at 6 AM UTC'),
  ('shopify_stats', 'Shopify Stats', '30 5 * * *', 24, 'Shopify D2C stats daily at 5:30 AM UTC'),
  ('shopify_customers', 'Shopify Customers', '0 4 * * *', 24, 'Shopify customer sync daily at 4 AM UTC'),
  ('netsuite_customers', 'NetSuite Customers', '0 6 * * *', 24, 'NetSuite customer sync daily at 6 AM UTC'),
  ('netsuite_transactions', 'NetSuite Transactions', '5 6 * * *', 24, 'NetSuite transaction sync daily at 6:05 AM UTC'),
  ('netsuite_lineitems', 'NetSuite Line Items', '10 6 * * *', 24, 'NetSuite line items sync daily at 6:10 AM UTC'),
  ('netsuite_pl', 'NetSuite P&L', '0 8 * * *', 24, 'NetSuite P&L sync daily at 8 AM UTC'),
  ('netsuite_assembly', 'NetSuite Assembly', '0 */2 * * *', 4, 'NetSuite assembly sync every 2 hours'),
  ('backfill-warehouse', 'Warehouse Backfill', '15 * * * *', 2, 'Backfill warehouse tags hourly at :15'),
  ('meta', 'Meta Ads', '30 6 * * *', 24, 'Meta ad sync daily at 6:30 AM UTC'),
  ('google_ads', 'Google Ads', '0 7 * * *', 24, 'Google Ads sync daily at 7 AM UTC'),
  ('ad_metrics', 'Ad Metrics', '30 7 * * *', 24, 'Ad metrics computation daily at 7:30 AM UTC'),
  ('daily_snapshot', 'Daily Snapshot', '0 4 * * *', 24, 'Daily snapshot at 4 AM UTC'),
  ('weekly_maintenance', 'Weekly Maintenance', '0 2 * * 0', 168, 'Weekly maintenance Sunday 2 AM UTC'),
  ('b2b_drafts', 'B2B Drafts', '0 * * * *', 2, 'B2B draft order sync hourly'),
  ('analyze_leads', 'Lead Analysis', '30 7,13,19 * * *', 8, 'Lead analysis 3x daily'),
  ('tracking_check', 'Tracking Check', '0 * * * *', 2, 'Tracking status check hourly')
ON CONFLICT (sync_type) DO NOTHING;

-- ============================================================================
-- 2. Fix the sync_health view - rename column and add missing sync detection
-- ============================================================================
DROP VIEW IF EXISTS sync_health;

CREATE OR REPLACE VIEW sync_health AS
WITH latest_syncs AS (
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
  FROM sync_logs
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
-- Return all syncs: both those that have logged AND those that should exist but haven't
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
    WHEN l.sync_type IS NULL THEN TRUE  -- Never ran = definitely stale
    WHEN l.hours_since_success IS NULL THEN FALSE
    WHEN l.hours_since_success > COALESCE(e.stale_threshold_hours, 24) THEN TRUE
    ELSE FALSE
  END as is_stale,
  CASE WHEN l.sync_type IS NULL THEN TRUE ELSE FALSE END as never_ran
FROM expected e
FULL OUTER JOIN latest_syncs l ON l.sync_type = e.sync_type
WHERE e.is_active = TRUE OR l.sync_type IS NOT NULL;

COMMENT ON VIEW sync_health IS 'Comprehensive sync health including syncs that have never run. Use for monitoring dashboard.';

-- ============================================================================
-- 3. Add index for faster sync_logs queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sync_logs_type_started
  ON sync_logs(sync_type, started_at DESC);

-- ============================================================================
-- 4. Add updated_at trigger for expected_syncs
-- ============================================================================
CREATE OR REPLACE FUNCTION update_expected_syncs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expected_syncs_updated_at ON expected_syncs;
CREATE TRIGGER expected_syncs_updated_at
  BEFORE UPDATE ON expected_syncs
  FOR EACH ROW
  EXECUTE FUNCTION update_expected_syncs_updated_at();
