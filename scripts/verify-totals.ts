/**
 * Verify totals and understand the discrepancy
 *
 * Run with: npx tsx scripts/verify-totals.ts
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

async function verifyTotals() {
  console.log("\n" + "=".repeat(70));
  console.log("VERIFYING TOTALS");
  console.log("=".repeat(70) + "\n");

  const TARGET_ORDERS = 96533;
  const TARGET_REVENUE = 30637801.19;

  // Get annual_sales_tracking totals for 2025 d2c (Jan 1 - Dec 28)
  const { data: ast } = await supabase
    .from("annual_sales_tracking")
    .select("date, orders, revenue")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  const astOrders = ast?.reduce((sum, d) => sum + (d.orders || 0), 0) || 0;
  const astRevenue = ast?.reduce((sum, d) => sum + (parseFloat(d.revenue) || 0), 0) || 0;

  console.log("📊 annual_sales_tracking (2025 d2c, Jan 1 - Dec 28):");
  console.log(`   Days: ${ast?.length || 0}`);
  console.log(`   Orders: ${astOrders.toLocaleString()}`);
  console.log(`   Revenue: $${astRevenue.toLocaleString()}`);
  console.log(`   vs Target: ${astOrders - TARGET_ORDERS >= 0 ? '+' : ''}${astOrders - TARGET_ORDERS} orders, ${astRevenue - TARGET_REVENUE >= 0 ? '+' : ''}$${(astRevenue - TARGET_REVENUE).toFixed(2)}`);

  // Get daily_stats totals (Jan 1 - Dec 28)
  const { data: ds } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  const dsOrders = ds?.reduce((sum, d) => sum + (d.total_orders || 0), 0) || 0;
  const dsRevenue = ds?.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0) || 0;

  console.log("\n📊 daily_stats (Jan 1 - Dec 28):");
  console.log(`   Days: ${ds?.length || 0}`);
  console.log(`   Orders: ${dsOrders.toLocaleString()}`);
  console.log(`   Revenue: $${dsRevenue.toLocaleString()}`);
  console.log(`   vs Target: ${dsOrders - TARGET_ORDERS >= 0 ? '+' : ''}${dsOrders - TARGET_ORDERS} orders, ${dsRevenue - TARGET_REVENUE >= 0 ? '+' : ''}$${(dsRevenue - TARGET_REVENUE).toFixed(2)}`);

  // Difference between tables
  console.log("\n📊 Difference (AST - DS):");
  console.log(`   Orders: ${astOrders - dsOrders >= 0 ? '+' : ''}${astOrders - dsOrders}`);
  console.log(`   Revenue: ${astRevenue - dsRevenue >= 0 ? '+' : ''}$${(astRevenue - dsRevenue).toFixed(2)}`);

  // Check Apr 10 specifically
  console.log("\n📊 April 10 check:");
  const { data: apr10Ast } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("date", "2025-04-10")
    .eq("channel", "d2c");

  const { data: apr10Ds } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-04-10");

  console.log(`   AST Apr 10:`, apr10Ast?.[0] || "NOT FOUND");
  console.log(`   DS Apr 10:`, apr10Ds?.[0] || "NOT FOUND");

  // The REAL question: which one should we trust?
  console.log("\n" + "-".repeat(70));
  console.log("📊 RECOMMENDATION:");
  console.log("-".repeat(70));

  // Find which is closer to Shopify
  const astDiff = Math.abs(astOrders - TARGET_ORDERS) + Math.abs(astRevenue - TARGET_REVENUE);
  const dsDiff = Math.abs(dsOrders - TARGET_ORDERS) + Math.abs(dsRevenue - TARGET_REVENUE);

  if (astDiff < dsDiff) {
    console.log("   annual_sales_tracking is CLOSER to Shopify Analytics");
    console.log(`   AST distance: ${Math.abs(astOrders - TARGET_ORDERS)} orders + $${Math.abs(astRevenue - TARGET_REVENUE).toFixed(2)}`);
    console.log(`   DS distance: ${Math.abs(dsOrders - TARGET_ORDERS)} orders + $${Math.abs(dsRevenue - TARGET_REVENUE).toFixed(2)}`);
  } else {
    console.log("   daily_stats is CLOSER to Shopify Analytics");
    console.log(`   DS distance: ${Math.abs(dsOrders - TARGET_ORDERS)} orders + $${Math.abs(dsRevenue - TARGET_REVENUE).toFixed(2)}`);
    console.log(`   AST distance: ${Math.abs(astOrders - TARGET_ORDERS)} orders + $${Math.abs(astRevenue - TARGET_REVENUE).toFixed(2)}`);
  }

  console.log("\n" + "=".repeat(70));
}

verifyTotals().catch(console.error);
