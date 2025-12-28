/**
 * Rebuild annual_sales_tracking from daily_stats with correct day_of_year
 *
 * The issue: getDayOfYear() was computing incorrect values due to DST.
 * This script uses a timezone-safe calculation.
 *
 * Run with: npx tsx scripts/rebuild-ast.ts
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

// Correct day of year calculation (timezone-safe)
function getDayOfYearSafe(dateStr: string): number {
  // Parse as UTC to avoid DST issues
  const [year, month, day] = dateStr.split('-').map(Number);

  // Days in each month (non-leap year)
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Check for leap year
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  if (isLeap) daysInMonth[2] = 29;

  // Sum days from previous months
  let dayOfYear = day;
  for (let m = 1; m < month; m++) {
    dayOfYear += daysInMonth[m];
  }

  return dayOfYear;
}

function getQuarter(dateStr: string): number {
  const month = parseInt(dateStr.split('-')[1], 10);
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

// Set this to true to do a dry run
const DRY_RUN = false;

async function rebuildAst() {
  console.log("\n" + "=".repeat(70));
  console.log(DRY_RUN ? "REBUILD AST (DRY RUN)" : "REBUILD AST (LIVE)");
  console.log("=".repeat(70) + "\n");

  const TARGET_ORDERS = 96533;
  const TARGET_REVENUE = 30637801.19;

  // Get all daily_stats for 2025
  const { data: dailyStats } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-31")
    .order("date");

  console.log(`📊 Found ${dailyStats?.length || 0} days in daily_stats for 2025`);

  // Verify day_of_year calculation
  console.log("\n📊 Sample day_of_year calculations:");
  const samples = ["2025-01-01", "2025-04-10", "2025-04-11", "2025-11-02", "2025-12-28"];
  for (const date of samples) {
    console.log(`   ${date} → day ${getDayOfYearSafe(date)}`);
  }

  // Calculate totals from daily_stats
  const dsOrders = dailyStats?.reduce((sum, d) => sum + (d.total_orders || 0), 0) || 0;
  const dsRevenue = dailyStats?.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0) || 0;

  console.log(`\n📊 daily_stats totals (Jan 1 - Dec 28, if complete):`);
  const jan1ToDec28 = dailyStats?.filter(d => d.date >= "2025-01-01" && d.date <= "2025-12-28") || [];
  const filteredOrders = jan1ToDec28.reduce((sum, d) => sum + (d.total_orders || 0), 0);
  const filteredRevenue = jan1ToDec28.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);
  console.log(`   Days: ${jan1ToDec28.length}`);
  console.log(`   Orders: ${filteredOrders.toLocaleString()}`);
  console.log(`   Revenue: $${filteredRevenue.toLocaleString()}`);
  console.log(`   vs Target: ${filteredOrders - TARGET_ORDERS >= 0 ? '+' : ''}${filteredOrders - TARGET_ORDERS} orders`);

  if (!DRY_RUN && dailyStats && dailyStats.length > 0) {
    console.log("\n📊 Rebuilding annual_sales_tracking for 2025 d2c...");

    // Delete existing 2025 d2c entries
    const { error: deleteError } = await supabase
      .from("annual_sales_tracking")
      .delete()
      .eq("year", 2025)
      .eq("channel", "d2c");

    if (deleteError) {
      console.log(`   ❌ Delete failed: ${deleteError.message}`);
      return;
    }
    console.log("   ✅ Deleted existing 2025 d2c entries");

    // Insert new entries with correct day_of_year
    let insertCount = 0;
    let insertErrors = 0;

    for (const day of dailyStats) {
      if (!day.date.startsWith("2025")) continue;

      const year = 2025;
      const dayOfYear = getDayOfYearSafe(day.date);
      const quarter = getQuarter(day.date);

      const { error } = await supabase
        .from("annual_sales_tracking")
        .insert({
          year,
          day_of_year: dayOfYear,
          date: day.date,
          quarter,
          orders: day.total_orders,
          revenue: day.total_revenue,
          channel: "d2c",
          synced_at: new Date().toISOString(),
        });

      if (error) {
        console.log(`   ❌ Insert ${day.date} failed: ${error.message}`);
        insertErrors++;
      } else {
        insertCount++;
      }
    }

    console.log(`   ✅ Inserted ${insertCount} days, ${insertErrors} errors`);

    // Verify new totals
    const { data: newAst } = await supabase
      .from("annual_sales_tracking")
      .select("orders, revenue")
      .eq("year", 2025)
      .eq("channel", "d2c")
      .gte("date", "2025-01-01")
      .lte("date", "2025-12-28");

    const newOrders = newAst?.reduce((sum, d) => sum + (d.orders || 0), 0) || 0;
    const newRevenue = newAst?.reduce((sum, d) => sum + (parseFloat(d.revenue) || 0), 0) || 0;

    console.log(`\n📊 New AST totals:`);
    console.log(`   Orders: ${newOrders.toLocaleString()} (target: ${TARGET_ORDERS.toLocaleString()})`);
    console.log(`   Revenue: $${newRevenue.toLocaleString()}`);
    console.log(`   Diff: ${newOrders - TARGET_ORDERS >= 0 ? '+' : ''}${newOrders - TARGET_ORDERS} orders`);
  } else if (DRY_RUN) {
    console.log("\n   Set DRY_RUN = false to rebuild");
  }

  console.log("\n" + "=".repeat(70));
}

rebuildAst().catch(console.error);
