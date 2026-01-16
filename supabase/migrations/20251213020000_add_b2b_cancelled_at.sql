-- Add cancelled_at column to b2b_fulfilled table for soft-delete functionality
-- This preserves audit history instead of permanently deleting cancelled orders

ALTER TABLE b2b_fulfilled
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for filtering out cancelled orders
CREATE INDEX IF NOT EXISTS idx_b2b_fulfilled_cancelled_at
ON b2b_fulfilled (cancelled_at)
WHERE cancelled_at IS NULL;

-- Comment for documentation
COMMENT ON COLUMN b2b_fulfilled.cancelled_at IS 'Timestamp when order was cancelled. NULL means active order.';
