/**
 * Audit MTD tickets - compare Supabase vs Re:amaze
 */

import { createClient } from "@supabase/supabase-js";
import { createReamazeClient } from "../lib/reamaze";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  console.log("=".repeat(60));
  console.log("MTD Ticket Audit");
  console.log("=".repeat(60));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get MTD start date
  const now = new Date();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  console.log(`\nMTD Range: ${mtdStart.toISOString().split("T")[0]} to ${now.toISOString().split("T")[0]}`);

  // Get tickets from Supabase
  console.log("\n--- SUPABASE ---");
  const { data: supabaseTickets, count } = await supabase
    .from("support_tickets")
    .select("created_at, reamaze_id", { count: "exact" })
    .gte("created_at", mtdStart.toISOString())
    .order("created_at", { ascending: false });

  console.log(`Total MTD tickets in Supabase: ${count}`);

  // Group by date
  const byDate = new Map<string, number>();
  for (const t of supabaseTickets || []) {
    const date = t.created_at.split("T")[0];
    byDate.set(date, (byDate.get(date) || 0) + 1);
  }

  console.log("\nBy date:");
  const sorted = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  for (const [date, cnt] of sorted) {
    console.log(`  ${date}: ${cnt}`);
  }

  // Check Re:amaze
  console.log("\n--- RE:AMAZE ---");
  try {
    const reamaze = createReamazeClient();

    // Fetch page 1 to get total count
    const response = await reamaze.getConversations({
      filter: "all",
      startDate: mtdStart.toISOString(),
      endDate: now.toISOString(),
      page: 1,
    });

    console.log(`Total MTD conversations in Re:amaze: ${response.total_count}`);
    console.log(`Page count: ${response.page_count}`);
    console.log(`Page size: ${response.page_size}`);

    // Compare
    console.log("\n--- COMPARISON ---");
    const supabaseCount = count || 0;
    const reamazeCount = response.total_count;
    const diff = reamazeCount - supabaseCount;

    if (diff > 0) {
      console.log(`⚠️  MISSING ${diff} tickets in Supabase`);
      console.log(`   Re:amaze has ${reamazeCount}, Supabase has ${supabaseCount}`);
    } else if (diff < 0) {
      console.log(`ℹ️  Supabase has ${Math.abs(diff)} more tickets than Re:amaze`);
      console.log(`   (Could be from Excel import or duplicates)`);
    } else {
      console.log(`✅ Counts match: ${supabaseCount} tickets`);
    }

    // Show recent from Re:amaze
    console.log("\n--- RECENT RE:AMAZE CONVERSATIONS ---");
    for (const conv of response.conversations.slice(0, 5)) {
      console.log(`  ${conv.created_at.split("T")[0]} | ${conv.slug} | ${conv.subject?.substring(0, 50) || "(no subject)"}`);
    }

  } catch (err) {
    console.error("Re:amaze error:", err);
  }
}

main().catch(console.error);
