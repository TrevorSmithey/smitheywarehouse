import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function findDuplicates() {
  const { data: products } = await supabase
    .from("products")
    .select("sku, display_name, category");

  const byLower = new Map<string, Array<{ sku: string; display_name: string; category: string }>>();
  for (const p of products || []) {
    const lower = p.sku.toLowerCase();
    const existing = byLower.get(lower) || [];
    existing.push(p);
    byLower.set(lower, existing);
  }

  const dups = [...byLower.entries()].filter(([, items]) => items.length > 1);

  if (dups.length === 0) {
    console.log("No case-duplicates found in products table");
  } else {
    console.log("Case-duplicates in products table:\n");
    for (const [lower, items] of dups) {
      console.log(`  ${lower}:`);
      for (const item of items) {
        console.log(`    - ${item.sku} (${item.display_name})`);
      }
    }
  }
}

findDuplicates().catch(console.error);
