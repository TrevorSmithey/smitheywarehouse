-- Add user_tab_order column to dashboard_users for per-user tab ordering
-- This allows users to customize their own tab order in the navigation
-- Falls back to role_tab_order → global tab_order when null

-- Add the column (JSONB array of tab IDs)
ALTER TABLE dashboard_users
ADD COLUMN IF NOT EXISTS user_tab_order JSONB;

-- Add a comment for documentation
COMMENT ON COLUMN dashboard_users.user_tab_order IS 'User-specific tab order as JSON array of DashboardTab IDs. When null, falls back to role-specific or global order.';

-- Create an index for efficient lookups when fetching user preferences
-- Using gin index for JSONB to support potential future queries on tab contents
CREATE INDEX IF NOT EXISTS idx_dashboard_users_tab_order
ON dashboard_users USING gin (user_tab_order);
