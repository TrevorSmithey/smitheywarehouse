import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function fixInventoryDuplicates() {
  console.log("Finding case-duplicates in inventory table...\n");

  // Fetch all inventory records
  const { data: inventory } = await supabase
    .from("inventory")
    .select("id, sku, warehouse_id, available, on_hand, synced_at");

  if (!inventory) {
    console.log("No inventory data found");
    return;
  }

  // Group by lowercase SKU + warehouse
  const byKey = new Map<string, typeof inventory>();
  for (const row of inventory) {
    const key = `${row.sku.toLowerCase()}|${row.warehouse_id}`;
    const existing = byKey.get(key) || [];
    existing.push(row);
    byKey.set(key, existing);
  }

  // Find duplicates
  const dups = [...byKey.entries()].filter(([, rows]) => rows.length > 1);

  if (dups.length === 0) {
    console.log("No case-duplicates found in inventory table");
    return;
  }

  console.log(`Found ${dups.length} duplicate groups:\n`);

  for (const [key, rows] of dups) {
    console.log(`Key: ${key}`);
    for (const row of rows) {
      console.log(`  - id=${row.id}, sku=${row.sku}, available=${row.available}`);
    }

    // Keep the one with canonical casing (capital letters in SKU)
    // or the most recently synced one
    const sorted = rows.sort((a, b) => {
      // Prefer canonical casing (has more uppercase)
      const aUpper = (a.sku.match(/[A-Z]/g) || []).length;
      const bUpper = (b.sku.match(/[A-Z]/g) || []).length;
      if (aUpper !== bUpper) return bUpper - aUpper;
      // Otherwise prefer most recent
      return new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime();
    });

    const keep = sorted[0];
    const deleteRows = sorted.slice(1);

    console.log(`  Keeping: ${keep.sku} (id=${keep.id})`);

    // Sum the available quantities
    const totalAvailable = rows.reduce((sum, r) => sum + (r.available || 0), 0);
    const totalOnHand = rows.reduce((sum, r) => sum + (r.on_hand || 0), 0);

    // Delete duplicates
    for (const row of deleteRows) {
      console.log(`  Deleting: ${row.sku} (id=${row.id})`);
      const { error } = await supabase.from("inventory").delete().eq("id", row.id);
      if (error) console.log(`    ERROR: ${error.message}`);
    }

    // Update the kept row with correct totals if needed
    if (keep.available !== totalAvailable || keep.on_hand !== totalOnHand) {
      console.log(`  Updating totals: available=${totalAvailable}, on_hand=${totalOnHand}`);
      const { error } = await supabase
        .from("inventory")
        .update({ available: totalAvailable, on_hand: totalOnHand })
        .eq("id", keep.id);
      if (error) console.log(`    ERROR: ${error.message}`);
    }

    console.log("");
  }

  console.log("Done. Now you can run the migration again.");
}

fixInventoryDuplicates().catch(console.error);
