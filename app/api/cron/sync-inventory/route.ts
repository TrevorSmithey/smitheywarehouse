import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchAllProducts,
  transformToInventory,
  getDisplayName,
  categorizeProduct,
  getCanonicalSku,
} from "@/lib/shiphero";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { WAREHOUSE_IDS, BATCH_SIZES } from "@/lib/constants";

const LOCK_NAME = "sync-inventory";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes - must be literal for Next.js static analysis

export async function GET(request: Request) {
  // Always verify cron secret - no exceptions
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[INVENTORY] Skipping sync - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  try {
    console.log("Starting inventory sync from ShipHero...");

    // 1. Fetch all products from ShipHero
    const products = await fetchAllProducts();
    console.log(`Found ${products.length} products in ShipHero`);

    // 2. Transform to inventory by warehouse
    const inventory = transformToInventory(products);
    console.log(`${inventory.length} products have inventory`);

    // 3. Prepare inventory records
    interface InventoryRecord {
      sku: string;
      warehouse_id: number;
      on_hand: number;
      available: number;
      reserved: number;
      synced_at: string;
    }

    let inventoryRecords: InventoryRecord[] = [];
    const now = new Date().toISOString();

    for (const item of inventory) {
      // Always sync all warehouses - even 0 values (sold out but not backordered)
      // This ensures we update items that go from backordered to sold out
      inventoryRecords.push({
        sku: item.sku,
        warehouse_id: WAREHOUSE_IDS.pipefitter,
        on_hand: item.pipefitter,
        available: item.pipefitter,
        reserved: 0,
        synced_at: now,
      });

      inventoryRecords.push({
        sku: item.sku,
        warehouse_id: WAREHOUSE_IDS.hobson,
        on_hand: item.hobson,
        available: item.hobson,
        reserved: 0,
        synced_at: now,
      });

      inventoryRecords.push({
        sku: item.sku,
        warehouse_id: WAREHOUSE_IDS.selery,
        on_hand: item.selery,
        available: item.selery,
        reserved: 0,
        synced_at: now,
      });
    }

    // 3a. Filter to only SKUs in nomenclature and normalize to canonical casing
    // This is CRITICAL - prevents silent failures due to case mismatches with unique index
    const unknownSkus = [...new Set(inventoryRecords.map((r) => r.sku))]
      .filter((sku) => getCanonicalSku(sku) === null);

    if (unknownSkus.length > 0) {
      console.log(`Skipping ${unknownSkus.length} SKUs not in nomenclature`);
    }

    // Filter and normalize SKUs to canonical casing
    inventoryRecords = inventoryRecords
      .filter((r) => getCanonicalSku(r.sku) !== null)
      .map((r) => ({
        ...r,
        sku: getCanonicalSku(r.sku)!, // Normalize to canonical casing
      }));

    // 4. Ensure products exist in products table
    const uniqueSkus = [...new Set(inventoryRecords.map((r) => r.sku))];

    const { data: existingProducts } = await supabase
      .from("products")
      .select("sku")
      .in("sku", uniqueSkus);

    // Use lowercase keys for case-insensitive matching
    // This prevents duplicate products if ShipHero returns different casing
    const existingSkus = new Set(
      existingProducts?.map((p) => p.sku.toLowerCase()) || []
    );
    const newSkus = uniqueSkus.filter(
      (sku) => !existingSkus.has(sku.toLowerCase())
    );

    if (newSkus.length > 0) {
      const newProducts = newSkus.map((sku) => ({
        sku,
        display_name: getDisplayName(sku),
        category: categorizeProduct(sku),
        is_active: true,
      }));

      await supabase.from("products").upsert(newProducts, { onConflict: "sku" });
      console.log(`Created ${newSkus.length} new products`);
    }

    // 5. Upsert inventory records in batches
    let upserted = 0;
    const batchErrors: string[] = [];
    const recordsExpected = inventoryRecords.length;

    for (let i = 0; i < inventoryRecords.length; i += BATCH_SIZES.DEFAULT) {
      const batch = inventoryRecords.slice(i, i + BATCH_SIZES.DEFAULT);
      const { error } = await supabase
        .from("inventory")
        .upsert(batch, { onConflict: "sku,warehouse_id" });

      if (error) {
        console.error(`Batch ${i / BATCH_SIZES.DEFAULT + 1} upsert error:`, error);
        batchErrors.push(`Batch ${i / BATCH_SIZES.DEFAULT + 1}: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    // 6. Save daily snapshot (once per day)
    const today = new Date().toISOString().split("T")[0];
    const { data: existingSnapshot } = await supabase
      .from("inventory_history")
      .select("id")
      .eq("snapshot_date", today)
      .limit(1);

    if (!existingSnapshot?.length) {
      const historyRecords = inventoryRecords.map((r) => ({
        sku: r.sku,
        warehouse_id: r.warehouse_id,
        on_hand: r.on_hand,
        snapshot_date: today,
      }));

      await supabase
        .from("inventory_history")
        .upsert(historyRecords, { onConflict: "sku,warehouse_id,snapshot_date" });

      console.log(`Created daily snapshot with ${historyRecords.length} records`);
    }

    const elapsed = Date.now() - startTime;
    const elapsedSec = (elapsed / 1000).toFixed(1);

    // Calculate totals for response
    const totals = {
      pipefitter: inventory.reduce((sum, i) => sum + i.pipefitter, 0),
      hobson: inventory.reduce((sum, i) => sum + i.hobson, 0),
      selery: inventory.reduce((sum, i) => sum + i.selery, 0),
    };

    // Determine sync status
    const syncStatus = batchErrors.length > 0
      ? (upserted === 0 ? "failed" : "partial")
      : "success";

    // 7. Log sync result to sync_logs table
    await supabase.from("sync_logs").insert({
      sync_type: "inventory",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: syncStatus,
      records_expected: recordsExpected,
      records_synced: upserted,
      error_message: batchErrors.length > 0 ? batchErrors.join("; ") : null,
      details: {
        productsInShipHero: products.length,
        productsWithInventory: inventory.length,
        skusSkipped: unknownSkus.length,
        totals,
      },
      duration_ms: elapsed,
    });

    // Return appropriate status based on sync result
    if (syncStatus === "failed" || syncStatus === "partial") {
      // Send email alert for failed OR partial syncs
      await sendSyncFailureAlert({
        syncType: "Inventory",
        error: syncStatus === "partial"
          ? `Partial sync: ${upserted}/${recordsExpected} records. Errors: ${batchErrors.join("; ")}`
          : batchErrors.join("; "),
        recordsExpected: recordsExpected,
        recordsSynced: upserted,
        timestamp: new Date().toISOString(),
      });

      if (syncStatus === "failed") {
        return NextResponse.json({
          success: false,
          status: "failed",
          elapsed: `${elapsedSec}s`,
          recordsExpected: recordsExpected,
          recordsUpserted: 0,
          error: batchErrors.join("; "),
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: syncStatus === "success",
      status: syncStatus,
      elapsed: `${elapsedSec}s`,
      productsFound: products.length,
      productsWithInventory: inventory.length,
      recordsExpected: recordsExpected,
      recordsUpserted: upserted,
      skusSkipped: unknownSkus.length,
      totals: {
        ...totals,
        total: totals.pipefitter + totals.hobson + totals.selery,
      },
      ...(batchErrors.length > 0 && { warnings: batchErrors }),
    });
  } catch (error) {
    console.error("Inventory sync failed:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Send email alert
    await sendSyncFailureAlert({
      syncType: "Inventory",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Log failure to sync_logs (wrapped in try-catch to not fail if logging fails)
    const elapsed = Date.now() - startTime;
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "inventory",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      // Don't fail the main operation if logging fails, but do log it
      console.error("[INVENTORY SYNC] Failed to log sync failure to sync_logs:", logError);
    }

    return NextResponse.json(
      {
        success: false,
        status: "failed",
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 }
    );
  } finally {
    // Always release the lock
    await releaseCronLock(supabase, LOCK_NAME);
  }
}
