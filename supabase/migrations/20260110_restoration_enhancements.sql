-- ============================================================================
-- RESTORATION ENHANCEMENTS
-- ============================================================================
-- Adds support for:
-- - Multiple tag numbers per restoration (array)
-- - Damaged terminal status with reason
-- - Photos column (if not exists)
-- ============================================================================

-- Add tag_numbers array column (replaces magnet_number as primary identifier)
ALTER TABLE restorations
ADD COLUMN IF NOT EXISTS tag_numbers TEXT[] DEFAULT '{}';

-- Add damaged status support
ALTER TABLE restorations
ADD COLUMN IF NOT EXISTS damaged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS damage_reason TEXT;

-- Add photos column if not exists (may have been added separately)
ALTER TABLE restorations
ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT '{}';

-- Migrate existing magnet_number values to tag_numbers array
UPDATE restorations
SET tag_numbers = ARRAY[magnet_number]
WHERE magnet_number IS NOT NULL
  AND magnet_number != ''
  AND (tag_numbers IS NULL OR tag_numbers = '{}');

-- Create GIN index for efficient tag lookups
CREATE INDEX IF NOT EXISTS idx_restorations_tag_numbers
ON restorations USING GIN(tag_numbers);

-- Update the active status index to exclude damaged items
DROP INDEX IF EXISTS idx_restorations_active_status;
CREATE INDEX idx_restorations_active_status ON restorations(status, created_at)
  WHERE status NOT IN ('delivered', 'cancelled', 'damaged');

-- ============================================================================
-- UPDATE RPC FUNCTIONS
-- ============================================================================

-- Update get_restoration_pipeline_counts to handle damaged status
CREATE OR REPLACE FUNCTION get_restoration_pipeline_counts()
RETURNS TABLE (
  status TEXT,
  count BIGINT,
  oldest_days INTEGER,
  avg_days_in_status NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.status,
    COUNT(*)::BIGINT as count,
    EXTRACT(DAY FROM (NOW() - MIN(
      CASE r.status
        WHEN 'pending_label' THEN r.created_at
        WHEN 'label_sent' THEN r.label_sent_at
        WHEN 'in_transit_inbound' THEN r.customer_shipped_at
        WHEN 'delivered_warehouse' THEN r.delivered_to_warehouse_at
        WHEN 'received' THEN r.received_at
        WHEN 'at_restoration' THEN r.sent_to_restoration_at
        WHEN 'ready_to_ship' THEN r.back_from_restoration_at
        ELSE r.created_at
      END
    )))::INTEGER as oldest_days,
    ROUND(AVG(EXTRACT(DAY FROM (NOW() -
      CASE r.status
        WHEN 'pending_label' THEN r.created_at
        WHEN 'label_sent' THEN r.label_sent_at
        WHEN 'in_transit_inbound' THEN r.customer_shipped_at
        WHEN 'delivered_warehouse' THEN r.delivered_to_warehouse_at
        WHEN 'received' THEN r.received_at
        WHEN 'at_restoration' THEN r.sent_to_restoration_at
        WHEN 'ready_to_ship' THEN r.back_from_restoration_at
        ELSE r.created_at
      END
    )))::NUMERIC, 1) as avg_days_in_status
  FROM restorations r
  WHERE r.status NOT IN ('delivered', 'cancelled', 'damaged')  -- Exclude damaged
  GROUP BY r.status
  ORDER BY
    CASE r.status
      WHEN 'pending_label' THEN 1
      WHEN 'label_sent' THEN 2
      WHEN 'in_transit_inbound' THEN 3
      WHEN 'delivered_warehouse' THEN 4
      WHEN 'received' THEN 5
      WHEN 'at_restoration' THEN 6
      WHEN 'ready_to_ship' THEN 7
      WHEN 'shipped' THEN 8
      ELSE 9
    END;
END;
$$ LANGUAGE plpgsql;

-- Update comments
COMMENT ON COLUMN restorations.tag_numbers IS 'Array of physical tag numbers assigned at warehouse check-in (replaces magnet_number as primary identifier)';
COMMENT ON COLUMN restorations.damaged_at IS 'Timestamp when item was marked as damaged (terminal status)';
COMMENT ON COLUMN restorations.damage_reason IS 'Reason for damage: broken_beyond_repair, defective_material, lost, other';
COMMENT ON COLUMN restorations.photos IS 'Array of Supabase Storage URLs for photos (max 3)';
