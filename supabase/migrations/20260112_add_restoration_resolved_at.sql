-- Add resolved_at column for tracking CS resolution of damaged items
-- When a restoration is marked as "damaged", CS team needs to:
-- 1. See it in their action queue (resolved_at IS NULL)
-- 2. Mark it as resolved after contacting customer (sets resolved_at)
-- This doesn't change the status - it just tracks CS follow-up

ALTER TABLE restorations ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Partial index for efficient querying of unresolved damaged items
-- This makes "show me damaged items needing CS attention" fast
CREATE INDEX IF NOT EXISTS idx_restorations_damaged_unresolved
ON restorations (damaged_at)
WHERE status = 'damaged' AND resolved_at IS NULL;

COMMENT ON COLUMN restorations.resolved_at IS 'Timestamp when CS marked damaged item as resolved (customer contacted, situation handled). NULL means needs CS attention.';
