-- Fix expected_syncs schedule for backfill-warehouse
-- The schedule was set to hourly ('15 * * * *') but actual vercel.json uses every 15 min ('*/15 * * * *')
--
-- Also updates stale_threshold_hours from 2 to 1 (should be ~2x the schedule interval)

UPDATE expected_syncs
SET
  schedule = '*/15 * * * *',
  stale_threshold_hours = 1,
  description = 'Backfill warehouse tags every 15 min',
  updated_at = NOW()
WHERE sync_type = 'backfill-warehouse';

-- Note: sync-aftership-returns is NOT added to expected_syncs because:
-- 1. It was removed from vercel.json crons (was pushing us over 20 job limit)
-- 2. The route explicitly documents it's NOT meant to be scheduled
-- 3. Real-time updates are handled by the Aftership webhook at /api/webhooks/aftership
-- 4. The route still exists for manual backfill/reconciliation via POST request
