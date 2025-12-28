/**
 * Compare YTD totals when orders table uses EST vs UTC
 *
 * Run with: npx tsx scripts/audit-ytd-comparison.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function compareYtd() {
  console.log("\n" + "=".repeat(70));
  console.log("YTD TOTAL COMPARISON WITH TIMEZONE CORRECTION");
  console.log("=".repeat(70) + "\n");

  // =========================================================================
  // What we're comparing:
  // daily_stats YTD = $30,591,793.58 (362 days, Jan 1 - Dec 28)
  // orders table YTD = $30,989,840.67 (same dates, UTC)
  // Difference = $398,047.09
  // =========================================================================

  // The key insight: if orders table uses UTC, then:
  // - Jan 1 00:00 UTC = Dec 31 7pm EST (2024)
  // - Dec 28 23:59 UTC = Dec 28 6:59pm EST
  //
  // So orders table with UTC dates Jan 1 - Dec 28 includes:
  // - Dec 31 2024 7pm - midnight EST (spillover from 2024)
  // - Excludes Dec 28 2025 7pm - midnight EST

  console.log("📊 Checking boundary conditions:\n");

  // Orders that fall in "Jan 1 UTC" but are actually "Dec 31 EST"
  const { data: dec31Spillover } = await supabase
    .from("orders")
    .select("total_price, created_at")
    .gte("created_at", "2025-01-01T00:00:00Z")
    .lt("created_at", "2025-01-01T05:00:00Z") // UTC midnight to 5am = EST 7pm-midnight Dec 31
    .eq("canceled", false)
    .not("total_price", "is", null);

  const dec31Revenue = dec31Spillover?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;
  console.log(`  Dec 31 2024 spillover (Jan 1 00:00-05:00 UTC):`);
  console.log(`    Orders: ${dec31Spillover?.length || 0}`);
  console.log(`    Revenue: $${dec31Revenue.toLocaleString()}`);

  // Orders that fall in "Dec 29 UTC" but are actually "Dec 28 EST"
  const { data: dec28Evening } = await supabase
    .from("orders")
    .select("total_price, created_at")
    .gte("created_at", "2025-12-29T00:00:00Z")
    .lt("created_at", "2025-12-29T05:00:00Z")
    .eq("canceled", false)
    .not("total_price", "is", null);

  const dec28EveningRevenue = dec28Evening?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;
  console.log(`\n  Dec 28 2025 evening (Dec 29 00:00-05:00 UTC):`);
  console.log(`    Orders: ${dec28Evening?.length || 0}`);
  console.log(`    Revenue: $${dec28EveningRevenue.toLocaleString()}`);

  // Now let's compute orders table YTD using EST boundaries
  console.log("\n" + "-".repeat(70));
  console.log("📊 Orders table YTD with EST date boundaries:\n");

  // EST Jan 1 00:00 = UTC Jan 1 05:00
  // EST Dec 28 23:59 = UTC Dec 29 04:59
  const { data: ordersEst } = await supabase
    .from("orders")
    .select("total_price")
    .gte("created_at", "2025-01-01T05:00:00Z") // Jan 1 midnight EST
    .lt("created_at", "2025-12-29T05:00:00Z")  // Dec 28 midnight EST (end of day)
    .eq("canceled", false)
    .not("total_price", "is", null);

  const ordersEstRevenue = ordersEst?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;
  const ordersEstCount = ordersEst?.length || 0;

  console.log(`  Orders (EST boundaries): ${ordersEstCount.toLocaleString()}`);
  console.log(`  Revenue (EST boundaries): $${ordersEstRevenue.toLocaleString()}`);

  // Compare to daily_stats
  const { data: dailyStats } = await supabase
    .from("daily_stats")
    .select("total_revenue, total_orders")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  const dailyStatsRevenue = dailyStats?.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0) || 0;
  const dailyStatsOrders = dailyStats?.reduce((sum, d) => sum + (d.total_orders || 0), 0) || 0;

  console.log(`\n  daily_stats: ${dailyStatsOrders.toLocaleString()} orders, $${dailyStatsRevenue.toLocaleString()}`);

  const diff = ordersEstRevenue - dailyStatsRevenue;
  const pctDiff = (diff / dailyStatsRevenue) * 100;

  console.log("\n" + "-".repeat(70));
  console.log("📊 CORRECTED COMPARISON:\n");
  console.log(`  orders table (EST boundaries): $${ordersEstRevenue.toLocaleString()}`);
  console.log(`  daily_stats:                   $${dailyStatsRevenue.toLocaleString()}`);
  console.log(`  Difference:                    $${diff.toLocaleString()} (${pctDiff.toFixed(3)}%)`);

  if (Math.abs(pctDiff) < 0.1) {
    console.log("\n  ✅ TOTALS MATCH when using EST boundaries!");
  } else {
    console.log("\n  ⚠️  Still have a discrepancy - may be other factors");
  }

  console.log("\n" + "=".repeat(70));
  console.log("COMPARISON COMPLETE");
  console.log("=".repeat(70) + "\n");
}

compareYtd().catch(console.error);
