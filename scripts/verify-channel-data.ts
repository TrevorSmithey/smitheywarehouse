/**
 * Quick verification of annual_sales_tracking data
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function verify() {
  // Check data distribution
  const { data, error } = await supabase
    .from("annual_sales_tracking")
    .select("year, channel, day_of_year, orders, revenue")
    .order("year")
    .order("channel")
    .order("day_of_year");

  if (error) {
    console.error("Error:", error);
    return;
  }

  // Group by year and channel
  const stats: Record<string, { days: number; orders: number; revenue: number; minDay: number; maxDay: number }> = {};

  for (const row of data || []) {
    const key = `${row.year}-${row.channel}`;
    if (!stats[key]) {
      stats[key] = { days: 0, orders: 0, revenue: 0, minDay: 999, maxDay: 0 };
    }
    stats[key].days++;
    stats[key].orders += row.orders || 0;
    stats[key].revenue += parseFloat(row.revenue) || 0;
    stats[key].minDay = Math.min(stats[key].minDay, row.day_of_year);
    stats[key].maxDay = Math.max(stats[key].maxDay, row.day_of_year);
  }

  console.log("\nData Verification:");
  console.log("─".repeat(80));
  console.log("Year-Channel   | Days | Day Range | Orders   | Revenue");
  console.log("─".repeat(80));

  for (const [key, s] of Object.entries(stats).sort()) {
    const revStr = "$" + s.revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    console.log(
      `${key.padEnd(14)} | ${String(s.days).padStart(4)} | ${(s.minDay + "-" + s.maxDay).padStart(9)} | ${String(s.orders.toLocaleString()).padStart(8)} | ${revStr}`
    );
  }

  // Quick sanity checks
  console.log("\n✓ Verification complete");

  // Check totals make sense
  const d2c2025 = stats["2025-d2c"];
  const b2b2025 = stats["2025-b2b"];
  if (d2c2025 && b2b2025) {
    const total2025 = d2c2025.revenue + b2b2025.revenue;
    console.log(`\n2025 Total Revenue: $${total2025.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    console.log(`  D2C: ${((d2c2025.revenue / total2025) * 100).toFixed(1)}%`);
    console.log(`  B2B: ${((b2b2025.revenue / total2025) * 100).toFixed(1)}%`);
  }
}

verify().catch(console.error);
