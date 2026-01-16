-- Add index on order_id for faster delete operations when orders are cancelled
CREATE INDEX IF NOT EXISTS idx_b2b_fulfilled_order_id ON b2b_fulfilled(order_id);
