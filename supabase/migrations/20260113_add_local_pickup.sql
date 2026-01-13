-- ============================================================================
-- LOCAL PICKUP & MANUAL RESTORATION SUPPORT
-- ============================================================================
-- Adds:
-- - local_pickup boolean: Indicates customer will pick up (vs ship back)
-- - source text: Tracks how restoration was created
-- ============================================================================

-- Add local_pickup column
-- POS orders default TRUE (local customers), D2C orders default FALSE (ship back)
ALTER TABLE restorations
ADD COLUMN IF NOT EXISTS local_pickup BOOLEAN DEFAULT NULL;

-- Add source column to track creation method
-- Values: 'aftership', 'shopify_webhook', 'manual', 'sync'
ALTER TABLE restorations
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'aftership';

-- Backfill: Set local_pickup = TRUE for existing POS orders
UPDATE restorations
SET local_pickup = TRUE
WHERE is_pos = TRUE
  AND local_pickup IS NULL;

-- Backfill: Set local_pickup = FALSE for existing non-POS orders
UPDATE restorations
SET local_pickup = FALSE
WHERE is_pos = FALSE
  AND local_pickup IS NULL;

-- Add comments
COMMENT ON COLUMN restorations.local_pickup IS 'If TRUE, customer picks up restored item at warehouse (no return shipping). POS orders default TRUE, D2C orders default FALSE.';
COMMENT ON COLUMN restorations.source IS 'How restoration was created: aftership, shopify_webhook, manual, sync';

-- Index for filtering by local_pickup (useful for pickup queue views)
CREATE INDEX IF NOT EXISTS idx_restorations_local_pickup
ON restorations(local_pickup)
WHERE local_pickup = TRUE AND archived_at IS NULL;
