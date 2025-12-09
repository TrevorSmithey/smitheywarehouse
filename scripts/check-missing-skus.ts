import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function check() {
  // Check which of these SKUs have budgets
  const testSkus = [
    'egift100', 'egift50', 'smith-eng', 'smith-eng2',
    'smith-rest-smithey', 'smith-cook-stand'
  ];

  console.log("Checking if missing SKUs have budgets...\n");

  for (const sku of testSkus) {
    const { data: budget } = await supabase
      .from("budgets")
      .select("sku, budget")
      .ilike("sku", sku)
      .limit(5);

    const { data: product } = await supabase
      .from("products")
      .select("sku, is_active, category")
      .ilike("sku", sku)
      .limit(1);

    console.log(`${sku}:`);
    console.log(`  Budget entries: ${budget?.length || 0}`);
    console.log(`  Product exists: ${product?.length ? 'Yes' : 'No'} (active: ${product?.[0]?.is_active}, cat: ${product?.[0]?.category})`);
  }
}

check().catch(console.error);
