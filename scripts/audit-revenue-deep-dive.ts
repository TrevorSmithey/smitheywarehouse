/**
 * Deep dive into revenue discrepancies
 *
 * Run with: npx tsx scripts/audit-revenue-deep-dive.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function deepDive() {
  console.log("\n" + "=".repeat(70));
  console.log("REVENUE DISCREPANCY DEEP DIVE");
  console.log("=".repeat(70) + "\n");

  // =========================================================================
  // CHECK 1: Daily comparison - find days with biggest discrepancies
  // =========================================================================
  console.log("📊 Check 1: Daily Comparison (biggest discrepancies)");
  console.log("-".repeat(50));

  // Get daily_stats data
  const { data: dailyStats } = await supabase
    .from("daily_stats")
    .select("date, total_revenue, total_orders")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28")
    .order("date");

  // Get orders aggregated by day
  const { data: ordersRaw } = await supabase
    .from("orders")
    .select("created_at, total_price")
    .gte("created_at", "2025-01-01T00:00:00")
    .lte("created_at", "2025-12-28T23:59:59")
    .eq("canceled", false)
    .not("total_price", "is", null);

  // Aggregate orders by day
  const ordersByDay = new Map<string, { revenue: number; orders: number }>();
  for (const o of ordersRaw || []) {
    const day = o.created_at.split("T")[0];
    const existing = ordersByDay.get(day) || { revenue: 0, orders: 0 };
    existing.revenue += parseFloat(o.total_price) || 0;
    existing.orders += 1;
    ordersByDay.set(day, existing);
  }

  // Compare and find discrepancies
  const discrepancies: Array<{
    date: string;
    dailyStatsRev: number;
    ordersRev: number;
    diff: number;
    dailyStatsOrders: number;
    ordersOrders: number;
    orderDiff: number;
  }> = [];

  for (const ds of dailyStats || []) {
    const ordersData = ordersByDay.get(ds.date) || { revenue: 0, orders: 0 };
    const revDiff = (parseFloat(ds.total_revenue) || 0) - ordersData.revenue;
    const orderDiff = (ds.total_orders || 0) - ordersData.orders;

    discrepancies.push({
      date: ds.date,
      dailyStatsRev: parseFloat(ds.total_revenue) || 0,
      ordersRev: ordersData.revenue,
      diff: revDiff,
      dailyStatsOrders: ds.total_orders || 0,
      ordersOrders: ordersData.orders,
      orderDiff: orderDiff,
    });
  }

  // Sort by absolute difference
  discrepancies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log("\nTop 10 days with biggest revenue discrepancies:\n");
  console.log("Date        | daily_stats  | orders table |    Diff    | Order Δ");
  console.log("-".repeat(70));

  for (const d of discrepancies.slice(0, 10)) {
    const sign = d.diff >= 0 ? "+" : "";
    console.log(
      `${d.date} | $${d.dailyStatsRev.toLocaleString().padStart(10)} | $${d.ordersRev.toLocaleString().padStart(10)} | ${sign}$${d.diff.toLocaleString().padStart(8)} | ${d.orderDiff >= 0 ? "+" : ""}${d.orderDiff}`
    );
  }

  // =========================================================================
  // CHECK 2: Are there orders with very high values in orders table?
  // =========================================================================
  console.log("\n\n📊 Check 2: High-value orders in orders table");
  console.log("-".repeat(50));

  const { data: highValueOrders } = await supabase
    .from("orders")
    .select("id, shopify_order_id, total_price, created_at, canceled, financial_status")
    .gte("created_at", "2025-01-01T00:00:00")
    .eq("canceled", false)
    .not("total_price", "is", null)
    .order("total_price", { ascending: false })
    .limit(20);

  console.log("\nTop 20 highest value orders:\n");
  console.log("Order ID         | Total Price | Date       | Financial Status");
  console.log("-".repeat(70));

  for (const o of highValueOrders || []) {
    console.log(
      `${String(o.shopify_order_id).padEnd(16)} | $${parseFloat(o.total_price).toLocaleString().padStart(10)} | ${o.created_at.split("T")[0]} | ${o.financial_status || "N/A"}`
    );
  }

  // =========================================================================
  // CHECK 3: Financial status breakdown
  // =========================================================================
  console.log("\n\n📊 Check 3: Financial Status Breakdown (orders table)");
  console.log("-".repeat(50));

  const { data: statusBreakdown } = await supabase
    .from("orders")
    .select("financial_status, total_price")
    .gte("created_at", "2025-01-01T00:00:00")
    .lte("created_at", "2025-12-28T23:59:59")
    .eq("canceled", false)
    .not("total_price", "is", null);

  const byStatus = new Map<string, { count: number; revenue: number }>();
  for (const o of statusBreakdown || []) {
    const status = o.financial_status || "null";
    const existing = byStatus.get(status) || { count: 0, revenue: 0 };
    existing.count += 1;
    existing.revenue += parseFloat(o.total_price) || 0;
    byStatus.set(status, existing);
  }

  console.log("\nStatus          | Orders  | Revenue        | Avg Order");
  console.log("-".repeat(70));

  const sortedStatus = Array.from(byStatus.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
  for (const [status, data] of sortedStatus) {
    const avg = data.count > 0 ? data.revenue / data.count : 0;
    console.log(
      `${status.padEnd(15)} | ${data.count.toLocaleString().padStart(7)} | $${data.revenue.toLocaleString().padStart(12)} | $${avg.toFixed(2)}`
    );
  }

  // =========================================================================
  // CHECK 4: Refunded orders analysis
  // =========================================================================
  console.log("\n\n📊 Check 4: Refunded Orders Analysis");
  console.log("-".repeat(50));

  const { data: refundedOrders } = await supabase
    .from("orders")
    .select("total_price, total_refunded")
    .gte("created_at", "2025-01-01T00:00:00")
    .lte("created_at", "2025-12-28T23:59:59")
    .eq("canceled", false)
    .not("total_price", "is", null)
    .gt("total_refunded", 0);

  const totalRefunded = refundedOrders?.reduce((sum, o) => sum + (parseFloat(o.total_refunded) || 0), 0) || 0;
  const refundedCount = refundedOrders?.length || 0;
  const refundedOriginalValue = refundedOrders?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;

  console.log(`\n  Orders with refunds: ${refundedCount.toLocaleString()}`);
  console.log(`  Total refunded amount: $${totalRefunded.toLocaleString()}`);
  console.log(`  Original order value of refunded orders: $${refundedOriginalValue.toLocaleString()}`);

  // =========================================================================
  // CHECK 5: Test/internal orders
  // =========================================================================
  console.log("\n\n📊 Check 5: Potential Test/Internal Orders");
  console.log("-".repeat(50));

  const { data: testOrders } = await supabase
    .from("orders")
    .select("id, shopify_order_id, total_price, customer_email, created_at")
    .gte("created_at", "2025-01-01T00:00:00")
    .lte("created_at", "2025-12-28T23:59:59")
    .eq("canceled", false)
    .or("customer_email.ilike.%@smithey.com,customer_email.ilike.%test%,total_price.eq.0");

  console.log(`\n  Potential test orders (smithey.com email or $0): ${testOrders?.length || 0}`);

  if (testOrders && testOrders.length > 0) {
    const testRevenue = testOrders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);
    console.log(`  Revenue from these orders: $${testRevenue.toLocaleString()}`);
  }

  // =========================================================================
  // CHECK 6: Orders table columns that might affect totals
  // =========================================================================
  console.log("\n\n📊 Check 6: Order Value Columns Available");
  console.log("-".repeat(50));

  const { data: sampleOrder } = await supabase
    .from("orders")
    .select("*")
    .limit(1);

  if (sampleOrder && sampleOrder.length > 0) {
    const columns = Object.keys(sampleOrder[0]).filter(k =>
      k.includes("price") || k.includes("total") || k.includes("amount") || k.includes("revenue")
    );
    console.log("\n  Price/total related columns in orders table:");
    for (const col of columns) {
      console.log(`    - ${col}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("DEEP DIVE COMPLETE");
  console.log("=".repeat(70) + "\n");
}

deepDive().catch(console.error);
