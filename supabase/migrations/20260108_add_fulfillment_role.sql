-- Add "fulfillment" to the allowed roles in dashboard_users table
-- This role is for warehouse team with access to Restoration (home) + Inventory only

-- Drop the existing constraint
ALTER TABLE dashboard_users DROP CONSTRAINT dashboard_users_role_check;

-- Add the new constraint with fulfillment included
ALTER TABLE dashboard_users ADD CONSTRAINT dashboard_users_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'exec'::text, 'ops1'::text, 'ops2'::text, 'standard'::text, 'sales'::text, 'fulfillment'::text]));
