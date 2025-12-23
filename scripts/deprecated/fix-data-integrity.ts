/**
 * Fix data integrity issues in Supabase
 * - Standardize SKU casing
 * - Add missing products
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function fix() {
  console.log("=== FIXING DATA INTEGRITY ISSUES ===\n");

  // 1. Delete duplicate wrong-cased products (correct case already exists)
  const wrongCasedSkus = [
    "Smith-CS-RroastM",    // Should be Smith-CS-RRoastM
    "Smith-CI-Tradskil14", // Should be Smith-CI-TradSkil14
  ];

  for (const sku of wrongCasedSkus) {
    // Delete from products table
    const { error: prodErr } = await supabase
      .from("products")
      .delete()
      .eq("sku", sku);

    // Delete from inventory table (if any)
    const { error: invErr } = await supabase
      .from("inventory")
      .delete()
      .eq("sku", sku);

    if (prodErr) {
      console.log(`❌ Failed to delete ${sku}: ${prodErr.message}`);
    } else {
      console.log(`✅ Deleted duplicate: ${sku}`);
    }
  }

  // 2. Add missing products
  const newProducts = [
    {
      sku: "Smith-CI-Sauce1",
      display_name: "Sauce Pan",
      category: "cast_iron",
      is_active: true
    },
    {
      sku: "Smith-AC-CSlid12",
      display_name: "CS 12 Lid",
      category: "glass_lid",
      is_active: true
    },
  ];

  for (const product of newProducts) {
    const { error } = await supabase
      .from("products")
      .upsert(product, { onConflict: "sku" });

    if (error) {
      console.log(`❌ Failed to add ${product.sku}: ${error.message}`);
    } else {
      console.log(`✅ Added product: ${product.sku} (${product.display_name})`);
    }
  }

  // 3. Verify fixes
  console.log("\n=== VERIFICATION ===");

  const { data: budgets } = await supabase.from("budgets").select("sku");
  const { data: products } = await supabase.from("products").select("sku, category").eq("is_active", true);

  const budgetSkus = new Set(budgets?.map(b => b.sku));
  const productSkus = new Set(products?.map(p => p.sku));

  const orphanBudgets = [...budgetSkus].filter(s => !productSkus.has(s));
  console.log(`Orphan budgets (SKUs with budget but no product): ${orphanBudgets.length}`);
  if (orphanBudgets.length > 0) {
    orphanBudgets.forEach(s => console.log(`  - ${s}`));
  }

  const productsWithoutBudgets = products?.filter(p =>
    p.category !== "factory_second" &&
    !budgetSkus.has(p.sku)
  );
  console.log(`\nProducts without budgets: ${productsWithoutBudgets?.length || 0}`);
  if (productsWithoutBudgets && productsWithoutBudgets.length > 0) {
    productsWithoutBudgets.forEach(p => console.log(`  - ${p.sku} (${p.category})`));
  }
}

fix().catch(console.error);
