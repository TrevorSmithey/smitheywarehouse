/**
 * Timezone analysis - check if orders are being attributed to different days
 *
 * Run with: npx tsx scripts/audit-timezone-check.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function timezoneCheck() {
  console.log("\n" + "=".repeat(70));
  console.log("TIMEZONE ANALYSIS");
  console.log("=".repeat(70) + "\n");

  // Check orders around midnight UTC on Dec 2 (which is 7pm-8pm EST on Dec 1)
  console.log("📊 Orders on Dec 2 UTC that might be Dec 1 EST:");
  console.log("-".repeat(50));

  const { data: dec2EarlyOrders } = await supabase
    .from("orders")
    .select("shopify_order_id, total_price, created_at")
    .gte("created_at", "2025-12-02T00:00:00Z")
    .lt("created_at", "2025-12-02T06:00:00Z") // First 6 hours of Dec 2 UTC = Dec 1 evening EST
    .eq("canceled", false)
    .order("created_at");

  const dec2EarlyRevenue = dec2EarlyOrders?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;
  console.log(`\n  Orders Dec 2 00:00-06:00 UTC (Dec 1 7pm-1am EST): ${dec2EarlyOrders?.length || 0}`);
  console.log(`  Revenue: $${dec2EarlyRevenue.toLocaleString()}`);

  // Similarly for Nov 29
  console.log("\n📊 Orders on Nov 29 UTC that might be Nov 28 EST (Black Friday):");
  console.log("-".repeat(50));

  const { data: nov29EarlyOrders } = await supabase
    .from("orders")
    .select("shopify_order_id, total_price, created_at")
    .gte("created_at", "2025-11-29T00:00:00Z")
    .lt("created_at", "2025-11-29T06:00:00Z")
    .eq("canceled", false)
    .order("created_at");

  const nov29EarlyRevenue = nov29EarlyOrders?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;
  console.log(`\n  Orders Nov 29 00:00-06:00 UTC (Nov 28 7pm-1am EST): ${nov29EarlyOrders?.length || 0}`);
  console.log(`  Revenue: $${nov29EarlyRevenue.toLocaleString()}`);

  // Check late night orders on Nov 28 EST (early Nov 29 UTC)
  console.log("\n📊 Hourly breakdown Nov 28-29 transition:");
  console.log("-".repeat(50));

  for (let hour = 22; hour <= 26; hour++) {
    const actualHour = hour % 24;
    const day = hour < 24 ? "2025-11-28" : "2025-11-29";
    const startTime = `${day}T${String(actualHour).padStart(2, "0")}:00:00Z`;
    const endTime = `${day}T${String(actualHour).padStart(2, "0")}:59:59Z`;

    const { data: hourlyOrders } = await supabase
      .from("orders")
      .select("total_price")
      .gte("created_at", startTime)
      .lte("created_at", endTime)
      .eq("canceled", false);

    const hourlyRevenue = hourlyOrders?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;
    const estHour = (actualHour - 5 + 24) % 24;
    const estDay = actualHour < 5 ? "Nov 28" : (day === "2025-11-28" ? "Nov 28" : "Nov 29");

    console.log(
      `  ${day} ${String(actualHour).padStart(2, "0")}:00 UTC (${estDay} ${String(estHour).padStart(2, "0")}:00 EST): ${hourlyOrders?.length || 0} orders, $${hourlyRevenue.toLocaleString()}`
    );
  }

  // What the fix would look like
  console.log("\n" + "=".repeat(70));
  console.log("IMPACT ANALYSIS");
  console.log("=".repeat(70));

  // Compare aggregating by UTC date vs EST date
  console.log("\n📊 YTD Totals - UTC vs EST date attribution:");
  console.log("-".repeat(50));

  const { data: allOrders } = await supabase
    .from("orders")
    .select("total_price, created_at")
    .gte("created_at", "2025-01-01T00:00:00Z")
    .lte("created_at", "2025-12-28T23:59:59Z")
    .eq("canceled", false)
    .not("total_price", "is", null);

  // Count by UTC date
  const byUtcDate = new Map<string, number>();
  const byEstDate = new Map<string, number>();

  for (const o of allOrders || []) {
    const utcDate = o.created_at.split("T")[0];
    const utcTime = new Date(o.created_at);
    // Convert to EST (UTC - 5 hours)
    const estTime = new Date(utcTime.getTime() - 5 * 60 * 60 * 1000);
    const estDate = estTime.toISOString().split("T")[0];

    const price = parseFloat(o.total_price) || 0;

    byUtcDate.set(utcDate, (byUtcDate.get(utcDate) || 0) + price);
    byEstDate.set(estDate, (byEstDate.get(estDate) || 0) + price);
  }

  // Find days with biggest differences
  const dateDiffs: Array<{ date: string; utc: number; est: number; diff: number }> = [];

  for (const [date, utcRev] of byUtcDate) {
    const estRev = byEstDate.get(date) || 0;
    dateDiffs.push({ date, utc: utcRev, est: estRev, diff: utcRev - estRev });
  }

  dateDiffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log("\nTop 10 days with biggest UTC vs EST difference:\n");
  console.log("Date        | UTC Total    | EST Total    | Difference");
  console.log("-".repeat(60));

  for (const d of dateDiffs.slice(0, 10)) {
    console.log(
      `${d.date} | $${d.utc.toLocaleString().padStart(10)} | $${d.est.toLocaleString().padStart(10)} | $${d.diff.toLocaleString().padStart(10)}`
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log("TIMEZONE CHECK COMPLETE");
  console.log("=".repeat(70) + "\n");
}

timezoneCheck().catch(console.error);
