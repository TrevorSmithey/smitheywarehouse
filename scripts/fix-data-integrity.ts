/**
 * Fix Data Integrity Issues
 *
 * Issues Found:
 * 1. Nov 2, 2025 is DOUBLE-COUNTED in annual_sales_tracking
 *    - day_of_year=305 AND day_of_year=306 both have 2025-11-02
 *    - This is caused by a DST bug in getDayOfYear()
 *    - Fix: Delete the duplicate entry (day_of_year=306)
 *
 * 2. Apr 10, 2025 is MISSING from annual_sales_tracking
 *    - daily_stats has 122 orders, $34,397.34
 *    - annual_sales_tracking has no entry
 *    - Fix: Insert the missing day
 *
 * Run with: npx tsx scripts/fix-data-integrity.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase env vars");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Set this to true to actually make changes
const DRY_RUN = false;

async function fixDataIntegrity() {
  console.log("\n" + "=".repeat(70));
  console.log(DRY_RUN ? "DATA INTEGRITY FIX (DRY RUN)" : "DATA INTEGRITY FIX (LIVE)");
  console.log("=".repeat(70) + "\n");

  const TARGET_ORDERS = 96533;
  const TARGET_REVENUE = 30637801.19;

  // =========================================================================
  // BEFORE: Check current state
  // =========================================================================
  console.log("📊 BEFORE FIX:");
  console.log("-".repeat(50));

  const { data: beforeAst } = await supabase
    .from("annual_sales_tracking")
    .select("orders, revenue")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  const beforeOrders = beforeAst?.reduce((sum, d) => sum + (d.orders || 0), 0) || 0;
  const beforeRevenue = beforeAst?.reduce((sum, d) => sum + (parseFloat(d.revenue) || 0), 0) || 0;

  console.log(`   AST Orders: ${beforeOrders.toLocaleString()} (target: ${TARGET_ORDERS.toLocaleString()})`);
  console.log(`   AST Revenue: $${beforeRevenue.toLocaleString()} (target: $${TARGET_REVENUE.toLocaleString()})`);
  console.log(`   Diff: ${beforeOrders - TARGET_ORDERS >= 0 ? '+' : ''}${beforeOrders - TARGET_ORDERS} orders`);

  // =========================================================================
  // FIX 1: Delete Nov 2 duplicate (day_of_year=306 is wrong, 305 is correct)
  // =========================================================================
  console.log("\n📊 FIX 1: Delete Nov 2 duplicate (day_of_year=306)");
  console.log("-".repeat(50));

  // Verify the duplicate exists
  const { data: nov2Entries } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("date", "2025-11-02")
    .eq("channel", "d2c");

  console.log(`   Found ${nov2Entries?.length || 0} entries for 2025-11-02`);

  const duplicateEntry = nov2Entries?.find(e => e.day_of_year === 306);
  const correctEntry = nov2Entries?.find(e => e.day_of_year === 305);

  if (duplicateEntry && correctEntry) {
    console.log(`   Duplicate entry (to delete): day_of_year=${duplicateEntry.day_of_year}, ${duplicateEntry.orders} orders`);
    console.log(`   Correct entry (to keep): day_of_year=${correctEntry.day_of_year}, ${correctEntry.orders} orders`);

    if (!DRY_RUN) {
      const { error } = await supabase
        .from("annual_sales_tracking")
        .delete()
        .eq("year", 2025)
        .eq("day_of_year", 306)
        .eq("channel", "d2c");

      if (error) {
        console.log(`   ❌ Delete failed: ${error.message}`);
      } else {
        console.log(`   ✅ Deleted duplicate entry`);
      }
    } else {
      console.log(`   [DRY RUN] Would delete day_of_year=306 entry`);
    }
  } else {
    console.log(`   ⚠️  Expected duplicate not found or already fixed`);
  }

  // =========================================================================
  // FIX 2: Backfill Apr 10 from daily_stats
  // =========================================================================
  console.log("\n📊 FIX 2: Backfill Apr 10, 2025");
  console.log("-".repeat(50));

  // Check if Apr 10 exists in AST
  const { data: apr10Ast } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("date", "2025-04-10")
    .eq("channel", "d2c");

  // Get Apr 10 from daily_stats
  const { data: apr10Ds } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-04-10");

  if (!apr10Ast || apr10Ast.length === 0) {
    console.log(`   AST missing Apr 10`);
    if (apr10Ds && apr10Ds.length > 0) {
      const dsData = apr10Ds[0];
      console.log(`   DS has: ${dsData.total_orders} orders, $${dsData.total_revenue}`);

      // Calculate day_of_year for Apr 10
      // Apr 10 = day 100 in non-leap year, day 101 in leap year
      // 2025 is not a leap year, so Apr 10 = Jan(31) + Feb(28) + Mar(31) + Apr(10) = 100
      const dayOfYear = 100;
      const quarter = 2; // April is Q2

      if (!DRY_RUN) {
        const { error } = await supabase
          .from("annual_sales_tracking")
          .insert({
            year: 2025,
            day_of_year: dayOfYear,
            date: "2025-04-10",
            quarter: quarter,
            orders: dsData.total_orders,
            revenue: dsData.total_revenue,
            channel: "d2c",
            synced_at: new Date().toISOString(),
          });

        if (error) {
          console.log(`   ❌ Insert failed: ${error.message}`);
        } else {
          console.log(`   ✅ Inserted Apr 10 data`);
        }
      } else {
        console.log(`   [DRY RUN] Would insert: day_of_year=${dayOfYear}, orders=${dsData.total_orders}, revenue=$${dsData.total_revenue}`);
      }
    } else {
      console.log(`   ⚠️  No DS data for Apr 10 to backfill`);
    }
  } else {
    console.log(`   Apr 10 already exists in AST`);
  }

  // =========================================================================
  // AFTER: Check new state
  // =========================================================================
  if (!DRY_RUN) {
    console.log("\n📊 AFTER FIX:");
    console.log("-".repeat(50));

    const { data: afterAst } = await supabase
      .from("annual_sales_tracking")
      .select("orders, revenue")
      .eq("year", 2025)
      .eq("channel", "d2c")
      .gte("date", "2025-01-01")
      .lte("date", "2025-12-28");

    const afterOrders = afterAst?.reduce((sum, d) => sum + (d.orders || 0), 0) || 0;
    const afterRevenue = afterAst?.reduce((sum, d) => sum + (parseFloat(d.revenue) || 0), 0) || 0;

    console.log(`   AST Orders: ${afterOrders.toLocaleString()} (target: ${TARGET_ORDERS.toLocaleString()})`);
    console.log(`   AST Revenue: $${afterRevenue.toLocaleString()} (target: $${TARGET_REVENUE.toLocaleString()})`);
    console.log(`   Diff: ${afterOrders - TARGET_ORDERS >= 0 ? '+' : ''}${afterOrders - TARGET_ORDERS} orders`);

    // Change from before
    console.log(`\n   Orders change: ${afterOrders - beforeOrders >= 0 ? '+' : ''}${afterOrders - beforeOrders}`);
    console.log(`   Revenue change: ${afterRevenue - beforeRevenue >= 0 ? '+' : ''}$${(afterRevenue - beforeRevenue).toFixed(2)}`);
  } else {
    // Estimate after
    console.log("\n📊 ESTIMATED AFTER FIX:");
    console.log("-".repeat(50));

    const estimatedOrders = beforeOrders - (duplicateEntry?.orders || 0) + (apr10Ds?.[0]?.total_orders || 0);
    const estimatedRevenue = beforeRevenue - (parseFloat(duplicateEntry?.revenue) || 0) + (parseFloat(apr10Ds?.[0]?.total_revenue) || 0);

    console.log(`   Estimated AST Orders: ${estimatedOrders.toLocaleString()} (target: ${TARGET_ORDERS.toLocaleString()})`);
    console.log(`   Estimated AST Revenue: $${estimatedRevenue.toLocaleString()} (target: $${TARGET_REVENUE.toLocaleString()})`);
    console.log(`   Estimated Diff: ${estimatedOrders - TARGET_ORDERS >= 0 ? '+' : ''}${estimatedOrders - TARGET_ORDERS} orders`);
    console.log(`\n   Set DRY_RUN = false to apply fixes`);
  }

  console.log("\n" + "=".repeat(70));
}

fixDataIntegrity().catch(console.error);
