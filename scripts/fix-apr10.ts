/**
 * Fix Apr 10 - investigate and update the existing entry
 *
 * Run with: npx tsx scripts/fix-apr10.ts
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

async function fixApr10() {
  console.log("\n" + "=".repeat(70));
  console.log("FIX APRIL 10");
  console.log("=".repeat(70) + "\n");

  // Check what's at day_of_year=100 for 2025 d2c
  const { data: day100Entry } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("year", 2025)
    .eq("day_of_year", 100)
    .eq("channel", "d2c");

  console.log("📊 Current entry at day_of_year=100:");
  console.log(JSON.stringify(day100Entry, null, 2));

  // Get Apr 10 from daily_stats
  const { data: apr10Ds } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-04-10");

  console.log("\n📊 Apr 10 in daily_stats:");
  console.log(JSON.stringify(apr10Ds, null, 2));

  // If day_of_year=100 exists but has wrong date or 0 values, update it
  if (day100Entry && day100Entry.length > 0) {
    const current = day100Entry[0];

    if (current.date !== "2025-04-10" || current.orders === 0) {
      console.log("\n📊 Updating day_of_year=100 to Apr 10 data...");

      const dsData = apr10Ds?.[0];
      if (dsData) {
        const { error } = await supabase
          .from("annual_sales_tracking")
          .update({
            date: "2025-04-10",
            orders: dsData.total_orders,
            revenue: dsData.total_revenue,
            synced_at: new Date().toISOString(),
          })
          .eq("year", 2025)
          .eq("day_of_year", 100)
          .eq("channel", "d2c");

        if (error) {
          console.log(`   ❌ Update failed: ${error.message}`);
        } else {
          console.log(`   ✅ Updated day_of_year=100 with Apr 10 data`);
        }
      }
    } else {
      console.log("\n   Day 100 already has correct Apr 10 data");
    }
  }

  // Verify after
  console.log("\n📊 After fix:");
  const { data: after } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("year", 2025)
    .eq("day_of_year", 100)
    .eq("channel", "d2c");

  console.log(JSON.stringify(after, null, 2));

  // Check totals
  const { data: allAst } = await supabase
    .from("annual_sales_tracking")
    .select("orders, revenue")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  const totalOrders = allAst?.reduce((sum, d) => sum + (d.orders || 0), 0) || 0;
  const totalRevenue = allAst?.reduce((sum, d) => sum + (parseFloat(d.revenue) || 0), 0) || 0;

  console.log("\n📊 New AST totals:");
  console.log(`   Orders: ${totalOrders.toLocaleString()} (target: 96,533)`);
  console.log(`   Revenue: $${totalRevenue.toLocaleString()} (target: $30,637,801.19)`);
  console.log(`   Diff: ${totalOrders - 96533 >= 0 ? '+' : ''}${totalOrders - 96533} orders`);

  console.log("\n" + "=".repeat(70));
}

fixApr10().catch(console.error);
