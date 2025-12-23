import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function findCaseDuplicates() {
  console.log("=== FINDING CASE DUPLICATES IN PRODUCTS TABLE ===\n");

  // Get all products
  const { data: products, error } = await supabase
    .from("products")
    .select("id, sku, display_name, category")
    .order("sku");

  if (error) {
    console.error("Error fetching products:", error);
    return;
  }

  console.log(`Total products: ${products?.length || 0}\n`);

  // Group by lowercase SKU to find duplicates
  const skuGroups = new Map<string, Array<{ id: string; sku: string; display_name: string; category: string }>>();

  for (const product of products || []) {
    const lowerSku = product.sku?.toLowerCase() || "";
    if (!skuGroups.has(lowerSku)) {
      skuGroups.set(lowerSku, []);
    }
    skuGroups.get(lowerSku)!.push(product);
  }

  // Find groups with more than one entry (case duplicates)
  const duplicates: Array<{ lowerSku: string; variants: Array<{ id: string; sku: string; display_name: string; category: string }> }> = [];

  for (const [lowerSku, variants] of skuGroups) {
    if (variants.length > 1) {
      duplicates.push({ lowerSku, variants });
    }
  }

  if (duplicates.length === 0) {
    console.log("No case duplicates found!");
    return;
  }

  console.log(`Found ${duplicates.length} SKUs with case variations:\n`);

  for (const dup of duplicates) {
    console.log(`>>> ${dup.lowerSku.toUpperCase()}`);
    for (const v of dup.variants) {
      console.log(`    - "${v.sku}" (id: ${v.id})`);
      console.log(`      Name: ${v.display_name}`);
      console.log(`      Category: ${v.category}`);
    }
    console.log("");
  }

  // Also check for products where SKU doesn't follow consistent pattern
  console.log("\n=== CHECKING FOR NON-STANDARD SKU CASING ===\n");

  // Standard pattern: "Smith-XX-Xxxxx" (capital S in Smith, capitals after hyphens)
  const nonStandardSkus: Array<{ sku: string; issue: string }> = [];

  for (const product of products || []) {
    const sku = product.sku || "";

    // Check if starts with "Smith-" (capital S)
    if (sku.toLowerCase().startsWith("smith-") && !sku.startsWith("Smith-")) {
      nonStandardSkus.push({ sku, issue: "Should start with 'Smith-'" });
      continue;
    }

    // Check for lowercase letters after hyphens in SKU parts
    const parts = sku.split("-");
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.length > 0 && part[0] !== part[0].toUpperCase()) {
        // Exception for common patterns like "skil" which should be "Skil"
        nonStandardSkus.push({ sku, issue: `Part "${part}" should start with capital letter` });
        break;
      }
    }
  }

  if (nonStandardSkus.length > 0) {
    console.log(`Found ${nonStandardSkus.length} SKUs with non-standard casing:\n`);
    for (const item of nonStandardSkus.slice(0, 50)) {
      console.log(`  "${item.sku}" - ${item.issue}`);
    }
    if (nonStandardSkus.length > 50) {
      console.log(`  ... and ${nonStandardSkus.length - 50} more`);
    }
  } else {
    console.log("All SKUs follow standard casing pattern.");
  }
}

findCaseDuplicates().catch(console.error);
