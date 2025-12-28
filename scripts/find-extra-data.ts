/**
 * Find where the extra data in AST is coming from
 *
 * Run with: npx tsx scripts/find-extra-data.ts
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

async function findExtraData() {
  console.log("\n" + "=".repeat(70));
  console.log("FINDING EXTRA DATA");
  console.log("=".repeat(70) + "\n");

  // Get all AST dates
  const { data: astData } = await supabase
    .from("annual_sales_tracking")
    .select("date, orders, revenue")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .order("date");

  // Get all DS dates
  const { data: dsData } = await supabase
    .from("daily_stats")
    .select("date, total_orders, total_revenue")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-31")
    .order("date");

  const astDates = new Set(astData?.map(d => d.date) || []);
  const dsDates = new Set(dsData?.map(d => d.date) || []);

  // Dates in AST but not in DS
  const extraInAst = [...astDates].filter(d => !dsDates.has(d));
  console.log(`📊 Dates in AST but NOT in DS: ${extraInAst.length}`);
  for (const d of extraInAst) {
    const row = astData?.find(r => r.date === d);
    console.log(`   ${d}: ${row?.orders} orders, $${row?.revenue}`);
  }

  // Dates in DS but not in AST
  const extraInDs = [...dsDates].filter(d => !astDates.has(d));
  console.log(`\n📊 Dates in DS but NOT in AST: ${extraInDs.length}`);
  for (const d of extraInDs) {
    const row = dsData?.find(r => r.date === d);
    console.log(`   ${d}: ${row?.total_orders} orders, $${row?.total_revenue}`);
  }

  // Check for Dec 29+ data
  console.log("\n📊 Checking for Dec 29+ data in AST:");
  const { data: dec29Plus } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .gt("date", "2025-12-28");

  if (dec29Plus && dec29Plus.length > 0) {
    for (const d of dec29Plus) {
      console.log(`   ${d.date}: ${d.orders} orders, $${d.revenue}`);
    }
  } else {
    console.log("   None found");
  }

  // Check Jan 1+ data in both (before Jan 1)
  console.log("\n📊 Checking for 2024 data in AST 2025:");
  const { data: pre2025Ast } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .lt("date", "2025-01-01");

  if (pre2025Ast && pre2025Ast.length > 0) {
    for (const d of pre2025Ast) {
      console.log(`   ${d.date}: ${d.orders} orders, $${d.revenue}`);
    }
  } else {
    console.log("   None found");
  }

  // Sum AST for JUST 2025 dates (Jan 1 - Dec 28)
  const { data: astFiltered } = await supabase
    .from("annual_sales_tracking")
    .select("date, orders, revenue")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .gte("date", "2025-01-01")
    .lte("date", "2025-12-28");

  const astSum = astFiltered?.reduce((sum, d) => sum + (d.orders || 0), 0) || 0;
  const astRevSum = astFiltered?.reduce((sum, d) => sum + (parseFloat(d.revenue) || 0), 0) || 0;

  console.log("\n📊 AST sum for 2025 Jan 1 - Dec 28:");
  console.log(`   Days: ${astFiltered?.length}`);
  console.log(`   Orders: ${astSum.toLocaleString()}`);
  console.log(`   Revenue: $${astRevSum.toLocaleString()}`);

  // Check for duplicate entries
  console.log("\n📊 Checking for duplicates in AST:");
  const dateCount = new Map<string, number>();
  for (const d of astData || []) {
    dateCount.set(d.date, (dateCount.get(d.date) || 0) + 1);
  }

  const duplicates = [...dateCount.entries()].filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    console.log(`   Found ${duplicates.length} duplicate dates!`);
    for (const [date, count] of duplicates) {
      console.log(`   ${date}: ${count} entries`);
    }
  } else {
    console.log("   No duplicates found");
  }

  console.log("\n" + "=".repeat(70));
}

findExtraData().catch(console.error);
