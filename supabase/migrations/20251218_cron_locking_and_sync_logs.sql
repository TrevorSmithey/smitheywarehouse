-- ============================================================================
-- Cron Job Locking and Sync Logs Schema
-- Prevents duplicate cron job runs and documents sync logging infrastructure
-- ============================================================================

-- ============================================================================
-- SYNC_LOGS TABLE (document existing schema)
-- Used by all cron jobs to track execution history
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('success', 'partial', 'failed', 'running')),
  records_expected INTEGER,
  records_synced INTEGER,
  error_message TEXT,
  details JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for sync health dashboard queries (latest per type)
CREATE INDEX IF NOT EXISTS idx_sync_logs_type_started 
ON sync_logs(sync_type, started_at DESC);

-- Index for finding failed syncs
CREATE INDEX IF NOT EXISTS idx_sync_logs_status 
ON sync_logs(status) WHERE status != 'success';

-- Index for cleanup of old logs
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at
ON sync_logs(created_at);

COMMENT ON TABLE sync_logs IS 'Execution history for all cron sync jobs. Each sync creates one row.';
COMMENT ON COLUMN sync_logs.sync_type IS 'Identifier for the sync job (e.g., netsuite_customers, b2b_drafts)';
COMMENT ON COLUMN sync_logs.status IS 'Final status: success (all records), partial (some records), failed (error), running (in progress)';
COMMENT ON COLUMN sync_logs.details IS 'JSON metadata specific to each sync type (e.g., cursor position, batch info)';

-- ============================================================================
-- CRON LOCK TABLE
-- Table-based locking for cron job deduplication
-- More reliable than advisory locks across connection pools
-- ============================================================================
CREATE TABLE IF NOT EXISTS cron_locks (
  lock_name TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT, -- Optional: identify which instance holds the lock
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_cron_locks_expires 
ON cron_locks(expires_at);

COMMENT ON TABLE cron_locks IS 'Prevents duplicate cron job execution. Locks auto-expire after 10 minutes.';

-- ============================================================================
-- RPC: acquire_cron_lock
-- Attempts to acquire a named lock. Returns true if acquired, false if busy.
-- Uses INSERT with ON CONFLICT to be atomic.
-- ============================================================================
CREATE OR REPLACE FUNCTION acquire_cron_lock(lock_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  acquired BOOLEAN := FALSE;
BEGIN
  -- First, clean up any expired locks
  DELETE FROM cron_locks WHERE expires_at < NOW();
  
  -- Try to insert a new lock (will fail if lock exists and not expired)
  BEGIN
    INSERT INTO cron_locks (lock_name, locked_at, expires_at)
    VALUES (lock_name, NOW(), NOW() + INTERVAL '10 minutes');
    acquired := TRUE;
  EXCEPTION WHEN unique_violation THEN
    -- Lock already exists - check if it's expired
    DELETE FROM cron_locks 
    WHERE cron_locks.lock_name = acquire_cron_lock.lock_name 
      AND expires_at < NOW();
    
    IF FOUND THEN
      -- Expired lock was removed, try again
      INSERT INTO cron_locks (lock_name, locked_at, expires_at)
      VALUES (lock_name, NOW(), NOW() + INTERVAL '10 minutes');
      acquired := TRUE;
    END IF;
  END;
  
  RETURN acquired;
END;
$$;

-- ============================================================================
-- RPC: release_cron_lock
-- Releases a named lock. Safe to call even if lock doesn't exist.
-- ============================================================================
CREATE OR REPLACE FUNCTION release_cron_lock(lock_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM cron_locks WHERE cron_locks.lock_name = release_cron_lock.lock_name;
  RETURN FOUND;
END;
$$;

-- ============================================================================
-- RPC: check_cron_lock
-- Check if a lock is currently held (for monitoring)
-- ============================================================================
CREATE OR REPLACE FUNCTION check_cron_lock(lock_name TEXT)
RETURNS TABLE (
  is_locked BOOLEAN,
  locked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  seconds_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    TRUE as is_locked,
    cl.locked_at,
    cl.expires_at,
    EXTRACT(EPOCH FROM (cl.expires_at - NOW()))::INTEGER as seconds_remaining
  FROM cron_locks cl
  WHERE cl.lock_name = check_cron_lock.lock_name
    AND cl.expires_at > NOW();
  
  -- If no rows returned, lock is not held
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::INTEGER;
  END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION acquire_cron_lock(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION release_cron_lock(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION check_cron_lock(TEXT) TO service_role;

-- ============================================================================
-- SYNC HEALTH VIEW
-- Aggregates latest sync status for each job type
-- ============================================================================
CREATE OR REPLACE VIEW sync_health AS
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
  ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(completed_at, started_at))) / 3600, 1) as hours_since_run
FROM sync_logs
ORDER BY sync_type, started_at DESC;

COMMENT ON VIEW sync_health IS 'Latest sync status for each job type. Use for monitoring dashboard.';
