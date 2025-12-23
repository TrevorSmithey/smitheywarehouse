import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
);

const VALID_CATEGORIES = [
  "Spam",
  "Product Inquiry",
  "Product Recommendation",
  "Ordering Inquiry",
  "Engraving Question",
  "Order Status",
  "Shipping Status",
  "Order Cancellation or Edit",
  "Cooking Advice",
  "Seasoning & Care",
  "Dutch Oven Issue",
  "Website Issue",
  "Quality Issue",
  "Glass Lid Issue",
  "Promotion or Sale Inquiry",
  "Factory Seconds Question",
  "Shipping Setup Issue",
  "Delivery Delay or Problem",
  "Return or Exchange",
  "Wholesale Request",
  "Metal Testing",
  "New Product Inquiry",
  "Positive Feedback",
  "Phone Call (No Context)",
  "Other",
];

async function normalize() {
  // 1. Fix 'Seasoning Issue' -> 'Seasoning & Care'
  const { data: seasoningFix, error: e1 } = await supabase
    .from("support_tickets")
    .update({ category: "Seasoning & Care" })
    .eq("category", "Seasoning Issue")
    .select("id");

  console.log("Seasoning Issue -> Seasoning & Care:", seasoningFix?.length || 0, "tickets");
  if (e1) console.error("Error:", e1);

  // 2. Get all remaining invalid categories
  const { data: allTickets } = await supabase
    .from("support_tickets")
    .select("id, category");

  const invalidTickets = allTickets?.filter((t) => !VALID_CATEGORIES.includes(t.category));

  const invalidCounts: Record<string, number> = {};
  invalidTickets?.forEach((t) => {
    invalidCounts[t.category] = (invalidCounts[t.category] || 0) + 1;
  });

  console.log("\nRemaining invalid categories:");
  Object.entries(invalidCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => console.log(`  ${cat}: ${count}`));

  console.log("\nTotal invalid:", invalidTickets?.length || 0);

  // 3. Map all invalid to "Other"
  if (invalidTickets && invalidTickets.length > 0) {
    const invalidIds = invalidTickets.map((t) => t.id);
    const { error: e2 } = await supabase
      .from("support_tickets")
      .update({ category: "Other" })
      .in("id", invalidIds);

    if (e2) {
      console.error("Error mapping to Other:", e2);
    } else {
      console.log(`\nMapped ${invalidIds.length} tickets to 'Other'`);
    }
  }

  // 4. Verify final counts
  const { data: finalCounts } = await supabase
    .from("support_tickets")
    .select("category");

  const categoryCounts: Record<string, number> = {};
  finalCounts?.forEach((t) => {
    categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
  });

  console.log("\n=== FINAL CATEGORY DISTRIBUTION ===");
  Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      const pct = ((count / (finalCounts?.length || 1)) * 100).toFixed(1);
      console.log(`  ${cat}: ${count} (${pct}%)`);
    });

  console.log("\nTotal categories:", Object.keys(categoryCounts).length);
  console.log("Total tickets:", finalCounts?.length);
}

normalize();
