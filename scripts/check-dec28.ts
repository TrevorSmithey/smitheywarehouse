/**
 * Check Dec 28 data completeness
 *
 * Run with: npx tsx scripts/check-dec28.ts
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

async function checkDec28() {
  console.log("\n" + "=".repeat(70));
  console.log("DECEMBER 28 DATA CHECK");
  console.log("=".repeat(70) + "\n");

  // Get last sync log
  console.log("📊 Last Shopify sync:");
  console.log("-".repeat(50));

  const { data: syncLogs } = await supabase
    .from("sync_logs")
    .select("*")
    .eq("sync_type", "shopify_stats")
    .order("completed_at", { ascending: false })
    .limit(3);

  for (const log of syncLogs || []) {
    console.log(`   ${log.completed_at}: ${log.status}`);
    if (log.details) {
      console.log(`     D2C: ${log.details.d2c?.daysUpdated || 0} days, ${log.details.d2c?.totalOrders || 0} orders`);
    }
  }

  // Check Dec 28 in both tables
  console.log("\n📊 Dec 28 in daily_stats:");
  const { data: dec28Ds } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-12-28");

  if (dec28Ds && dec28Ds.length > 0) {
    console.log(`   Orders: ${dec28Ds[0].total_orders}`);
    console.log(`   Revenue: $${dec28Ds[0].total_revenue}`);
    console.log(`   Updated: ${dec28Ds[0].updated_at}`);
  }

  console.log("\n📊 Dec 28 in annual_sales_tracking:");
  const { data: dec28Ast } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("date", "2025-12-28")
    .eq("channel", "d2c");

  if (dec28Ast && dec28Ast.length > 0) {
    console.log(`   Orders: ${dec28Ast[0].orders}`);
    console.log(`   Revenue: $${dec28Ast[0].revenue}`);
    console.log(`   Synced: ${dec28Ast[0].synced_at}`);
  }

  // Compare Dec 27 and 28
  console.log("\n📊 Comparison (Dec 27 vs 28):");
  const { data: dec27Ds } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-12-27");

  console.log(`   Dec 27: ${dec27Ds?.[0]?.total_orders || 0} orders, $${dec27Ds?.[0]?.total_revenue || 0}`);
  console.log(`   Dec 28: ${dec28Ds?.[0]?.total_orders || 0} orders, $${dec28Ds?.[0]?.total_revenue || 0}`);

  if (dec27Ds?.[0]?.total_orders && dec28Ds?.[0]?.total_orders) {
    const ratio = dec28Ds[0].total_orders / dec27Ds[0].total_orders;
    console.log(`   Ratio: ${(ratio * 100).toFixed(1)}% (Dec 28 is ${ratio < 1 ? 'lower' : 'higher'} than Dec 27)`);

    if (ratio < 0.1) {
      console.log(`   ⚠️  Dec 28 appears INCOMPLETE (should be ~${Math.round(dec27Ds[0].total_orders * 0.8)}-${Math.round(dec27Ds[0].total_orders * 1.2)} orders)`);
    }
  }

  // Estimate what Dec 28 should have based on averages
  console.log("\n📊 Estimated Dec 28 (based on recent days):");

  const { data: recentDays } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-12-23")
    .lte("date", "2025-12-27")
    .order("date");

  if (recentDays && recentDays.length > 0) {
    const avgOrders = recentDays.reduce((sum, d) => sum + d.total_orders, 0) / recentDays.length;
    const avgRevenue = recentDays.reduce((sum, d) => sum + parseFloat(d.total_revenue), 0) / recentDays.length;

    console.log(`   Dec 23-27 avg: ${Math.round(avgOrders)} orders, $${Math.round(avgRevenue).toLocaleString()}`);
    console.log(`   Dec 28 actual: ${dec28Ds?.[0]?.total_orders || 0} orders`);

    const estimatedMissing = Math.round(avgOrders) - (dec28Ds?.[0]?.total_orders || 0);
    console.log(`   Estimated missing: ~${estimatedMissing} orders`);

    // This aligns with our -104 gap!
    console.log(`\n   🎯 This explains the ~104 order gap we found!`);
  }

  console.log("\n" + "=".repeat(70));
}

checkDec28().catch(console.error);
