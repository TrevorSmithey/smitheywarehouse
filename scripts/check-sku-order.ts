import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  // Get all unique SKUs from budgets table for December 2025
  const { data: budgets } = await supabase
    .from("budgets")
    .select("sku, budget")
    .eq("year", 2025)
    .eq("month", 12)
    .order("budget", { ascending: false });

  // Get products with categories
  const { data: products } = await supabase
    .from("products")
    .select("sku, display_name, category")
    .eq("is_active", true);

  const productMap = new Map(
    products?.map((p) => [p.sku.toLowerCase(), p]) || []
  );

  // Group by category
  const byCategory: Record<string, Array<{ sku: string; display: string; budget: number }>> = {};
  for (const b of budgets || []) {
    const prod = productMap.get(b.sku.toLowerCase());
    const cat = prod?.category || "unknown";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({
      sku: b.sku,
      display: prod?.display_name || b.sku,
      budget: b.budget,
    });
  }

  console.log("=== CAST IRON (ordered by budget desc) ===");
  (byCategory.cast_iron || []).forEach((r, i) =>
    console.log(`${i + 1}. ${r.sku} -> "${r.display}" (${r.budget})`)
  );

  console.log("\n=== CARBON STEEL ===");
  (byCategory.carbon_steel || []).forEach((r, i) =>
    console.log(`${i + 1}. ${r.sku} -> "${r.display}" (${r.budget})`)
  );

  console.log("\n=== ACCESSORIES ===");
  (byCategory.accessory || []).forEach((r, i) =>
    console.log(`${i + 1}. ${r.sku} -> "${r.display}" (${r.budget})`)
  );

  console.log("\n=== GLASS LIDS ===");
  (byCategory.glass_lid || []).forEach((r, i) =>
    console.log(`${i + 1}. ${r.sku} -> "${r.display}" (${r.budget})`)
  );
}

check();
