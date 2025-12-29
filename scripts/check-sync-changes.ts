/**
 * Check what the sync changed
 *
 * Run with: npx tsx scripts/check-sync-changes.ts
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

async function checkSyncChanges() {
  console.log("\n" + "=".repeat(70));
  console.log("CHECKING SYNC CHANGES");
  console.log("=".repeat(70) + "\n");

  // Get daily_stats for last 35 days
  const today = new Date();
  const thirtyFiveDaysAgo = new Date(today);
  thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);

  const { data: recentDays } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue, updated_at")
    .gte("date", thirtyFiveDaysAgo.toISOString().split("T")[0])
    .order("date", { ascending: false });

  console.log("📊 Last 35 days in daily_stats:");
  console.log("-".repeat(70));
  console.log("Date       | Orders | Revenue      | Last Updated");
  console.log("-".repeat(70));

  for (const d of recentDays || []) {
    const updatedAt = d.updated_at ? new Date(d.updated_at).toISOString().split("T")[0] : "N/A";
    console.log(`${d.date} | ${String(d.total_orders).padStart(6)} | $${parseFloat(d.total_revenue).toLocaleString().padStart(11)} | ${updatedAt}`);
  }

  // Check totals
  const { data: allDs } = await supabase
    .from("daily_stats")
    .select("total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  const totalOrders = allDs?.reduce((sum, d) => sum + (d.total_orders || 0), 0) || 0;
  const totalRevenue = allDs?.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0) || 0;

  console.log("\n📊 YTD Totals (Jan 1 - Dec 28):");
  console.log(`   Orders: ${totalOrders.toLocaleString()}`);
  console.log(`   Revenue: $${totalRevenue.toLocaleString()}`);
  console.log(`   Target: 96,533 orders, $30,637,801.19`);
  console.log(`   Diff: ${totalOrders - 96533 >= 0 ? '+' : ''}${totalOrders - 96533} orders`);

  console.log("\n" + "=".repeat(70));
}

checkSyncChanges().catch(console.error);
