import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function audit() {
  console.log("=== SKU CASE AUDIT ===\n");

  // 1. Check products table for case duplicates
  const { data: products } = await supabase.from("products").select("sku, display_name, category");
  const productSkuGroups = new Map<string, string[]>();
  for (const p of products || []) {
    const lower = p.sku.toLowerCase();
    const existing = productSkuGroups.get(lower);
    if (existing) {
      existing.push(p.sku);
    } else {
      productSkuGroups.set(lower, [p.sku]);
    }
  }
  const productDups = [...productSkuGroups.entries()].filter(([, skus]) => skus.length > 1);
  console.log("PRODUCTS TABLE:");
  console.log(`  Total: ${products?.length}`);
  console.log(`  Case duplicates: ${productDups.length}`);
  if (productDups.length > 0) {
    for (const [lower, skus] of productDups) {
      console.log(`    ${lower}: ${JSON.stringify(skus)}`);
    }
  }

  // 2. Check budgets table for case duplicates
  const { data: budgets } = await supabase.from("budgets").select("sku").limit(10000);
  const budgetSkus = new Set((budgets || []).map(b => b.sku));
  const budgetSkuGroups = new Map<string, string[]>();
  for (const sku of budgetSkus) {
    const lower = sku.toLowerCase();
    const existing = budgetSkuGroups.get(lower);
    if (existing) {
      existing.push(sku);
    } else {
      budgetSkuGroups.set(lower, [sku]);
    }
  }
  const budgetDups = [...budgetSkuGroups.entries()].filter(([, skus]) => skus.length > 1);
  console.log("\nBUDGETS TABLE:");
  console.log(`  Unique SKUs: ${budgetSkus.size}`);
  console.log(`  Case duplicates: ${budgetDups.length}`);
  if (budgetDups.length > 0) {
    for (const [lower, skus] of budgetDups) {
      console.log(`    ${lower}: ${JSON.stringify(skus)}`);
    }
  }

  // 3. Check inventory table for case duplicates
  const { data: inventory } = await supabase.from("inventory").select("sku").limit(10000);
  const invSkus = new Set((inventory || []).map(i => i.sku));
  const invSkuGroups = new Map<string, string[]>();
  for (const sku of invSkus) {
    const lower = sku.toLowerCase();
    const existing = invSkuGroups.get(lower);
    if (existing) {
      existing.push(sku);
    } else {
      invSkuGroups.set(lower, [sku]);
    }
  }
  const invDups = [...invSkuGroups.entries()].filter(([, skus]) => skus.length > 1);
  console.log("\nINVENTORY TABLE:");
  console.log(`  Unique SKUs: ${invSkus.size}`);
  console.log(`  Case duplicates: ${invDups.length}`);
  if (invDups.length > 0) {
    for (const [lower, skus] of invDups) {
      console.log(`    ${lower}: ${JSON.stringify(skus)}`);
    }
  }

  // 4. Check line_items table for case variations
  const { data: lineItems } = await supabase.from("line_items").select("sku").limit(100000);
  const lineSkus = new Set((lineItems || []).map(l => l.sku).filter(Boolean));
  const lineSkuGroups = new Map<string, string[]>();
  for (const sku of lineSkus) {
    const lower = sku.toLowerCase();
    const existing = lineSkuGroups.get(lower);
    if (existing) {
      if (!existing.includes(sku)) {
        existing.push(sku);
      }
    } else {
      lineSkuGroups.set(lower, [sku]);
    }
  }
  const lineDups = [...lineSkuGroups.entries()].filter(([, skus]) => skus.length > 1);
  console.log("\nLINE_ITEMS TABLE:");
  console.log(`  Unique SKUs: ${lineSkus.size}`);
  console.log(`  Case variations: ${lineDups.length}`);
  if (lineDups.length > 0) {
    for (const [lower, skus] of lineDups.slice(0, 20)) {
      console.log(`    ${lower}: ${JSON.stringify(skus)}`);
    }
    if (lineDups.length > 20) console.log(`    ... and ${lineDups.length - 20} more`);
  }

  // 5. Cross-table mismatches: SKUs in line_items not in products (case-insensitive)
  const productSkusLower = new Set([...productSkuGroups.keys()]);
  const missingFromProducts: string[] = [];
  for (const sku of lineSkus) {
    if (!productSkusLower.has(sku.toLowerCase())) {
      missingFromProducts.push(sku);
    }
  }
  console.log("\nCROSS-TABLE ISSUES:");
  console.log(`  Line item SKUs not in products table: ${missingFromProducts.length}`);
  if (missingFromProducts.length > 0) {
    for (const sku of missingFromProducts.slice(0, 20)) {
      console.log(`    ${sku}`);
    }
    if (missingFromProducts.length > 20) {
      console.log(`    ... and ${missingFromProducts.length - 20} more`);
    }
  }

  // 6. Check b2b_fulfilled table
  const { data: b2b } = await supabase.from("b2b_fulfilled").select("sku").limit(50000);
  const b2bSkus = new Set((b2b || []).map(b => b.sku).filter(Boolean));
  const b2bSkuGroups = new Map<string, string[]>();
  for (const sku of b2bSkus) {
    const lower = sku.toLowerCase();
    const existing = b2bSkuGroups.get(lower);
    if (existing) {
      if (!existing.includes(sku)) {
        existing.push(sku);
      }
    } else {
      b2bSkuGroups.set(lower, [sku]);
    }
  }
  const b2bDups = [...b2bSkuGroups.entries()].filter(([, skus]) => skus.length > 1);
  console.log("\nB2B_FULFILLED TABLE:");
  console.log(`  Unique SKUs: ${b2bSkus.size}`);
  console.log(`  Case variations: ${b2bDups.length}`);
  if (b2bDups.length > 0) {
    for (const [lower, skus] of b2bDups.slice(0, 20)) {
      console.log(`    ${lower}: ${JSON.stringify(skus)}`);
    }
  }

  // 7. Summary recommendation
  console.log("\n=== RECOMMENDATION ===");
  const totalDups = productDups.length + budgetDups.length + invDups.length + lineDups.length + b2bDups.length;
  if (totalDups === 0) {
    console.log("Database is clean - no case duplicates found.");
    console.log("The API-level toLowerCase() handling should be sufficient.");
  } else {
    console.log(`Found ${totalDups} case inconsistencies across tables.`);
    console.log("Consider:");
    console.log("  1. Adding CITEXT extension to PostgreSQL for case-insensitive columns");
    console.log("  2. Creating a database trigger to normalize SKUs on insert/update");
    console.log("  3. Running a one-time cleanup to standardize existing data");
  }
}

audit().catch(console.error);
