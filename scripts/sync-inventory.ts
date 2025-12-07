/**
 * Sync Inventory Script
 *
 * Fetches inventory from ShipHero and syncs to Supabase.
 * Run with: npx tsx scripts/sync-inventory.ts
 *
 * Requires environment variables:
 * - SHIPHERO_API_TOKEN
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  fetchAllProducts,
  transformToInventory,
  WAREHOUSES,
  getDisplayName,
  categorizeProduct,
} from "../lib/shiphero";

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Warehouse IDs for inventory records
const WAREHOUSE_IDS = {
  pipefitter: 120758,
  hobson: 77373,
  selery: 93742,
};

interface InventoryRecord {
  sku: string;
  warehouse_id: number;
  on_hand: number;
  available: number;
  reserved: number;
  synced_at: string;
}

async function syncInventory() {
  console.log("Starting inventory sync from ShipHero...\n");

  const startTime = Date.now();

  // 1. Fetch all products from ShipHero
  console.log("Fetching products from ShipHero...");
  const products = await fetchAllProducts();
  console.log(`Found ${products.length} products in ShipHero\n`);

  // 2. Transform to inventory by warehouse
  const inventory = transformToInventory(products);
  console.log(`${inventory.length} products have inventory across warehouses\n`);

  // 3. Prepare inventory records for each warehouse
  const inventoryRecords: InventoryRecord[] = [];
  const now = new Date().toISOString();

  for (const item of inventory) {
    // Pipefitter
    if (item.pipefitter > 0) {
      inventoryRecords.push({
        sku: item.sku,
        warehouse_id: WAREHOUSE_IDS.pipefitter,
        on_hand: item.pipefitter,
        available: item.pipefitter,
        reserved: 0,
        synced_at: now,
      });
    }

    // Hobson
    if (item.hobson > 0) {
      inventoryRecords.push({
        sku: item.sku,
        warehouse_id: WAREHOUSE_IDS.hobson,
        on_hand: item.hobson,
        available: item.hobson,
        reserved: 0,
        synced_at: now,
      });
    }

    // Selery
    if (item.selery > 0) {
      inventoryRecords.push({
        sku: item.sku,
        warehouse_id: WAREHOUSE_IDS.selery,
        on_hand: item.selery,
        available: item.selery,
        reserved: 0,
        synced_at: now,
      });
    }
  }

  console.log(`Prepared ${inventoryRecords.length} inventory records\n`);

  // 4. Ensure products exist in products table (auto-create if missing)
  const uniqueSkus = [...new Set(inventoryRecords.map((r) => r.sku))];
  console.log(`Ensuring ${uniqueSkus.length} SKUs exist in products table...`);

  // Get existing products
  const { data: existingProducts } = await supabase
    .from("products")
    .select("sku")
    .in("sku", uniqueSkus);

  const existingSkus = new Set(existingProducts?.map((p) => p.sku) || []);
  const newSkus = uniqueSkus.filter((sku) => !existingSkus.has(sku));

  if (newSkus.length > 0) {
    console.log(`Creating ${newSkus.length} new product records...`);
    const newProducts = newSkus.map((sku) => ({
      sku,
      display_name: getDisplayName(sku),
      category: categorizeProduct(sku),
      is_active: true,
    }));

    const { error: productError } = await supabase
      .from("products")
      .upsert(newProducts, { onConflict: "sku" });

    if (productError) {
      console.error("Error creating products:", productError);
    } else {
      console.log(`Created ${newSkus.length} new products`);
    }
  }

  // 5. Clear existing inventory and insert fresh data
  // Using upsert with conflict on (sku, warehouse_id)
  console.log("\nUpserting inventory records...");

  // Process in batches to avoid hitting Supabase limits
  const BATCH_SIZE = 500;
  let upserted = 0;

  for (let i = 0; i < inventoryRecords.length; i += BATCH_SIZE) {
    const batch = inventoryRecords.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("inventory")
      .upsert(batch, { onConflict: "sku,warehouse_id" });

    if (error) {
      console.error(`Error upserting batch ${i / BATCH_SIZE + 1}:`, error);
    } else {
      upserted += batch.length;
    }
  }

  console.log(`Upserted ${upserted} inventory records`);

  // 6. Save daily snapshot to inventory_history (once per day)
  const today = new Date().toISOString().split("T")[0];
  console.log(`\nChecking if daily snapshot exists for ${today}...`);

  const { data: existingSnapshot } = await supabase
    .from("inventory_history")
    .select("id")
    .eq("snapshot_date", today)
    .limit(1);

  if (!existingSnapshot?.length) {
    console.log("Creating daily inventory snapshot...");

    const historyRecords = inventoryRecords.map((r) => ({
      sku: r.sku,
      warehouse_id: r.warehouse_id,
      on_hand: r.on_hand,
      snapshot_date: today,
    }));

    const { error: historyError } = await supabase
      .from("inventory_history")
      .upsert(historyRecords, { onConflict: "sku,warehouse_id,snapshot_date" });

    if (historyError) {
      console.error("Error creating history snapshot:", historyError);
    } else {
      console.log(`Created ${historyRecords.length} history records`);
    }
  } else {
    console.log("Daily snapshot already exists, skipping");
  }

  // 7. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n========================================");
  console.log("SYNC COMPLETE");
  console.log("========================================");
  console.log(`Time: ${elapsed}s`);
  console.log(`Products in ShipHero: ${products.length}`);
  console.log(`Products with inventory: ${inventory.length}`);
  console.log(`Inventory records upserted: ${upserted}`);

  // Summary by warehouse
  const warehouseTotals = {
    pipefitter: inventory.reduce((sum, i) => sum + i.pipefitter, 0),
    hobson: inventory.reduce((sum, i) => sum + i.hobson, 0),
    selery: inventory.reduce((sum, i) => sum + i.selery, 0),
  };

  console.log("\nBy warehouse:");
  console.log(`  Pipefitter: ${warehouseTotals.pipefitter.toLocaleString()}`);
  console.log(`  Hobson: ${warehouseTotals.hobson.toLocaleString()}`);
  console.log(`  Selery: ${warehouseTotals.selery.toLocaleString()}`);
  console.log(
    `  Total: ${(warehouseTotals.pipefitter + warehouseTotals.hobson + warehouseTotals.selery).toLocaleString()}`
  );
}

syncInventory().catch((error) => {
  console.error("Sync failed:", error);
  process.exit(1);
});
