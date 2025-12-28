/**
 * Check April days to understand the date offset issue
 *
 * Run with: npx tsx scripts/check-april-days.ts
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

async function checkApril() {
  console.log("\n" + "=".repeat(70));
  console.log("CHECKING APRIL DAYS");
  console.log("=".repeat(70) + "\n");

  // Check AST for April 8-15
  console.log("📊 annual_sales_tracking (Apr 8-15, 2025):");
  console.log("-".repeat(50));

  const { data: astApril } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("year", 2025)
    .eq("channel", "d2c")
    .gte("date", "2025-04-08")
    .lte("date", "2025-04-15")
    .order("date");

  console.log("Day | Date       | Orders | Revenue");
  console.log("-".repeat(50));
  for (const d of astApril || []) {
    console.log(`${d.day_of_year.toString().padStart(3)} | ${d.date} | ${d.orders.toString().padStart(6)} | $${parseFloat(d.revenue).toLocaleString()}`);
  }

  // Check daily_stats for April 8-15
  console.log("\n📊 daily_stats (Apr 8-15, 2025):");
  console.log("-".repeat(50));

  const { data: dsApril } = await supabase
    .from("daily_stats")
    .select("*")
    .gte("date", "2025-04-08")
    .lte("date", "2025-04-15")
    .order("date");

  console.log("Date       | Orders | Revenue");
  console.log("-".repeat(50));
  for (const d of dsApril || []) {
    console.log(`${d.date} | ${d.total_orders.toString().padStart(6)} | $${parseFloat(d.total_revenue).toLocaleString()}`);
  }

  // Check which dates are in DS but not in AST
  const astDates = new Set((astApril || []).map(d => d.date));
  const dsDates = new Set((dsApril || []).map(d => d.date));

  const missingInAst = [...dsDates].filter(d => !astDates.has(d));
  if (missingInAst.length > 0) {
    console.log("\n⚠️  Dates in daily_stats but MISSING from annual_sales_tracking:");
    for (const d of missingInAst) {
      const dsRow = dsApril?.find(r => r.date === d);
      console.log(`   ${d}: ${dsRow?.total_orders} orders, $${dsRow?.total_revenue}`);
    }
  }

  console.log("\n" + "=".repeat(70));
}

checkApril().catch(console.error);
