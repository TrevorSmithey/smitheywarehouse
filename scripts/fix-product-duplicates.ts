import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// Canonical casing (capital S and K in "Skil")
const CANONICAL = ["Smith-CI-TradSkil14", "Smith-CI-TradSkil14-D"];
const NON_CANONICAL = ["Smith-CI-Tradskil14", "Smith-CI-Tradskil14-D"];

async function fixDuplicates() {
  console.log("Deleting non-canonical SKU duplicates from products table...\n");

  for (const sku of NON_CANONICAL) {
    console.log(`Deleting: ${sku}`);
    const { error, count } = await supabase
      .from("products")
      .delete()
      .eq("sku", sku);

    if (error) {
      console.log(`  ERROR: ${error.message}`);
    } else {
      console.log(`  Deleted ${count ?? "?"} row(s)`);
    }
  }

  console.log("\nVerifying remaining products with similar SKUs:");
  const { data } = await supabase
    .from("products")
    .select("sku, display_name")
    .ilike("sku", "smith-ci-tradskil14%");

  for (const p of data || []) {
    console.log(`  - ${p.sku} (${p.display_name})`);
  }

  console.log("\nDone. Now you can run the migration again.");
}

fixDuplicates().catch(console.error);
