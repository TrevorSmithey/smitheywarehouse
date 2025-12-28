/**
 * Check Nov 2 duplicate
 *
 * Run with: npx tsx scripts/check-nov2.ts
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

async function checkNov2() {
  console.log("\n" + "=".repeat(70));
  console.log("CHECKING NOV 2 DUPLICATE");
  console.log("=".repeat(70) + "\n");

  // Get all AST entries for Nov 2
  const { data: nov2Ast } = await supabase
    .from("annual_sales_tracking")
    .select("*")
    .eq("date", "2025-11-02");

  console.log("📊 All AST entries for 2025-11-02:");
  console.log(JSON.stringify(nov2Ast, null, 2));

  // Get DS entry for Nov 2
  const { data: nov2Ds } = await supabase
    .from("daily_stats")
    .select("*")
    .eq("date", "2025-11-02");

  console.log("\n📊 DS entry for 2025-11-02:");
  console.log(JSON.stringify(nov2Ds, null, 2));

  // Check day_of_year values around Nov 2
  console.log("\n📊 AST entries by day_of_year around 306:");
  const { data: dayOfYearEntries } = await supabase
    .from("annual_sales_tracking")
    .select("day_of_year, date, channel, orders, revenue")
    .eq("year", 2025)
    .gte("day_of_year", 304)
    .lte("day_of_year", 310)
    .order("day_of_year");

  for (const entry of dayOfYearEntries || []) {
    console.log(`   Day ${entry.day_of_year}: ${entry.date} (${entry.channel}) - ${entry.orders} orders, $${entry.revenue}`);
  }

  console.log("\n" + "=".repeat(70));
}

checkNov2().catch(console.error);
