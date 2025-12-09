import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// Canonical SKU casing (from products table)
const CANONICAL_SKUS: Record<string, string> = {
  "smith-ci-tradskil14": "Smith-CI-TradSkil14",
  "smith-ci-dutch5": "Smith-CI-Dutch5",
  "smith-cs-wokm": "Smith-CS-WokM",
};

async function fixSkuCasing() {
  console.log("=== FIXING SKU CASING IN DATABASE ===\n");

  // 1. Fix inventory table - merge duplicate TradSkil14 rows
  console.log("1. INVENTORY TABLE - TradSkil14 duplicates:");
  const { data: invDups } = await supabase
    .from("inventory")
    .select("*")
    .ilike("sku", "smith-ci-tradskil14");

  console.log(`   Found ${invDups?.length || 0} rows`);
  for (const row of invDups || []) {
    console.log(`   - ${row.sku} (warehouse: ${row.warehouse_id}, available: ${row.available})`);
  }

  // Group by warehouse to find true duplicates
  const byWarehouse = new Map<number, typeof invDups>();
  for (const row of invDups || []) {
    const wh = row.warehouse_id;
    const existing = byWarehouse.get(wh);
    if (existing) {
      existing.push(row);
    } else {
      byWarehouse.set(wh, [row]);
    }
  }

  // For each warehouse with multiple entries, keep the canonical one
  for (const [warehouse, rows] of byWarehouse.entries()) {
    if (rows.length > 1) {
      console.log(`\n   Warehouse ${warehouse} has ${rows.length} entries - merging...`);

      // Find canonical and non-canonical
      const canonical = rows.find(r => r.sku === "Smith-CI-TradSkil14");
      const nonCanonical = rows.filter(r => r.sku !== "Smith-CI-TradSkil14");

      if (canonical && nonCanonical.length > 0) {
        // Sum available quantities
        const totalAvailable = rows.reduce((sum, r) => sum + (r.available || 0), 0);
        console.log(`   Total available: ${totalAvailable}`);

        // Delete non-canonical entries
        for (const row of nonCanonical) {
          console.log(`   Deleting: ${row.sku} (warehouse ${row.warehouse_id})`);
          const { error } = await supabase
            .from("inventory")
            .delete()
            .eq("sku", row.sku)
            .eq("warehouse_id", row.warehouse_id);
          if (error) console.log(`   ERROR: ${error.message}`);
        }

        // Update canonical with correct total (if different)
        if (canonical.available !== totalAvailable) {
          console.log(`   Updating canonical to available=${totalAvailable}`);
          const { error } = await supabase
            .from("inventory")
            .update({ available: totalAvailable, on_hand: totalAvailable })
            .eq("sku", canonical.sku)
            .eq("warehouse_id", canonical.warehouse_id);
          if (error) console.log(`   ERROR: ${error.message}`);
        }
      } else if (!canonical) {
        // No canonical exists, update first one to canonical
        const first = rows[0];
        console.log(`   No canonical found, updating ${first.sku} to Smith-CI-TradSkil14`);
        const { error } = await supabase
          .from("inventory")
          .update({ sku: "Smith-CI-TradSkil14" })
          .eq("sku", first.sku)
          .eq("warehouse_id", first.warehouse_id);
        if (error) console.log(`   ERROR: ${error.message}`);

        // Delete the rest
        for (const row of rows.slice(1)) {
          console.log(`   Deleting: ${row.sku}`);
          const { error } = await supabase
            .from("inventory")
            .delete()
            .eq("sku", row.sku)
            .eq("warehouse_id", row.warehouse_id);
          if (error) console.log(`   ERROR: ${error.message}`);
        }
      }
    } else if (rows.length === 1 && rows[0].sku !== "Smith-CI-TradSkil14") {
      // Single entry with wrong casing
      console.log(`\n   Warehouse ${warehouse} has wrong casing: ${rows[0].sku}`);
      const { error } = await supabase
        .from("inventory")
        .update({ sku: "Smith-CI-TradSkil14" })
        .eq("sku", rows[0].sku)
        .eq("warehouse_id", rows[0].warehouse_id);
      if (error) console.log(`   ERROR: ${error.message}`);
      else console.log(`   Updated to Smith-CI-TradSkil14`);
    }
  }

  // 2. Fix b2b_fulfilled table
  console.log("\n2. B2B_FULFILLED TABLE:");

  // Fix Dutch5
  const { data: dutch5Rows, error: d5err } = await supabase
    .from("b2b_fulfilled")
    .select("id, sku")
    .ilike("sku", "smith-ci-dutch5")
    .neq("sku", "Smith-CI-Dutch5");

  console.log(`   Dutch5 wrong casing: ${dutch5Rows?.length || 0} rows`);
  if (dutch5Rows && dutch5Rows.length > 0) {
    for (const row of dutch5Rows) {
      console.log(`   - Fixing: ${row.sku} -> Smith-CI-Dutch5`);
    }
    const { error } = await supabase
      .from("b2b_fulfilled")
      .update({ sku: "Smith-CI-Dutch5" })
      .ilike("sku", "smith-ci-dutch5")
      .neq("sku", "Smith-CI-Dutch5");
    if (error) console.log(`   ERROR: ${error.message}`);
    else console.log(`   Fixed ${dutch5Rows.length} Dutch5 rows`);
  }

  // Fix WokM
  const { data: wokRows } = await supabase
    .from("b2b_fulfilled")
    .select("id, sku")
    .ilike("sku", "smith-cs-wokm")
    .neq("sku", "Smith-CS-WokM");

  console.log(`   WokM wrong casing: ${wokRows?.length || 0} rows`);
  if (wokRows && wokRows.length > 0) {
    for (const row of wokRows) {
      console.log(`   - Fixing: ${row.sku} -> Smith-CS-WokM`);
    }
    const { error } = await supabase
      .from("b2b_fulfilled")
      .update({ sku: "Smith-CS-WokM" })
      .ilike("sku", "smith-cs-wokm")
      .neq("sku", "Smith-CS-WokM");
    if (error) console.log(`   ERROR: ${error.message}`);
    else console.log(`   Fixed ${wokRows.length} WokM rows`);
  }

  console.log("\n=== DONE ===");
  console.log("Run audit-sku-casing.ts again to verify.");
}

fixSkuCasing().catch(console.error);
