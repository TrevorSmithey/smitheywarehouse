-- ============================================================================
-- TEST DATA CLEANUP FOR RESTORATIONS
-- ============================================================================
-- This script removes old test data, keeping only items that:
-- 1. Were delivered to warehouse within the last 7 days
-- 2. OR are currently in active terminal statuses (delivered, cancelled, damaged)
--    from the last 7 days
--
-- Run this in the Supabase SQL Editor (one-time operation)
-- ============================================================================

-- ============================================================================
-- STEP 1: PREVIEW - See what will be KEPT (run this first!)
-- ============================================================================
SELECT
  id,
  status,
  order_name,
  delivered_to_warehouse_at,
  created_at,
  CASE
    WHEN delivered_to_warehouse_at >= NOW() - INTERVAL '7 days' THEN 'KEEP (recent delivery)'
    WHEN status = 'delivered' AND delivered_at >= NOW() - INTERVAL '7 days' THEN 'KEEP (recently completed)'
    ELSE 'DELETE'
  END as action
FROM restorations
ORDER BY
  CASE
    WHEN delivered_to_warehouse_at >= NOW() - INTERVAL '7 days' THEN 0
    WHEN status = 'delivered' AND delivered_at >= NOW() - INTERVAL '7 days' THEN 1
    ELSE 2
  END,
  created_at DESC;

-- ============================================================================
-- STEP 2: COUNT what will be deleted vs kept
-- ============================================================================
SELECT
  'TO DELETE' as action,
  COUNT(*) as count
FROM restorations
WHERE
  -- Not delivered to warehouse in the last 7 days
  (delivered_to_warehouse_at IS NULL OR delivered_to_warehouse_at < NOW() - INTERVAL '7 days')
  -- AND not recently completed (delivered in the last 7 days)
  AND NOT (status = 'delivered' AND delivered_at >= NOW() - INTERVAL '7 days')

UNION ALL

SELECT
  'TO KEEP' as action,
  COUNT(*) as count
FROM restorations
WHERE
  -- Delivered to warehouse in the last 7 days
  delivered_to_warehouse_at >= NOW() - INTERVAL '7 days'
  -- OR recently completed
  OR (status = 'delivered' AND delivered_at >= NOW() - INTERVAL '7 days');

-- ============================================================================
-- STEP 3: DELETE RELATED EVENTS FIRST (foreign key constraint)
-- ============================================================================
-- IMPORTANT: Run this BEFORE deleting restorations!
--
-- DELETE FROM restoration_events
-- WHERE restoration_id IN (
--   SELECT id FROM restorations
--   WHERE
--     (delivered_to_warehouse_at IS NULL OR delivered_to_warehouse_at < NOW() - INTERVAL '7 days')
--     AND NOT (status = 'delivered' AND delivered_at >= NOW() - INTERVAL '7 days')
-- );

-- ============================================================================
-- STEP 4: DELETE OLD RESTORATIONS
-- ============================================================================
-- CAUTION: This is DESTRUCTIVE and cannot be undone!
-- Uncomment and run only after verifying Step 1 and 2
--
-- DELETE FROM restorations
-- WHERE
--   (delivered_to_warehouse_at IS NULL OR delivered_to_warehouse_at < NOW() - INTERVAL '7 days')
--   AND NOT (status = 'delivered' AND delivered_at >= NOW() - INTERVAL '7 days');

-- ============================================================================
-- STEP 5: VERIFY CLEANUP
-- ============================================================================
SELECT
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM restorations
GROUP BY status
ORDER BY
  CASE status
    WHEN 'pending_label' THEN 1
    WHEN 'label_sent' THEN 2
    WHEN 'in_transit_inbound' THEN 3
    WHEN 'delivered_warehouse' THEN 4
    WHEN 'received' THEN 5
    WHEN 'at_restoration' THEN 6
    WHEN 'ready_to_ship' THEN 7
    WHEN 'shipped' THEN 8
    WHEN 'delivered' THEN 9
    WHEN 'cancelled' THEN 10
    WHEN 'damaged' THEN 11
    ELSE 12
  END;
