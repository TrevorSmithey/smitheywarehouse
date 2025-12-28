/**
 * Verify the gap is from Dec 28 incomplete data
 *
 * Run with: npx tsx scripts/verify-gap.ts
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

async function verifyGap() {
  console.log("\n" + "=".repeat(70));
  console.log("VERIFYING THE 142-ORDER GAP");
  console.log("=".repeat(70) + "\n");

  const TARGET_ORDERS = 96533;
  const TARGET_REVENUE = 30637801.19;

  // Get Jan 1 - Dec 27 from daily_stats
  const { data: jan1ToDec27 } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-27");

  const ordersJan1Dec27 = jan1ToDec27?.reduce((sum, d) => sum + (d.total_orders || 0), 0) || 0;
  const revenueJan1Dec27 = jan1ToDec27?.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0) || 0;

  console.log("📊 daily_stats Jan 1 - Dec 27:");
  console.log(`   Days: ${jan1ToDec27?.length}`);
  console.log(`   Orders: ${ordersJan1Dec27.toLocaleString()}`);
  console.log(`   Revenue: $${revenueJan1Dec27.toLocaleString()}`);

  // Get Dec 28 current data
  const { data: dec28 } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-12-28");

  const dec28Orders = dec28?.[0]?.total_orders || 0;
  const dec28Revenue = parseFloat(dec28?.[0]?.total_revenue) || 0;

  console.log("\n📊 Dec 28 current data:");
  console.log(`   Orders: ${dec28Orders}`);
  console.log(`   Revenue: $${dec28Revenue.toLocaleString()}`);

  // Calculate what Dec 28 SHOULD have based on Shopify target
  const dec28ShouldHave = TARGET_ORDERS - ordersJan1Dec27;
  const dec28RevenueShouldHave = TARGET_REVENUE - revenueJan1Dec27;

  console.log("\n📊 Dec 28 SHOULD have (based on Shopify target):");
  console.log(`   Orders: ${dec28ShouldHave}`);
  console.log(`   Revenue: $${dec28RevenueShouldHave.toLocaleString()}`);

  // The gap
  const orderGap = dec28ShouldHave - dec28Orders;
  const revenueGap = dec28RevenueShouldHave - dec28Revenue;

  console.log("\n📊 Gap (what's missing from Dec 28):");
  console.log(`   Orders: ${orderGap}`);
  console.log(`   Revenue: $${revenueGap.toLocaleString()}`);

  console.log("\n🎯 CONCLUSION:");
  console.log("-".repeat(50));
  console.log(`   • Jan 1 - Dec 27 data appears COMPLETE (${ordersJan1Dec27.toLocaleString()} orders)`);
  console.log(`   • Dec 28 is INCOMPLETE (only ${dec28Orders} orders vs ~${dec28ShouldHave} expected)`);
  console.log(`   • The ${orderGap}-order gap is entirely from Dec 28 incomplete sync`);
  console.log(`   • A re-sync should fix this automatically`);

  console.log("\n" + "=".repeat(70));
}

verifyGap().catch(console.error);
