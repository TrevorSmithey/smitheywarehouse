/**
 * Investigate the discrepancy between daily_stats and Shopify Analytics
 *
 * Run with: npx tsx scripts/investigate-discrepancy.ts
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

async function investigate() {
  console.log("\n" + "=".repeat(70));
  console.log("INVESTIGATING DISCREPANCY");
  console.log("=".repeat(70) + "\n");

  // =========================================================================
  // 1. Check ALL annual_sales_tracking records
  // =========================================================================
  console.log("📊 1. All annual_sales_tracking records:");
  console.log("-".repeat(50));

  const { data: allAst } = await supabase
    .from("annual_sales_tracking")
    .select("*");

  if (allAst && allAst.length > 0) {
    for (const r of allAst) {
      console.log(`  Year: ${r.year}, Channel: ${r.channel}`);
      console.log(`    Orders: ${r.ytd_orders}, Revenue: $${r.ytd_revenue}`);
      console.log(`    Updated: ${r.updated_at}`);
    }
  } else {
    console.log("  ⚠️  No records found in annual_sales_tracking!");
  }

  // =========================================================================
  // 2. Check Dec 28 and Dec 29 specifically
  // =========================================================================
  console.log("\n📊 2. Dec 28-29 daily_stats check:");
  console.log("-".repeat(50));

  const { data: dec28_29 } = await supabase
    .from("daily_stats")
    .select("*")
    .gte("date", "2025-12-28")
    .lte("date", "2025-12-29");

  for (const d of dec28_29 || []) {
    console.log(`  ${d.date}:`);
    console.log(`    Orders: ${d.total_orders}`);
    console.log(`    Revenue: $${parseFloat(d.total_revenue).toLocaleString()}`);
  }

  // =========================================================================
  // 3. What do we need to add to match Shopify?
  // =========================================================================
  console.log("\n📊 3. What's missing to match Shopify Analytics?");
  console.log("-".repeat(50));

  const TARGET_ORDERS = 96533;
  const TARGET_REVENUE = 30637801.19;

  // Sum daily_stats Jan 1 - Dec 28
  const { data: dsAll } = await supabase
    .from("daily_stats")
    .select("total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  const currentOrders = dsAll?.reduce((sum, d) => sum + (d.total_orders || 0), 0) || 0;
  const currentRevenue = dsAll?.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0) || 0;

  const missingOrders = TARGET_ORDERS - currentOrders;
  const missingRevenue = TARGET_REVENUE - currentRevenue;

  console.log(`  Current (daily_stats): ${currentOrders.toLocaleString()} orders, $${currentRevenue.toLocaleString()}`);
  console.log(`  Target (Shopify):      ${TARGET_ORDERS.toLocaleString()} orders, $${TARGET_REVENUE.toLocaleString()}`);
  console.log(`  Missing:               ${missingOrders} orders, $${missingRevenue.toFixed(2)}`);

  // =========================================================================
  // 4. Check Dec 28 in orders table directly
  // =========================================================================
  console.log("\n📊 4. Orders table Dec 28 data (EST boundaries):");
  console.log("-".repeat(50));

  // Dec 28 EST = Dec 28 05:00 UTC to Dec 29 05:00 UTC
  const { data: dec28Orders } = await supabase
    .from("orders")
    .select("total_price, canceled")
    .gte("created_at", "2025-12-28T05:00:00Z")
    .lt("created_at", "2025-12-29T05:00:00Z")
    .eq("canceled", false)
    .not("total_price", "is", null);

  const dec28Count = dec28Orders?.length || 0;
  const dec28Revenue = dec28Orders?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0;

  console.log(`  Dec 28 from orders table:`);
  console.log(`    Orders: ${dec28Count}`);
  console.log(`    Revenue: $${dec28Revenue.toLocaleString()}`);

  // =========================================================================
  // 5. Check last sync log
  // =========================================================================
  console.log("\n📊 5. Recent sync logs:");
  console.log("-".repeat(50));

  const { data: syncLogs } = await supabase
    .from("sync_logs")
    .select("*")
    .ilike("source", "%shopify%")
    .order("completed_at", { ascending: false })
    .limit(5);

  for (const log of syncLogs || []) {
    console.log(`  ${log.source}: ${log.status}`);
    console.log(`    Started: ${log.started_at}`);
    console.log(`    Completed: ${log.completed_at}`);
    if (log.records_processed) {
      console.log(`    Records: ${log.records_processed}`);
    }
    console.log("");
  }

  console.log("=".repeat(70));
  console.log("INVESTIGATION COMPLETE");
  console.log("=".repeat(70) + "\n");
}

investigate().catch(console.error);
