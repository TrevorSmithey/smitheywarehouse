/**
 * Investigate the 1,469 order count difference
 *
 * Run with: npx tsx scripts/audit-order-count-diff.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function investigateOrderDiff() {
  console.log("\n" + "=".repeat(70));
  console.log("ORDER COUNT DIFFERENCE INVESTIGATION");
  console.log("=".repeat(70) + "\n");

  // =========================================================================
  // Check 1: Canceled orders - are they in daily_stats but not in our query?
  // =========================================================================
  console.log("📊 Check 1: Canceled orders in 2025");
  console.log("-".repeat(50));

  const { data: canceledOrders } = await supabase
    .from("orders")
    .select("total_price, canceled, financial_status")
    .gte("created_at", "2025-01-01T05:00:00Z")
    .lt("created_at", "2025-12-29T05:00:00Z")
    .eq("canceled", true);

  const canceledRevenue = canceledOrders?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;
  console.log(`\n  Canceled orders: ${canceledOrders?.length || 0}`);
  console.log(`  Revenue (if counted): $${canceledRevenue.toLocaleString()}`);

  // =========================================================================
  // Check 2: Orders with null total_price
  // =========================================================================
  console.log("\n📊 Check 2: Orders with null total_price");
  console.log("-".repeat(50));

  const { data: nullPriceOrders } = await supabase
    .from("orders")
    .select("id, shopify_order_id, financial_status, canceled")
    .gte("created_at", "2025-01-01T05:00:00Z")
    .lt("created_at", "2025-12-29T05:00:00Z")
    .is("total_price", null);

  console.log(`\n  Orders with null total_price: ${nullPriceOrders?.length || 0}`);

  // =========================================================================
  // Check 3: All orders count (no filters)
  // =========================================================================
  console.log("\n📊 Check 3: Total order count (no filters)");
  console.log("-".repeat(50));

  const { count: totalOrdersCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", "2025-01-01T05:00:00Z")
    .lt("created_at", "2025-12-29T05:00:00Z");

  console.log(`\n  All orders (EST boundaries): ${totalOrdersCount?.toLocaleString() || 0}`);
  console.log(`  Expected from daily_stats: 96,391`);
  console.log(`  Difference: ${(96391 - (totalOrdersCount || 0)).toLocaleString()}`);

  // =========================================================================
  // Check 4: Breakdown by canceled + null status
  // =========================================================================
  console.log("\n📊 Check 4: Order breakdown by status");
  console.log("-".repeat(50));

  const { data: allOrders } = await supabase
    .from("orders")
    .select("canceled, total_price")
    .gte("created_at", "2025-01-01T05:00:00Z")
    .lt("created_at", "2025-12-29T05:00:00Z");

  let notCanceledWithPrice = 0;
  let notCanceledNullPrice = 0;
  let canceledWithPrice = 0;
  let canceledNullPrice = 0;

  for (const o of allOrders || []) {
    const hasPrice = o.total_price !== null;
    if (o.canceled) {
      if (hasPrice) canceledWithPrice++;
      else canceledNullPrice++;
    } else {
      if (hasPrice) notCanceledWithPrice++;
      else notCanceledNullPrice++;
    }
  }

  console.log(`\n  Not canceled + has price: ${notCanceledWithPrice.toLocaleString()} (what we count)`);
  console.log(`  Not canceled + null price: ${notCanceledNullPrice}`);
  console.log(`  Canceled + has price: ${canceledWithPrice}`);
  console.log(`  Canceled + null price: ${canceledNullPrice}`);
  console.log(`  Total: ${(notCanceledWithPrice + notCanceledNullPrice + canceledWithPrice + canceledNullPrice).toLocaleString()}`);

  // =========================================================================
  // Check 5: Does Shopify Analytics include test orders?
  // =========================================================================
  console.log("\n📊 Check 5: Test mode orders");
  console.log("-".repeat(50));

  const { data: testOrders } = await supabase
    .from("orders")
    .select("id, test")
    .gte("created_at", "2025-01-01T05:00:00Z")
    .lt("created_at", "2025-12-29T05:00:00Z")
    .eq("test", true);

  console.log(`\n  Test orders (test=true): ${testOrders?.length || 0}`);

  // =========================================================================
  // Check 6: Daily comparison - which days have the biggest order count diff?
  // =========================================================================
  console.log("\n📊 Check 6: Days with biggest order count differences");
  console.log("-".repeat(50));

  const { data: dailyStats } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28")
    .order("date");

  const { data: ordersRaw } = await supabase
    .from("orders")
    .select("created_at")
    .gte("created_at", "2025-01-01T05:00:00Z")
    .lt("created_at", "2025-12-29T05:00:00Z")
    .eq("canceled", false)
    .not("total_price", "is", null);

  // Count orders by EST date
  const orderCountByDate = new Map<string, number>();
  for (const o of ordersRaw || []) {
    const utcTime = new Date(o.created_at);
    const estTime = new Date(utcTime.getTime() - 5 * 60 * 60 * 1000);
    const estDate = estTime.toISOString().split("T")[0];
    orderCountByDate.set(estDate, (orderCountByDate.get(estDate) || 0) + 1);
  }

  // Compare
  const orderDiffs: Array<{ date: string; dailyStats: number; ordersTable: number; diff: number }> = [];
  for (const ds of dailyStats || []) {
    const ordersCount = orderCountByDate.get(ds.date) || 0;
    orderDiffs.push({
      date: ds.date,
      dailyStats: ds.total_orders,
      ordersTable: ordersCount,
      diff: ds.total_orders - ordersCount,
    });
  }

  orderDiffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log("\nTop 15 days with biggest order count differences:\n");
  console.log("Date        | daily_stats | orders table | Diff");
  console.log("-".repeat(50));

  for (const d of orderDiffs.slice(0, 15)) {
    console.log(
      `${d.date} | ${String(d.dailyStats).padStart(11)} | ${String(d.ordersTable).padStart(12)} | ${d.diff >= 0 ? "+" : ""}${d.diff}`
    );
  }

  // Sum of all positive diffs (days where daily_stats > orders)
  const totalPositiveDiff = orderDiffs.filter(d => d.diff > 0).reduce((sum, d) => sum + d.diff, 0);
  const totalNegativeDiff = orderDiffs.filter(d => d.diff < 0).reduce((sum, d) => sum + d.diff, 0);

  console.log(`\n  Days where daily_stats > orders: ${totalPositiveDiff} orders`);
  console.log(`  Days where orders > daily_stats: ${Math.abs(totalNegativeDiff)} orders`);
  console.log(`  Net difference: ${totalPositiveDiff + totalNegativeDiff} orders`);

  console.log("\n" + "=".repeat(70));
  console.log("INVESTIGATION COMPLETE");
  console.log("=".repeat(70) + "\n");
}

investigateOrderDiff().catch(console.error);
