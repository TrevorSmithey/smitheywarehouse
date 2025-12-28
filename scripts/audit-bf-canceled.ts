/**
 * Black Friday canceled orders deep dive
 *
 * Run with: npx tsx scripts/audit-bf-canceled.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function bfDeepDive() {
  console.log("\n" + "=".repeat(70));
  console.log("BLACK FRIDAY CANCELED ORDERS ANALYSIS");
  console.log("=".repeat(70) + "\n");

  // Nov 28 EST = Nov 28 05:00 UTC to Nov 29 05:00 UTC
  const bfStart = "2025-11-28T05:00:00Z";
  const bfEnd = "2025-11-29T05:00:00Z";

  // =========================================================================
  // All orders on Black Friday
  // =========================================================================
  console.log("📊 Black Friday (Nov 28 EST) - All Orders");
  console.log("-".repeat(50));

  const { data: allBfOrders } = await supabase
    .from("orders")
    .select("shopify_order_id, total_price, canceled, financial_status, created_at")
    .gte("created_at", bfStart)
    .lt("created_at", bfEnd);

  const totalOrders = allBfOrders?.length || 0;
  const totalRevenue = allBfOrders?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;

  console.log(`\n  Total orders: ${totalOrders.toLocaleString()}`);
  console.log(`  Total revenue: $${totalRevenue.toLocaleString()}`);

  // =========================================================================
  // Canceled orders on Black Friday
  // =========================================================================
  console.log("\n📊 Black Friday - Canceled Orders");
  console.log("-".repeat(50));

  const canceledOrders = allBfOrders?.filter(o => o.canceled === true) || [];
  const canceledRevenue = canceledOrders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);

  console.log(`\n  Canceled orders: ${canceledOrders.length}`);
  console.log(`  Canceled revenue: $${canceledRevenue.toLocaleString()}`);
  console.log(`  Avg canceled order: $${canceledOrders.length > 0 ? (canceledRevenue / canceledOrders.length).toFixed(2) : 0}`);

  // =========================================================================
  // Non-canceled orders
  // =========================================================================
  console.log("\n📊 Black Friday - Non-Canceled Orders");
  console.log("-".repeat(50));

  const nonCanceledOrders = allBfOrders?.filter(o => o.canceled !== true) || [];
  const nonCanceledRevenue = nonCanceledOrders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);

  console.log(`\n  Non-canceled orders: ${nonCanceledOrders.length}`);
  console.log(`  Non-canceled revenue: $${nonCanceledRevenue.toLocaleString()}`);

  // =========================================================================
  // Compare to daily_stats
  // =========================================================================
  console.log("\n📊 Compare to daily_stats");
  console.log("-".repeat(50));

  const { data: bfDailyStats } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-11-28");

  const dsOrders = bfDailyStats?.[0]?.total_orders || 0;
  const dsRevenue = parseFloat(bfDailyStats?.[0]?.total_revenue) || 0;

  console.log(`\n  daily_stats orders: ${dsOrders.toLocaleString()}`);
  console.log(`  daily_stats revenue: $${dsRevenue.toLocaleString()}`);

  console.log("\n  COMPARISON:");
  console.log(`    Orders diff: ${dsOrders - nonCanceledOrders.length} (daily_stats - non-canceled)`);
  console.log(`    Revenue diff: $${(dsRevenue - nonCanceledRevenue).toLocaleString()} (daily_stats - non-canceled)`);

  // =========================================================================
  // Financial status breakdown for Black Friday
  // =========================================================================
  console.log("\n📊 Black Friday - Financial Status Breakdown");
  console.log("-".repeat(50));

  const byStatus = new Map<string, { count: number; revenue: number; canceled: number }>();
  for (const o of allBfOrders || []) {
    const status = o.financial_status || "null";
    const existing = byStatus.get(status) || { count: 0, revenue: 0, canceled: 0 };
    existing.count++;
    existing.revenue += parseFloat(o.total_price) || 0;
    if (o.canceled) existing.canceled++;
    byStatus.set(status, existing);
  }

  console.log("\nStatus           | Total | Canceled | Revenue");
  console.log("-".repeat(55));

  const sortedStatus = Array.from(byStatus.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
  for (const [status, data] of sortedStatus) {
    console.log(
      `${status.padEnd(16)} | ${String(data.count).padStart(5)} | ${String(data.canceled).padStart(8)} | $${data.revenue.toLocaleString()}`
    );
  }

  // =========================================================================
  // Look at the actual canceled orders - are they legit?
  // =========================================================================
  if (canceledOrders.length > 0 && canceledOrders.length <= 50) {
    console.log("\n📊 Canceled Order Details");
    console.log("-".repeat(50));
    console.log("\nOrder ID         | Total     | Financial Status | Time (UTC)");
    console.log("-".repeat(65));

    for (const o of canceledOrders.slice(0, 20)) {
      console.log(
        `${String(o.shopify_order_id).padEnd(16)} | $${parseFloat(o.total_price).toFixed(2).padStart(8)} | ${(o.financial_status || "N/A").padEnd(16)} | ${o.created_at}`
      );
    }

    if (canceledOrders.length > 20) {
      console.log(`... and ${canceledOrders.length - 20} more`);
    }
  }

  // =========================================================================
  // High-value canceled orders
  // =========================================================================
  console.log("\n📊 High-Value Canceled Orders (>$500)");
  console.log("-".repeat(50));

  const highValueCanceled = canceledOrders
    .filter(o => parseFloat(o.total_price) > 500)
    .sort((a, b) => parseFloat(b.total_price) - parseFloat(a.total_price));

  if (highValueCanceled.length > 0) {
    console.log("\nOrder ID         | Total     | Financial Status");
    console.log("-".repeat(50));
    for (const o of highValueCanceled.slice(0, 10)) {
      console.log(
        `${String(o.shopify_order_id).padEnd(16)} | $${parseFloat(o.total_price).toFixed(2).padStart(8)} | ${o.financial_status || "N/A"}`
      );
    }
    const highValueTotal = highValueCanceled.reduce((sum, o) => sum + parseFloat(o.total_price), 0);
    console.log(`\n  Total high-value canceled: ${highValueCanceled.length} orders, $${highValueTotal.toLocaleString()}`);
  } else {
    console.log("\n  No canceled orders over $500");
  }

  console.log("\n" + "=".repeat(70));
  console.log("ANALYSIS COMPLETE");
  console.log("=".repeat(70) + "\n");
}

bfDeepDive().catch(console.error);
