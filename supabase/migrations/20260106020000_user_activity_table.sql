-- Create user_activity table for tracking logins, page views, and other user actions
-- This powers the admin panel's activity log, sparklines, and quick stats

CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('login', 'logout', 'page_view', 'failed_login')),
  tab TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for efficient queries by user
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);

-- Index for efficient queries by action type
CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity(action);

-- Index for efficient queries by time (used for stats and activity log)
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC);

-- Composite index for filtering activity by user within time range
CREATE INDEX IF NOT EXISTS idx_user_activity_user_time ON user_activity(user_id, created_at DESC);

-- Enable Row Level Security (RLS) - only service role can access
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can insert/read (no direct client access)
CREATE POLICY "Service role only" ON user_activity
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Comment for documentation
COMMENT ON TABLE user_activity IS 'Tracks user activity (logins, page views) for admin analytics and security monitoring';
COMMENT ON COLUMN user_activity.user_id IS 'Nullable to support failed_login events where no user is matched';
COMMENT ON COLUMN user_activity.action IS 'One of: login, logout, page_view, failed_login';
COMMENT ON COLUMN user_activity.tab IS 'Dashboard tab name for page_view events';
COMMENT ON COLUMN user_activity.metadata IS 'Additional context (e.g., partial PIN for failed_login)';
