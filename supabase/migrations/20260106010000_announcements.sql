-- System Announcements for Dashboard-Wide Notifications
-- Persistent banners visible to all users until dismissed per-user

-- Announcements table
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_archived BOOLEAN DEFAULT FALSE
);

-- Per-user dismissals (survives browser close, stored in DB)
CREATE TABLE IF NOT EXISTS announcement_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);

-- Index for efficient active announcements query
-- Used by: GET /api/announcements (every page load)
CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON announcements(starts_at, expires_at)
  WHERE is_archived = FALSE;

-- Index for dismissal lookups by user
CREATE INDEX IF NOT EXISTS idx_dismissals_user
  ON announcement_dismissals(user_id, announcement_id);

-- Comments for documentation
COMMENT ON TABLE announcements IS 'Dashboard-wide notifications/alerts visible to all users';
COMMENT ON COLUMN announcements.severity IS 'Visual style: info (blue), warning (amber), critical (red)';
COMMENT ON COLUMN announcements.starts_at IS 'When announcement becomes visible (supports scheduled announcements)';
COMMENT ON COLUMN announcements.expires_at IS 'Auto-hide after this time (NULL = never expires)';
COMMENT ON COLUMN announcements.is_archived IS 'Soft delete - hides from all views but preserves history';
COMMENT ON TABLE announcement_dismissals IS 'Tracks which users have dismissed which announcements';
