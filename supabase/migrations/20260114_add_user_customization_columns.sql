-- ============================================================================
-- USER CUSTOMIZATION COLUMNS FOR DASHBOARD_USERS
-- ============================================================================
-- Adds:
-- - default_page_override: User-specific landing page override
-- - additional_tabs: Extra tab access beyond role permissions
-- ============================================================================

-- Add default_page_override column
-- Allows per-user override of the role's default landing page
-- NULL means use role default, set value means redirect to that tab on login
ALTER TABLE dashboard_users
ADD COLUMN IF NOT EXISTS default_page_override TEXT;

-- Add additional_tabs column
-- Allows per-user access to tabs beyond their role's permissions
-- JSONB array of DashboardTab strings (e.g. ["production", "pl"])
ALTER TABLE dashboard_users
ADD COLUMN IF NOT EXISTS additional_tabs JSONB DEFAULT '[]'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN dashboard_users.default_page_override IS
  'User-specific landing page override. If set, user is redirected to this tab on login instead of their role default. Valid values: inventory, production, fulfillment, production-planning, restoration, budget, revenue-tracker, holiday, pl, voc, marketing, sales, ecommerce.';

COMMENT ON COLUMN dashboard_users.additional_tabs IS
  'JSON array of additional tabs this user can access beyond their role permissions. Example: ["production", "pl"]. Empty array means no additional access.';

-- Add index for potential future filtering by additional_tabs
CREATE INDEX IF NOT EXISTS idx_dashboard_users_additional_tabs
ON dashboard_users USING gin (additional_tabs)
WHERE additional_tabs IS NOT NULL AND additional_tabs != '[]'::jsonb;
