/**
 * Cleanup script to remove SKUs not in official nomenclature
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { SKU_DISPLAY_NAMES } from "../lib/shiphero";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function cleanup() {
  const knownSkus = Object.keys(SKU_DISPLAY_NAMES);
  console.log(`Known SKUs in nomenclature: ${knownSkus.length}`);

  // Get all products in database
  const { data: products, error: fetchError } = await supabase
    .from("products")
    .select("sku");

  if (fetchError) {
    console.error("Error fetching products:", fetchError);
    return;
  }

  // Find bad SKUs (case-insensitive check)
  const knownSkusLower = knownSkus.map((s) => s.toLowerCase());
  const badSkus = products
    .filter((p) => !knownSkusLower.includes(p.sku.toLowerCase()))
    .map((p) => p.sku);

  console.log(`\nBad SKUs to delete: ${badSkus.length}`);
  badSkus.forEach((s) => console.log(`  - ${s}`));

  if (badSkus.length === 0) {
    console.log("\nNo cleanup needed!");
    return;
  }

  // Delete inventory for bad SKUs
  console.log("\nDeleting inventory records...");
  const { error: invErr } = await supabase
    .from("inventory")
    .delete()
    .in("sku", badSkus);

  if (invErr) {
    console.error("Error deleting inventory:", invErr);
  } else {
    console.log("Inventory deleted OK");
  }

  // Delete products for bad SKUs
  console.log("Deleting product records...");
  const { error: prodErr } = await supabase
    .from("products")
    .delete()
    .in("sku", badSkus);

  if (prodErr) {
    console.error("Error deleting products:", prodErr);
  } else {
    console.log("Products deleted OK");
  }

  console.log("\nCleanup complete!");
}

cleanup().catch(console.error);
