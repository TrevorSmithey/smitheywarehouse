-- Add sync_batch_id column for atomic sync approach
-- This enables insert-then-delete pattern to avoid race conditions

ALTER TABLE b2b_draft_orders
ADD COLUMN IF NOT EXISTS sync_batch_id TEXT;

-- Index for efficient cleanup of old batches
CREATE INDEX IF NOT EXISTS idx_b2b_draft_orders_sync_batch
ON b2b_draft_orders(sync_batch_id);

COMMENT ON COLUMN b2b_draft_orders.sync_batch_id IS
  'Batch identifier (ISO timestamp) for atomic sync. New data inserted with batch ID, then old data deleted.';
