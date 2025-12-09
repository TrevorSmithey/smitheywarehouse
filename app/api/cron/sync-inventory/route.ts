import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchAllProducts,
  transformToInventory,
  getDisplayName,
  categorizeProduct,
} from "@/lib/shiphero";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max for Vercel

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Warehouse IDs
const WAREHOUSE_IDS = {
  pipefitter: 120758,
  hobson: 77373,
  selery: 93742,
};

export async function GET(request: Request) {
  try {
    // Verify cron secret (Vercel sends this header for cron jobs)
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    // In production, verify the cron secret
    if (process.env.NODE_ENV === "production" && cronSecret) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    console.log("Starting inventory sync from ShipHero...");
    const startTime = Date.now();

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

    const inventoryRecords: InventoryRecord[] = [];
    const now = new Date().toISOString();

    for (const item of inventory) {
      // Include non-zero values (negative = backordered)
      if (item.pipefitter !== 0) {
        inventoryRecords.push({
          sku: item.sku,
          warehouse_id: WAREHOUSE_IDS.pipefitter,
          on_hand: item.pipefitter,
          available: item.pipefitter,
          reserved: 0,
          synced_at: now,
        });
      }
      if (item.hobson !== 0) {
        inventoryRecords.push({
          sku: item.sku,
          warehouse_id: WAREHOUSE_IDS.hobson,
          on_hand: item.hobson,
          available: item.hobson,
          reserved: 0,
          synced_at: now,
        });
      }
      if (item.selery !== 0) {
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
    const BATCH_SIZE = 500;
    let upserted = 0;

    for (let i = 0; i < inventoryRecords.length; i += BATCH_SIZE) {
      const batch = inventoryRecords.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("inventory")
        .upsert(batch, { onConflict: "sku,warehouse_id" });

      if (error) {
        console.error(`Batch upsert error:`, error);
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

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Calculate totals for response
    const totals = {
      pipefitter: inventory.reduce((sum, i) => sum + i.pipefitter, 0),
      hobson: inventory.reduce((sum, i) => sum + i.hobson, 0),
      selery: inventory.reduce((sum, i) => sum + i.selery, 0),
    };

    return NextResponse.json({
      success: true,
      elapsed: `${elapsed}s`,
      productsFound: products.length,
      productsWithInventory: inventory.length,
      recordsUpserted: upserted,
      totals: {
        ...totals,
        total: totals.pipefitter + totals.hobson + totals.selery,
      },
    });
  } catch (error) {
    console.error("Inventory sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 }
    );
  }
}
