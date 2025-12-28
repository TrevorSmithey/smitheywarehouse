/**
 * Compare annual_sales_tracking vs daily_stats day by day
 *
 * Run with: npx tsx scripts/compare-tables.ts
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

async function compareTables() {
  console.log("\n" + "=".repeat(70));
  console.log("COMPARING annual_sales_tracking vs daily_stats");
  console.log("=".repeat(70) + "\n");

  // Get annual_sales_tracking data
  const { data: ast } = await supabase
    .from("annual_sales_tracking")
    .select("date, orders, revenue")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .order("date");

  // Get daily_stats data
  const { data: ds } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-31")
    .order("date");

  // Create maps for easy comparison
  const astMap = new Map<string, { orders: number; revenue: number }>();
  for (const row of ast || []) {
    astMap.set(row.date, { orders: row.orders || 0, revenue: parseFloat(row.revenue) || 0 });
  }

  const dsMap = new Map<string, { orders: number; revenue: number }>();
  for (const row of ds || []) {
    dsMap.set(row.date, { orders: row.total_orders || 0, revenue: parseFloat(row.total_revenue) || 0 });
  }

  console.log(`annual_sales_tracking: ${astMap.size} days`);
  console.log(`daily_stats: ${dsMap.size} days`);

  // Find differences
  const differences: Array<{
    date: string;
    astOrders: number;
    dsOrders: number;
    orderDiff: number;
    astRev: number;
    dsRev: number;
    revDiff: number;
  }> = [];

  // Check all dates in both tables
  const allDates = new Set([...astMap.keys(), ...dsMap.keys()]);

  for (const date of allDates) {
    const astData = astMap.get(date) || { orders: 0, revenue: 0 };
    const dsData = dsMap.get(date) || { orders: 0, revenue: 0 };

    const orderDiff = astData.orders - dsData.orders;
    const revDiff = astData.revenue - dsData.revenue;

    if (orderDiff !== 0 || Math.abs(revDiff) > 0.01) {
      differences.push({
        date,
        astOrders: astData.orders,
        dsOrders: dsData.orders,
        orderDiff,
        astRev: astData.revenue,
        dsRev: dsData.revenue,
        revDiff,
      });
    }
  }

  console.log(`\nDays with differences: ${differences.length}\n`);

  // Sort by absolute order difference
  differences.sort((a, b) => Math.abs(b.orderDiff) - Math.abs(a.orderDiff));

  if (differences.length > 0) {
    console.log("Date        | AST Orders | DS Orders | Diff  | AST Rev      | DS Rev       | Rev Diff");
    console.log("-".repeat(100));

    for (const d of differences.slice(0, 30)) {
      const sign = d.orderDiff >= 0 ? "+" : "";
      const revSign = d.revDiff >= 0 ? "+" : "";
      console.log(
        `${d.date} | ${String(d.astOrders).padStart(10)} | ${String(d.dsOrders).padStart(9)} | ${sign}${d.orderDiff.toString().padStart(4)} | $${d.astRev.toLocaleString().padStart(10)} | $${d.dsRev.toLocaleString().padStart(10)} | ${revSign}$${d.revDiff.toFixed(2)}`
      );
    }

    if (differences.length > 30) {
      console.log(`... and ${differences.length - 30} more`);
    }

    // Total difference
    const totalOrderDiff = differences.reduce((sum, d) => sum + d.orderDiff, 0);
    const totalRevDiff = differences.reduce((sum, d) => sum + d.revDiff, 0);
    console.log(`\nTotal order diff: ${totalOrderDiff >= 0 ? '+' : ''}${totalOrderDiff}`);
    console.log(`Total revenue diff: ${totalRevDiff >= 0 ? '+' : ''}$${totalRevDiff.toFixed(2)}`);
  }

  console.log("\n" + "=".repeat(70));
}

compareTables().catch(console.error);
