-- Advisory Lock System for Cron Jobs
-- Prevents duplicate concurrent runs of the same sync job
-- Uses PostgreSQL advisory locks which are automatically released on session end

-- Function to acquire a named advisory lock
-- Returns true if lock acquired, false if another process holds it
CREATE OR REPLACE FUNCTION acquire_sync_lock(lock_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  lock_id BIGINT;
  acquired BOOLEAN;
BEGIN
  -- Convert lock name to a consistent hash for the advisory lock
  lock_id := hashtext(lock_name)::BIGINT;

  -- Try to acquire the lock (non-blocking)
  SELECT pg_try_advisory_lock(lock_id) INTO acquired;

  IF acquired THEN
    -- Log lock acquisition for debugging
    INSERT INTO sync_lock_log (lock_name, lock_id, action, acquired_at)
    VALUES (lock_name, lock_id, 'acquired', NOW())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN acquired;
END;
$$ LANGUAGE plpgsql;

-- Function to release a named advisory lock
CREATE OR REPLACE FUNCTION release_sync_lock(lock_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  lock_id BIGINT;
  released BOOLEAN;
BEGIN
  lock_id := hashtext(lock_name)::BIGINT;

  SELECT pg_advisory_unlock(lock_id) INTO released;

  IF released THEN
    -- Log lock release
    UPDATE sync_lock_log
    SET released_at = NOW(), action = 'released'
    WHERE lock_name = release_sync_lock.lock_name
      AND released_at IS NULL;
  END IF;

  RETURN released;
END;
$$ LANGUAGE plpgsql;

-- Table to track lock history (for debugging race conditions)
CREATE TABLE IF NOT EXISTS sync_lock_log (
  id SERIAL PRIMARY KEY,
  lock_name TEXT NOT NULL,
  lock_id BIGINT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('acquired', 'released', 'failed')),
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying active locks
CREATE INDEX IF NOT EXISTS idx_sync_lock_log_active
ON sync_lock_log(lock_name, acquired_at DESC)
WHERE released_at IS NULL;

-- Auto-cleanup old lock logs (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_lock_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM sync_lock_log
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- View to see currently held locks
CREATE OR REPLACE VIEW active_sync_locks AS
SELECT
  lock_name,
  acquired_at,
  EXTRACT(EPOCH FROM (NOW() - acquired_at)) / 60 as held_minutes
FROM sync_lock_log
WHERE released_at IS NULL
  AND acquired_at > NOW() - INTERVAL '6 hours';

-- Grant permissions
GRANT EXECUTE ON FUNCTION acquire_sync_lock(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION release_sync_lock(TEXT) TO service_role;
GRANT SELECT, INSERT, UPDATE ON sync_lock_log TO service_role;
GRANT SELECT ON active_sync_locks TO service_role;

COMMENT ON FUNCTION acquire_sync_lock IS 'Acquires a named advisory lock for cron job deduplication. Returns true if lock acquired.';
COMMENT ON FUNCTION release_sync_lock IS 'Releases a named advisory lock. Should be called in finally block.';
COMMENT ON TABLE sync_lock_log IS 'Audit log for sync lock acquisitions - useful for debugging race conditions.';
