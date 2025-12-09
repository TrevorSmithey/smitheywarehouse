import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function check() {
  // Get products
  const { data: products } = await supabase.from("products").select("sku");
  const productSkusLower = new Map((products || []).map(p => [p.sku.toLowerCase(), p.sku]));

  // Get distinct SKUs from line_items that contain 'tradskil14'
  const { data: lineItems } = await supabase
    .from("line_items")
    .select("sku")
    .ilike("sku", "%tradskil14%");

  const uniqueSkus = new Set((lineItems || []).map(l => l.sku));

  console.log("TradSkil14 SKUs in line_items:");
  for (const sku of uniqueSkus) {
    const correctSku = productSkusLower.get(sku.toLowerCase());
    if (correctSku && correctSku !== sku) {
      console.log(`  ${sku} -> ${correctSku} (CASE MISMATCH)`);
    } else if (!correctSku) {
      console.log(`  ${sku} (NO PRODUCT)`);
    } else {
      console.log(`  ${sku} (OK)`);
    }
  }
}

check().catch(console.error);
