/**
 * Check if MTD tickets were properly classified by Claude
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function check() {
  // Check for tickets with failed classification (fallback values)
  const { data: failed } = await supabase
    .from("support_tickets")
    .select("id, reamaze_id, category, sentiment, summary, created_at")
    .or("summary.ilike.%Classification failed%,summary.ilike.%error%")
    .order("created_at", { ascending: false })
    .limit(20);

  console.log("=== Tickets with failed classification ===");
  console.log("Count:", failed?.length || 0);
  if (failed && failed.length > 0) {
    failed.forEach((t) =>
      console.log(`  ${t.reamaze_id}: ${t.summary?.substring(0, 60)}...`)
    );
  }

  // Check for tickets with category='Other' and sentiment='Neutral' (possible fallback)
  const { count } = await supabase
    .from("support_tickets")
    .select("*", { count: "exact", head: true })
    .eq("category", "Other")
    .eq("sentiment", "Neutral")
    .gte("created_at", "2025-12-01");

  console.log("\n=== MTD tickets with Other/Neutral (possible fallback) ===");
  console.log("Count:", count);

  // Get overall MTD distribution
  const { data: mtd } = await supabase
    .from("support_tickets")
    .select("category, sentiment")
    .gte("created_at", "2025-12-01");

  const cats: Record<string, number> = {};
  const sents: Record<string, number> = {};
  mtd?.forEach((t) => {
    cats[t.category] = (cats[t.category] || 0) + 1;
    sents[t.sentiment] = (sents[t.sentiment] || 0) + 1;
  });

  console.log("\n=== MTD Category Distribution ===");
  Object.entries(cats)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log("\n=== MTD Sentiment Distribution ===");
  Object.entries(sents)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log("\n=== Total MTD tickets ===");
  console.log("Count:", mtd?.length || 0);
}

check();
