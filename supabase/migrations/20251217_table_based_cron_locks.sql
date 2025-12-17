-- Table-Based Cron Lock System
-- Replaces advisory locks which don't work reliably with connection pooling (PgBouncer)
--
-- Advisory locks are session-level, but Supabase REST API returns connections to the pool
-- after each query, making them unreliable for long-running jobs.
--
-- This table-based approach uses row-level locking with automatic expiration.

-- Create the locks table
CREATE TABLE IF NOT EXISTS cron_locks (
  lock_name TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT, -- Optional: identifier for the process holding the lock
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

-- Index for expired lock cleanup
CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at ON cron_locks(expires_at);

COMMENT ON TABLE cron_locks IS 'Table-based locking for cron jobs. More reliable than advisory locks with connection pooling.';

-- Replace acquire_sync_lock to use table-based locking
CREATE OR REPLACE FUNCTION acquire_sync_lock(lock_name TEXT, lock_timeout_minutes INT DEFAULT 10)
RETURNS BOOLEAN AS $$
DECLARE
  acquired BOOLEAN := FALSE;
  lock_id_val TEXT;
BEGIN
  -- Generate a unique ID for this lock attempt
  lock_id_val := gen_random_uuid()::TEXT;

  -- First, clean up any expired locks for this name
  DELETE FROM cron_locks
  WHERE cron_locks.lock_name = acquire_sync_lock.lock_name
    AND expires_at < NOW();

  -- Try to insert a new lock (will fail if lock exists and not expired)
  BEGIN
    INSERT INTO cron_locks (lock_name, locked_at, locked_by, expires_at)
    VALUES (
      acquire_sync_lock.lock_name,
      NOW(),
      lock_id_val,
      NOW() + (lock_timeout_minutes || ' minutes')::INTERVAL
    );
    acquired := TRUE;
  EXCEPTION WHEN unique_violation THEN
    -- Lock already held by another process
    acquired := FALSE;
  END;

  -- Log the attempt
  INSERT INTO sync_lock_log (lock_name, lock_id, action, acquired_at)
  VALUES (
    acquire_sync_lock.lock_name,
    hashtext(lock_name)::BIGINT,
    CASE WHEN acquired THEN 'acquired' ELSE 'failed' END,
    NOW()
  )
  ON CONFLICT DO NOTHING;

  RETURN acquired;
END;
$$ LANGUAGE plpgsql;

-- Replace release_sync_lock to use table-based locking
CREATE OR REPLACE FUNCTION release_sync_lock(lock_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  released BOOLEAN := FALSE;
BEGIN
  -- Delete the lock row
  DELETE FROM cron_locks
  WHERE cron_locks.lock_name = release_sync_lock.lock_name;

  -- Check if we deleted anything
  GET DIAGNOSTICS released = ROW_COUNT > 0;
  released := (ROW_COUNT > 0);

  -- Log the release
  UPDATE sync_lock_log
  SET released_at = NOW(), action = 'released'
  WHERE sync_lock_log.lock_name = release_sync_lock.lock_name
    AND released_at IS NULL;

  RETURN released;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired locks (can be called periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_cron_locks()
RETURNS INT AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM cron_locks
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Update the active_sync_locks view to use the new table
CREATE OR REPLACE VIEW active_sync_locks AS
SELECT
  cl.lock_name,
  cl.locked_at as acquired_at,
  cl.locked_by,
  cl.expires_at,
  EXTRACT(EPOCH FROM (NOW() - cl.locked_at)) / 60 as held_minutes,
  EXTRACT(EPOCH FROM (cl.expires_at - NOW())) / 60 as minutes_until_expiry
FROM cron_locks cl
WHERE cl.expires_at > NOW();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON cron_locks TO service_role;
GRANT EXECUTE ON FUNCTION acquire_sync_lock(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION release_sync_lock(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_cron_locks() TO service_role;

COMMENT ON FUNCTION acquire_sync_lock IS 'Acquires a table-based lock for cron job deduplication. Locks auto-expire after timeout (default 10 min). Returns true if acquired.';
COMMENT ON FUNCTION release_sync_lock IS 'Releases a cron lock. Should be called in finally block.';
COMMENT ON FUNCTION cleanup_expired_cron_locks IS 'Removes expired locks from the cron_locks table. Returns count of cleaned locks.';
