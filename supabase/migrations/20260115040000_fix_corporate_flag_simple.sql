-- Migration: Fix is_corporate to only use manual flag
-- Date: 2026-01-15
--
-- Problem:
--   - is_corporate GENERATED expression uses UNION logic:
--     is_corporate_gifting = true OR category = 'Corporate' OR category = '4'
--   - This means NetSuite category overrides manual DB flag
--   - Snake River Farms has category='4' but is_corporate_gifting=false
--   - Result: SRF incorrectly marked as corporate despite manual flag saying B2B
--
-- Solution:
--   - Change GENERATED expression to ONLY use is_corporate_gifting
--   - is_corporate = COALESCE(is_corporate_gifting, false)
--   - NetSuite category is ignored (DB is cleaner, NS will be fixed over time)
--
-- Impact:
--   - Only 1 customer affected: Snake River Farms
--   - Changes from corporate (wrong) to B2B (correct)
--   - +$252,566 to B2B revenue metrics
--
-- Customer detail modal corporate toggle will now work correctly.

-- Step 1: Drop the current GENERATED column
ALTER TABLE ns_wholesale_customers DROP COLUMN IF EXISTS is_corporate;

-- Step 2: Recreate with simple expression (only manual flag, no NetSuite)
ALTER TABLE ns_wholesale_customers
ADD COLUMN is_corporate BOOLEAN GENERATED ALWAYS AS (COALESCE(is_corporate_gifting, false)) STORED;

-- Step 3: Create index for filtering
DROP INDEX IF EXISTS idx_ns_wholesale_customers_is_corporate;
CREATE INDEX idx_ns_wholesale_customers_is_corporate
ON ns_wholesale_customers(is_corporate) WHERE is_corporate = true;

DROP INDEX IF EXISTS idx_ns_wholesale_customers_b2b_revenue;
CREATE INDEX idx_ns_wholesale_customers_b2b_revenue
ON ns_wholesale_customers(lifetime_revenue DESC NULLS LAST)
WHERE is_corporate = false;

-- Step 4: Add documentation comment
COMMENT ON COLUMN ns_wholesale_customers.is_corporate IS
  'Corporate gifting flag. SINGLE SOURCE OF TRUTH for corporate detection.
   true = Corporate gifting customer (excluded from B2B metrics)
   false = B2B wholesale customer (included in Door Health, sales dashboards)

   GENERATED from: COALESCE(is_corporate_gifting, false)

   Philosophy: DB is cleaner than NetSuite. NetSuite category is NOT used.
   To change corporate status: Update is_corporate_gifting via customer modal.

   Fixed 2026-01-15: Removed NetSuite category from expression.
   Snake River Farms was incorrectly marked corporate due to category=4.';

COMMENT ON COLUMN ns_wholesale_customers.is_corporate_gifting IS
  'Manual corporate flag. Set via customer detail modal.
   This is the source column - is_corporate is GENERATED from this.
   Update this column to change a customer corporate status.';

-- Verification query (run after migration):
-- SELECT ns_customer_id, company_name, is_corporate, is_corporate_gifting, category
-- FROM ns_wholesale_customers
-- WHERE ns_customer_id = 2504;
-- Expected: is_corporate = false (Snake River Farms is B2B)
--
-- SELECT is_corporate, COUNT(*) FROM ns_wholesale_customers
-- WHERE lifetime_orders > 0 GROUP BY is_corporate;
-- Expected: true ~195, false ~558
