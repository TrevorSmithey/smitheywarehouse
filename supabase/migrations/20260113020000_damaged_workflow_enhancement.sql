-- ============================================================================
-- DAMAGED WORKFLOW ENHANCEMENT
-- ============================================================================
-- Transforms 'damaged' from terminal status to decision point with two paths:
-- Path 1: Continue Restoration (was_damaged=true, back to delivered_warehouse)
-- Path 2: Trash It (pending_trash → trashed after physical disposal confirmation)
-- ============================================================================

-- 1. Add was_damaged flag (persists through continued restoration for analytics)
ALTER TABLE restorations ADD COLUMN IF NOT EXISTS was_damaged BOOLEAN DEFAULT FALSE;

-- 2. Add trash workflow columns
ALTER TABLE restorations ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE restorations ADD COLUMN IF NOT EXISTS trash_confirmed_at TIMESTAMPTZ;

-- 3. Index for trash bin queries (items pending physical disposal confirmation)
CREATE INDEX IF NOT EXISTS idx_restorations_pending_trash
ON restorations (trashed_at)
WHERE status = 'pending_trash' AND trash_confirmed_at IS NULL;

-- 4. Index for analytics: items that were damaged but completed restoration
CREATE INDEX IF NOT EXISTS idx_restorations_was_damaged
ON restorations (was_damaged)
WHERE was_damaged = true AND status IN ('shipped', 'delivered');

-- 5. Comments for new columns
COMMENT ON COLUMN restorations.was_damaged IS 'Flag indicating item was previously marked damaged but continued through restoration. Persists even after completion for analytics.';
COMMENT ON COLUMN restorations.trashed_at IS 'Timestamp when item was marked for trash disposal (customer said toss it)';
COMMENT ON COLUMN restorations.trash_confirmed_at IS 'Timestamp when warehouse operator confirmed physical disposal of item';
