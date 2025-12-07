import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type {
  ProductInventory,
  InventoryCategory,
  InventoryResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    const { searchParams } = new URL(request.url);
    const categoryFilter = searchParams.get("category") as InventoryCategory | null;

    // Fetch inventory with product details
    // Using a raw query to pivot warehouse data into columns
    const { data: inventoryData, error: inventoryError } = await supabase
      .from("inventory")
      .select(`
        sku,
        warehouse_id,
        on_hand,
        synced_at
      `)
      .order("sku");

    if (inventoryError) {
      throw new Error(`Failed to fetch inventory: ${inventoryError.message}`);
    }

    // Fetch products for display names and categories
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("sku, display_name, category")
      .eq("is_active", true);

    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`);
    }

    // Create product lookup map
    const productMap = new Map(
      productsData?.map((p) => [p.sku, { displayName: p.display_name, category: p.category }]) || []
    );

    // Group inventory by SKU and pivot warehouses
    const skuInventory = new Map<string, {
      pipefitter: number;
      hobson: number;
      selery: number;
      syncedAt: string | null;
    }>();

    for (const inv of inventoryData || []) {
      const existing = skuInventory.get(inv.sku) || {
        pipefitter: 0,
        hobson: 0,
        selery: 0,
        syncedAt: null,
      };

      if (inv.warehouse_id === WAREHOUSE_IDS.pipefitter) {
        existing.pipefitter = inv.on_hand;
      } else if (inv.warehouse_id === WAREHOUSE_IDS.hobson) {
        existing.hobson = inv.on_hand;
      } else if (inv.warehouse_id === WAREHOUSE_IDS.selery) {
        existing.selery = inv.on_hand;
      }

      // Track most recent sync time
      if (!existing.syncedAt || inv.synced_at > existing.syncedAt) {
        existing.syncedAt = inv.synced_at;
      }

      skuInventory.set(inv.sku, existing);
    }

    // Build product inventory list
    const inventory: ProductInventory[] = [];
    let lastSynced: string | null = null;

    for (const [sku, inv] of skuInventory) {
      const product = productMap.get(sku);
      const category = product?.category || "accessory";
      const displayName = product?.displayName || sku;

      // Apply category filter if provided
      if (categoryFilter && category !== categoryFilter) {
        continue;
      }

      const total = inv.pipefitter + inv.hobson + inv.selery;

      // Only include products with inventory
      if (total > 0) {
        inventory.push({
          sku,
          displayName,
          category: category as InventoryCategory,
          pipefitter: inv.pipefitter,
          hobson: inv.hobson,
          selery: inv.selery,
          total,
        });
      }

      // Track overall last sync time
      if (inv.syncedAt && (!lastSynced || inv.syncedAt > lastSynced)) {
        lastSynced = inv.syncedAt;
      }
    }

    // Sort by total descending
    inventory.sort((a, b) => b.total - a.total);

    // Calculate totals
    const totals = inventory.reduce(
      (acc, item) => ({
        pipefitter: acc.pipefitter + item.pipefitter,
        hobson: acc.hobson + item.hobson,
        selery: acc.selery + item.selery,
        total: acc.total + item.total,
      }),
      { pipefitter: 0, hobson: 0, selery: 0, total: 0 }
    );

    // Group by category
    const byCategory: Record<InventoryCategory, ProductInventory[]> = {
      cast_iron: [],
      carbon_steel: [],
      accessory: [],
      glass_lid: [],
      factory_second: [],
    };

    for (const item of inventory) {
      byCategory[item.category].push(item);
    }

    const response: InventoryResponse = {
      inventory,
      totals,
      byCategory,
      lastSynced,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
