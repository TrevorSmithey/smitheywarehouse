/**
 * Phase 1 Database Migration: Performance Optimization
 *
 * Creates indexes and RPC functions for budget/inventory APIs
 * No schema changes - low risk, easy rollback
 *
 * Usage: npx tsx scripts/phase1-migration.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function runSQL(sql: string, description: string): Promise<boolean> {
  console.log(`\n>>> ${description}...`);
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql }).single();

  if (error) {
    // Try direct query if exec_sql doesn't exist
    const { error: directError } = await supabase.from('_migrations').select('*').limit(0);
    if (directError?.message.includes('does not exist')) {
      console.log(`   Note: Using Supabase SQL Editor for this migration`);
      return false;
    }
    console.error(`   ERROR: ${error.message}`);
    return false;
  }

  console.log(`   SUCCESS`);
  return true;
}

async function checkIndexExists(indexName: string): Promise<boolean> {
  const { data, error } = await supabase
    .rpc('check_index_exists', { index_name: indexName });

  // If RPC doesn't exist, we'll just try to create
  if (error) return false;
  return data === true;
}

async function main() {
  console.log("===========================================");
  console.log("PHASE 1: Performance Optimization Migration");
  console.log("===========================================");
  console.log("\nThis migration creates:");
  console.log("  - 6 performance indexes");
  console.log("  - 1 RPC function (get_budget_actuals)");
  console.log("\nRollback: DROP FUNCTION/INDEX commands at end\n");

  // Generate SQL for manual execution if needed
  const indexSQL = `
-- =============================================
-- PHASE 1: PERFORMANCE INDEXES
-- Run in Supabase SQL Editor
-- =============================================

-- Index 1: line_items by order_id (speeds up joins)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_line_items_order_id
  ON line_items(order_id);

-- Index 2: line_items by lowercase SKU (speeds up aggregations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_line_items_sku_lower
  ON line_items(lower(sku)) WHERE sku IS NOT NULL;

-- Index 3: orders by created_at for non-canceled (date range queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at_active
  ON orders(created_at) WHERE canceled = false;

-- Index 4: orders by fulfilled_at (fulfillment analytics)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_fulfilled_at
  ON orders(fulfilled_at) WHERE fulfilled_at IS NOT NULL AND canceled = false;

-- Index 5: orders by warehouse + status (queue counts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_warehouse_status
  ON orders(warehouse, fulfillment_status) WHERE canceled = false;

-- Index 6: b2b_fulfilled by date (B2B aggregations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b2b_fulfilled_date
  ON b2b_fulfilled(fulfilled_at);
`;

  const functionSQL = `
-- =============================================
-- PHASE 1: BUDGET ACTUALS RPC FUNCTION
-- Aggregates sales at database level instead of JS
-- =============================================

CREATE OR REPLACE FUNCTION get_budget_actuals(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE(
  sku TEXT,
  display_name TEXT,
  category TEXT,
  retail_qty BIGINT,
  b2b_qty BIGINT,
  total_qty BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH retail_sales AS (
    SELECT
      lower(li.sku) AS sku_lower,
      SUM(li.quantity) AS qty
    FROM line_items li
    JOIN orders o ON li.order_id = o.id
    WHERE o.created_at >= p_start_date
      AND o.created_at < p_end_date
      AND o.canceled = false
      AND li.sku IS NOT NULL
    GROUP BY lower(li.sku)
  ),
  b2b_sales AS (
    SELECT
      lower(b.sku) AS sku_lower,
      SUM(b.quantity) AS qty
    FROM b2b_fulfilled b
    WHERE b.fulfilled_at >= p_start_date
      AND b.fulfilled_at < p_end_date
      AND b.sku IS NOT NULL
    GROUP BY lower(b.sku)
  )
  SELECT
    p.sku,
    p.display_name,
    p.category,
    COALESCE(r.qty, 0)::BIGINT AS retail_qty,
    COALESCE(b.qty, 0)::BIGINT AS b2b_qty,
    (COALESCE(r.qty, 0) + COALESCE(b.qty, 0))::BIGINT AS total_qty
  FROM products p
  LEFT JOIN retail_sales r ON lower(p.sku) = r.sku_lower
  LEFT JOIN b2b_sales b ON lower(p.sku) = b.sku_lower
  WHERE p.is_active = true
  ORDER BY p.sku;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_budget_actuals(TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;
`;

  const rollbackSQL = `
-- =============================================
-- ROLLBACK: Run if issues occur
-- =============================================

-- Drop function
DROP FUNCTION IF EXISTS get_budget_actuals(TIMESTAMPTZ, TIMESTAMPTZ);

-- Drop indexes
DROP INDEX CONCURRENTLY IF EXISTS idx_line_items_order_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_line_items_sku_lower;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_created_at_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_fulfilled_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_warehouse_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_b2b_fulfilled_date;
`;

  // Write SQL files for manual execution
  const fs = await import('fs');
  const path = await import('path');

  const sqlDir = path.join(process.cwd(), 'sql');
  if (!fs.existsSync(sqlDir)) {
    fs.mkdirSync(sqlDir);
  }

  fs.writeFileSync(path.join(sqlDir, 'phase1-indexes.sql'), indexSQL);
  fs.writeFileSync(path.join(sqlDir, 'phase1-function.sql'), functionSQL);
  fs.writeFileSync(path.join(sqlDir, 'phase1-rollback.sql'), rollbackSQL);

  console.log("SQL files created in /sql directory:");
  console.log("  - sql/phase1-indexes.sql");
  console.log("  - sql/phase1-function.sql");
  console.log("  - sql/phase1-rollback.sql");

  console.log("\n" + "=".repeat(50));
  console.log("NEXT STEPS:");
  console.log("=".repeat(50));
  console.log("\n1. Open Supabase Dashboard > SQL Editor");
  console.log("2. Run sql/phase1-indexes.sql (indexes)");
  console.log("3. Run sql/phase1-function.sql (RPC function)");
  console.log("4. Test: supabase.rpc('get_budget_actuals', {...})");
  console.log("\nOr run combined SQL below:\n");

  console.log("=".repeat(50));
  console.log("COMBINED SQL (copy to Supabase SQL Editor):");
  console.log("=".repeat(50));
  console.log(indexSQL);
  console.log(functionSQL);
}

main().catch(console.error);
