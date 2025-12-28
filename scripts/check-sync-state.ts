/**
 * Check current sync state of annual_sales_tracking vs daily_stats
 *
 * Run with: npx tsx scripts/check-sync-state.ts
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

async function checkSyncState() {
  console.log("\n" + "=".repeat(70));
  console.log("SYNC STATE CHECK - Comparing to Shopify Target");
  console.log("=".repeat(70) + "\n");

  // TARGET from Shopify Analytics
  const TARGET_ORDERS = 96533;
  const TARGET_REVENUE = 30637801.19;

  console.log("🎯 TARGET (Shopify Analytics YTD through Dec 28):");
  console.log(`   Orders:  ${TARGET_ORDERS.toLocaleString()}`);
  console.log(`   Revenue: $${TARGET_REVENUE.toLocaleString()}\n`);

  // Check annual_sales_tracking
  const { data: ast } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("year", 2025)
    .eq("channel", "d2c");

  if (ast && ast.length > 0) {
    const record = ast[0];
    console.log("📊 annual_sales_tracking (d2c 2025):");
    console.log(`   YTD Orders:  ${record.ytd_orders?.toLocaleString() || 0}`);
    console.log(`   YTD Revenue: $${parseFloat(record.ytd_revenue)?.toLocaleString() || 0}`);
    console.log(`   Last Updated: ${record.updated_at}`);

    const orderDiff = (record.ytd_orders || 0) - TARGET_ORDERS;
    const revDiff = parseFloat(record.ytd_revenue || 0) - TARGET_REVENUE;
    console.log(`   Order Diff:  ${orderDiff >= 0 ? '+' : ''}${orderDiff}`);
    console.log(`   Revenue Diff: ${revDiff >= 0 ? '+' : ''}$${revDiff.toFixed(2)}`);
  } else {
    console.log("⚠️  No annual_sales_tracking record for 2025 d2c");
  }

  // Check daily_stats totals
  const { data: dsAll } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28")
    .order("date", { ascending: false });

  if (dsAll && dsAll.length > 0) {
    const totOrders = dsAll.reduce((sum, d) => sum + (d.total_orders || 0), 0);
    const totRevenue = dsAll.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);

    console.log("\n📊 daily_stats (Jan 1 - Dec 28, 2025):");
    console.log(`   Days: ${dsAll.length}`);
    console.log(`   Total Orders:  ${totOrders.toLocaleString()}`);
    console.log(`   Total Revenue: $${totRevenue.toLocaleString()}`);

    const orderDiff = totOrders - TARGET_ORDERS;
    const revDiff = totRevenue - TARGET_REVENUE;
    console.log(`   Order Diff:  ${orderDiff >= 0 ? '+' : ''}${orderDiff}`);
    console.log(`   Revenue Diff: ${revDiff >= 0 ? '+' : ''}$${revDiff.toFixed(2)}`);

    // Show last 5 days
    console.log("\n   Last 5 days:");
    for (const d of dsAll.slice(0, 5)) {
      console.log(`     ${d.date}: ${d.total_orders} orders, $${parseFloat(d.total_revenue).toLocaleString()}`);
    }
  }

  // Check if there's Dec 29 data that might be included
  const { data: dec29 } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-12-29");

  if (dec29 && dec29.length > 0) {
    console.log("\n⚠️  Dec 29 data exists in daily_stats:");
    console.log(`   Orders: ${dec29[0].total_orders}`);
    console.log(`   Revenue: $${parseFloat(dec29[0].total_revenue).toLocaleString()}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("CHECK COMPLETE");
  console.log("=".repeat(70) + "\n");
}

checkSyncState().catch(console.error);
