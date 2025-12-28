/**
 * Check annual_sales_tracking table properly
 *
 * Run with: npx tsx scripts/check-annual-tracking.ts
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

async function checkAnnualTracking() {
  console.log("\n" + "=".repeat(70));
  console.log("ANNUAL SALES TRACKING CHECK");
  console.log("=".repeat(70) + "\n");

  // TARGET from Shopify Analytics
  const TARGET_ORDERS = 96533;
  const TARGET_REVENUE = 30637801.19;

  console.log("🎯 TARGET (Shopify Analytics YTD through Dec 28):");
  console.log(`   Orders:  ${TARGET_ORDERS.toLocaleString()}`);
  console.log(`   Revenue: $${TARGET_REVENUE.toLocaleString()}\n`);

  // Check annual_sales_tracking - sum d2c for 2025
  const { data: ast2025, error } = await supabase
    .from("annual_sales_tracking")
    .select("date, orders, revenue")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .order("date", { ascending: false });

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  console.log(`📊 annual_sales_tracking (2025, d2c):`);
  console.log(`   Days found: ${ast2025?.length || 0}`);

  if (ast2025 && ast2025.length > 0) {
    const totalOrders = ast2025.reduce((sum, d) => sum + (d.orders || 0), 0);
    const totalRevenue = ast2025.reduce((sum, d) => sum + (parseFloat(d.revenue) || 0), 0);

    console.log(`   Total Orders:  ${totalOrders.toLocaleString()}`);
    console.log(`   Total Revenue: $${totalRevenue.toLocaleString()}`);

    const orderDiff = totalOrders - TARGET_ORDERS;
    const revDiff = totalRevenue - TARGET_REVENUE;
    console.log(`\n   Diff from Shopify:`);
    console.log(`     Orders:  ${orderDiff >= 0 ? '+' : ''}${orderDiff}`);
    console.log(`     Revenue: ${revDiff >= 0 ? '+' : ''}$${revDiff.toFixed(2)}`);

    // Last 5 days
    console.log("\n   Last 5 days:");
    for (const d of ast2025.slice(0, 5)) {
      console.log(`     ${d.date}: ${d.orders} orders, $${parseFloat(d.revenue).toLocaleString()}`);
    }
  } else {
    console.log("   ⚠️  No data found for 2025 d2c!");
  }

  // Now compare to daily_stats
  console.log("\n" + "-".repeat(70));
  console.log("📊 daily_stats (Jan 1 - Dec 28, 2025):");

  const { data: ds } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  if (ds && ds.length > 0) {
    const totOrders = ds.reduce((sum, d) => sum + (d.total_orders || 0), 0);
    const totRevenue = ds.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);

    console.log(`   Days: ${ds.length}`);
    console.log(`   Total Orders:  ${totOrders.toLocaleString()}`);
    console.log(`   Total Revenue: $${totRevenue.toLocaleString()}`);

    const orderDiff = totOrders - TARGET_ORDERS;
    const revDiff = totRevenue - TARGET_REVENUE;
    console.log(`\n   Diff from Shopify:`);
    console.log(`     Orders:  ${orderDiff >= 0 ? '+' : ''}${orderDiff}`);
    console.log(`     Revenue: ${revDiff >= 0 ? '+' : ''}$${revDiff.toFixed(2)}`);
  }

  console.log("\n" + "=".repeat(70));
}

checkAnnualTracking().catch(console.error);
