-- Add "customer_service" to the allowed roles in dashboard_users table
-- This role is for CS team with access to Inventory, Restoration, and Customer Service (VOC)

-- Drop the existing constraint
ALTER TABLE dashboard_users DROP CONSTRAINT dashboard_users_role_check;

-- Add the new constraint with customer_service included
ALTER TABLE dashboard_users ADD CONSTRAINT dashboard_users_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'exec'::text, 'ops1'::text, 'ops2'::text, 'standard'::text, 'sales'::text, 'fulfillment'::text, 'customer_service'::text]));
