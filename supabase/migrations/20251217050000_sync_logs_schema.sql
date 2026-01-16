-- Sync Logs Schema Documentation
-- This table tracks all cron job executions for observability and debugging
-- It was created manually; this migration documents the schema and adds indexes

-- Note: Table likely already exists, using IF NOT EXISTS for safety
CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,

  -- Identifies which sync job ran
  sync_type TEXT NOT NULL,

  -- Timing information
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Execution status: 'success', 'failed', 'partial'
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'partial', 'completed')),

  -- Record counts for monitoring data completeness
  records_expected INTEGER DEFAULT 0,
  records_synced INTEGER DEFAULT 0,

  -- Error tracking
  error_message TEXT,

  -- Flexible metadata for sync-specific details (cursors, offsets, etc.)
  details JSONB,

  -- Automatic timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for recent sync status queries (dashboard health check)
CREATE INDEX IF NOT EXISTS idx_sync_logs_type_started
ON sync_logs(sync_type, started_at DESC);

-- Index for failed sync queries (alerting)
CREATE INDEX IF NOT EXISTS idx_sync_logs_status_failed
ON sync_logs(status, started_at DESC)
WHERE status = 'failed';

-- Index for cursor lookups (netsuite_lineitems_cursor)
CREATE INDEX IF NOT EXISTS idx_sync_logs_cursor_lookup
ON sync_logs(sync_type, started_at DESC)
WHERE sync_type LIKE '%_cursor';

-- Auto-cleanup: Delete sync logs older than 90 days (keeps table manageable)
CREATE OR REPLACE FUNCTION cleanup_old_sync_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM sync_logs
  WHERE started_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Grant permissions for service role
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE sync_logs_id_seq TO service_role;

-- Comments for documentation
COMMENT ON TABLE sync_logs IS 'Tracks all cron job executions for observability and debugging';
COMMENT ON COLUMN sync_logs.sync_type IS 'Identifies the sync job: netsuite_customers, netsuite_transactions, netsuite_lineitems, b2b_orders, b2b_draft_orders, klaviyo_profiles, shiphero_shipments, etc.';
COMMENT ON COLUMN sync_logs.status IS 'Execution status: success (completed fully), failed (error occurred), partial (timed out or hit limit)';
COMMENT ON COLUMN sync_logs.records_expected IS 'Number of records fetched from source system';
COMMENT ON COLUMN sync_logs.records_synced IS 'Number of records successfully written to database';
COMMENT ON COLUMN sync_logs.details IS 'JSON metadata for sync-specific data like cursor position, offset, batch count';
