import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function findMismatches() {
  // Get all products
  const { data: products } = await supabase.from("products").select("sku");
  const productSkus = new Set((products || []).map(p => p.sku));
  const productSkusLower = new Map((products || []).map(p => [p.sku.toLowerCase(), p.sku]));

  // Get all unique SKUs from inventory_current
  const { data: inventory } = await supabase.from("inventory_current").select("sku");
  const inventorySkus = new Set((inventory || []).map(i => i.sku));

  console.log("SKUs in inventory_current but NOT in products (would show as accessory):");
  const mismatched: Array<{ invSku: string; correctSku: string | null }> = [];

  for (const invSku of inventorySkus) {
    if (!productSkus.has(invSku)) {
      // Check if there's a case-insensitive match
      const correctSku = productSkusLower.get(invSku.toLowerCase()) || null;
      mismatched.push({ invSku, correctSku });
    }
  }

  for (const { invSku, correctSku } of mismatched) {
    if (correctSku) {
      console.log(`  ${invSku} -> should be ${correctSku} (CASE MISMATCH)`);
    } else {
      console.log(`  ${invSku} (no product entry at all)`);
    }
  }

  console.log("");
  console.log("Total mismatched SKUs:", mismatched.length);

  // If there are case mismatches, we can fix them
  const caseMismatches = mismatched.filter(m => m.correctSku);
  if (caseMismatches.length > 0) {
    console.log("");
    console.log("Case mismatches that should be fixed in inventory_current:");
    for (const { invSku, correctSku } of caseMismatches) {
      console.log(`  UPDATE inventory_current SET sku = '${correctSku}' WHERE sku = '${invSku}';`);
    }
  }
}

findMismatches().catch(console.error);
