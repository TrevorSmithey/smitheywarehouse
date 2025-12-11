import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
);

async function analyze() {
  const { data: tickets, error } = await supabase
    .from("support_tickets")
    .select("category, sentiment, summary, created_at");

  if (error) {
    console.error("Error:", error);
    return;
  }

  // Count by category
  const categoryCount: Record<string, number> = {};
  const sentimentCount: Record<string, number> = {};

  tickets?.forEach(t => {
    categoryCount[t.category] = (categoryCount[t.category] || 0) + 1;
    sentimentCount[t.sentiment] = (sentimentCount[t.sentiment] || 0) + 1;
  });

  const sortedCategories = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);

  console.log("TOTAL TICKETS:", tickets?.length);
  console.log("\n=== CATEGORY DISTRIBUTION ===");
  sortedCategories.forEach(([cat, count]) => {
    const pct = ((count / (tickets?.length || 1)) * 100).toFixed(1);
    console.log(`  ${cat}: ${count} (${pct}%)`);
  });

  console.log("\n=== SENTIMENT DISTRIBUTION ===");
  Object.entries(sentimentCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sent, count]) => {
      const pct = ((count / (tickets?.length || 1)) * 100).toFixed(1);
      console.log(`  ${sent}: ${count} (${pct}%)`);
    });

  // Sample some "Other" tickets
  const otherTickets = tickets?.filter(t => t.category === "Other").slice(0, 10);
  if (otherTickets && otherTickets.length > 0) {
    console.log("\n=== SAMPLE 'OTHER' TICKETS ===");
    otherTickets.forEach(t => {
      const summary = t.summary || "";
      console.log(`  - ${summary.substring(0, 100)}...`);
    });
  }

  // Sample "Phone Call (No Context)" to check quality
  const phoneCalls = tickets?.filter(t => t.category === "Phone Call (No Context)").slice(0, 5);
  if (phoneCalls && phoneCalls.length > 0) {
    console.log("\n=== SAMPLE 'PHONE CALL (NO CONTEXT)' ===");
    phoneCalls.forEach(t => {
      const summary = t.summary || "";
      console.log(`  - ${summary.substring(0, 100)}...`);
    });
  }

  // Date range
  if (tickets && tickets.length > 0) {
    const dates = tickets.map(t => new Date(t.created_at).getTime());
    console.log("\n=== DATE RANGE ===");
    console.log(`  Oldest: ${new Date(Math.min(...dates)).toISOString().split("T")[0]}`);
    console.log(`  Newest: ${new Date(Math.max(...dates)).toISOString().split("T")[0]}`);
  }
}

analyze();
