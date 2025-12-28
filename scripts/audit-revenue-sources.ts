/**
 * Revenue Source Audit Script
 *
 * Compares YTD 2025 revenue across three data sources:
 * 1. annual_sales_tracking (Revenue Tracker source)
 * 2. orders table (Analytics dashboard source)
 * 3. daily_stats (intermediate sync table)
 *
 * Run with: npx tsx scripts/audit-revenue-sources.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function auditRevenueSources() {
  console.log("\n" + "=".repeat(70));
  console.log("REVENUE SOURCE AUDIT - YTD 2025");
  console.log("=".repeat(70) + "\n");

  const startDate = "2025-01-01";
  const endDate = new Date().toISOString().split("T")[0]; // Today

  // =========================================================================
  // SOURCE 1: annual_sales_tracking (Revenue Tracker uses this)
  // =========================================================================
  console.log("📊 Source 1: annual_sales_tracking (D2C channel)");
  console.log("-".repeat(50));

  const { data: annualData, error: annualError } = await supabase
    .from("annual_sales_tracking")
    .select("date, revenue, orders")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .order("date", { ascending: true });

  if (annualError) {
    console.error("  Error:", annualError.message);
  } else {
    const annualRevenue = annualData?.reduce((sum, r) => sum + (parseFloat(r.revenue) || 0), 0) || 0;
    const annualOrders = annualData?.reduce((sum, r) => sum + (r.orders || 0), 0) || 0;
    const annualDays = annualData?.length || 0;
    const firstDate = annualData?.[0]?.date;
    const lastDate = annualData?.[annualData.length - 1]?.date;

    console.log(`  Revenue:    $${annualRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Orders:     ${annualOrders.toLocaleString()}`);
    console.log(`  Days:       ${annualDays}`);
    console.log(`  Date Range: ${firstDate} → ${lastDate}`);
    console.log(`  AOV:        $${annualOrders > 0 ? (annualRevenue / annualOrders).toFixed(2) : 0}`);
  }

  // =========================================================================
  // SOURCE 2: daily_stats (intermediate table, synced from Shopify Analytics)
  // =========================================================================
  console.log("\n📊 Source 2: daily_stats");
  console.log("-".repeat(50));

  const { data: dailyData, error: dailyError } = await supabase
    .from("daily_stats")
    .select("date, total_revenue, total_orders")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (dailyError) {
    console.error("  Error:", dailyError.message);
  } else {
    const dailyRevenue = dailyData?.reduce((sum, r) => sum + (parseFloat(r.total_revenue) || 0), 0) || 0;
    const dailyOrders = dailyData?.reduce((sum, r) => sum + (r.total_orders || 0), 0) || 0;
    const dailyDays = dailyData?.length || 0;
    const firstDate = dailyData?.[0]?.date;
    const lastDate = dailyData?.[dailyData.length - 1]?.date;

    console.log(`  Revenue:    $${dailyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Orders:     ${dailyOrders.toLocaleString()}`);
    console.log(`  Days:       ${dailyDays}`);
    console.log(`  Date Range: ${firstDate} → ${lastDate}`);
    console.log(`  AOV:        $${dailyOrders > 0 ? (dailyRevenue / dailyOrders).toFixed(2) : 0}`);
  }

  // =========================================================================
  // SOURCE 3: orders table (Analytics dashboard uses this)
  // =========================================================================
  console.log("\n📊 Source 3: orders table (canceled=false)");
  console.log("-".repeat(50));

  // Need to paginate - orders table can be large
  let allOrders: Array<{ total_price: string; created_at: string }> = [];
  let page = 0;
  const pageSize = 10000;
  let hasMore = true;

  while (hasMore) {
    const { data: ordersPage, error: ordersError } = await supabase
      .from("orders")
      .select("total_price, created_at")
      .gte("created_at", `${startDate}T00:00:00`)
      .lte("created_at", `${endDate}T23:59:59`)
      .eq("canceled", false)
      .not("total_price", "is", null)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (ordersError) {
      console.error("  Error:", ordersError.message);
      hasMore = false;
    } else if (ordersPage && ordersPage.length > 0) {
      allOrders = allOrders.concat(ordersPage);
      page++;
      hasMore = ordersPage.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  const ordersRevenue = allOrders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);
  const ordersCount = allOrders.length;
  const orderDates = allOrders.map(o => o.created_at.split("T")[0]);
  const uniqueDays = new Set(orderDates).size;
  const firstOrderDate = orderDates.length > 0 ? orderDates.sort()[0] : null;
  const lastOrderDate = orderDates.length > 0 ? orderDates.sort()[orderDates.length - 1] : null;

  console.log(`  Revenue:    $${ordersRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Orders:     ${ordersCount.toLocaleString()}`);
  console.log(`  Days:       ${uniqueDays}`);
  console.log(`  Date Range: ${firstOrderDate} → ${lastOrderDate}`);
  console.log(`  AOV:        $${ordersCount > 0 ? (ordersRevenue / ordersCount).toFixed(2) : 0}`);

  // =========================================================================
  // COMPARISON
  // =========================================================================
  console.log("\n" + "=".repeat(70));
  console.log("COMPARISON");
  console.log("=".repeat(70));

  const annualRevenue = annualData?.reduce((sum, r) => sum + (parseFloat(r.revenue) || 0), 0) || 0;
  const dailyRevenue = dailyData?.reduce((sum, r) => sum + (parseFloat(r.total_revenue) || 0), 0) || 0;

  const diff1 = annualRevenue - dailyRevenue;
  const diff2 = annualRevenue - ordersRevenue;
  const diff3 = dailyRevenue - ordersRevenue;

  console.log("\n  annual_sales_tracking vs daily_stats:");
  console.log(`    Difference: $${diff1.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${((diff1 / dailyRevenue) * 100).toFixed(3)}%)`);
  console.log(`    ${Math.abs(diff1) < 1 ? "✅ MATCH" : Math.abs(diff1) < 100 ? "⚠️  MINOR DIFF" : "❌ SIGNIFICANT DIFF"}`);

  console.log("\n  annual_sales_tracking vs orders:");
  console.log(`    Difference: $${diff2.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${((diff2 / ordersRevenue) * 100).toFixed(3)}%)`);
  console.log(`    ${Math.abs(diff2) < 1 ? "✅ MATCH" : Math.abs(diff2) < 100 ? "⚠️  MINOR DIFF" : "❌ SIGNIFICANT DIFF"}`);

  console.log("\n  daily_stats vs orders:");
  console.log(`    Difference: $${diff3.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${((diff3 / ordersRevenue) * 100).toFixed(3)}%)`);
  console.log(`    ${Math.abs(diff3) < 1 ? "✅ MATCH" : Math.abs(diff3) < 100 ? "⚠️  MINOR DIFF" : "❌ SIGNIFICANT DIFF"}`);

  // =========================================================================
  // ORDER COUNT COMPARISON
  // =========================================================================
  console.log("\n" + "-".repeat(70));
  console.log("ORDER COUNT COMPARISON");
  console.log("-".repeat(70));

  const annualOrders = annualData?.reduce((sum, r) => sum + (r.orders || 0), 0) || 0;
  const dailyOrders = dailyData?.reduce((sum, r) => sum + (r.total_orders || 0), 0) || 0;

  console.log(`\n  annual_sales_tracking: ${annualOrders.toLocaleString()} orders`);
  console.log(`  daily_stats:           ${dailyOrders.toLocaleString()} orders`);
  console.log(`  orders table:          ${ordersCount.toLocaleString()} orders`);

  const orderDiff = annualOrders - ordersCount;
  console.log(`\n  annual vs orders diff: ${orderDiff.toLocaleString()} (${((orderDiff / ordersCount) * 100).toFixed(2)}%)`);

  console.log("\n" + "=".repeat(70));
  console.log("AUDIT COMPLETE");
  console.log("=".repeat(70) + "\n");
}

auditRevenueSources().catch(console.error);
