import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  ProductInventory,
  InventoryCategory,
  InventoryResponse,
  SkuSalesVelocity,
} from "@/lib/types";
import { calculateDOI, buildBudgetLookup } from "@/lib/doi";
import { WAREHOUSE_IDS } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const supabase = createServiceClient();

  try {
    const { searchParams } = new URL(request.url);
    const categoryFilter = searchParams.get("category") as InventoryCategory | null;

    // Get current year/month in EST for budget lookup
    const now = new Date();
    const estFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const estParts = estFormatter.formatToParts(now);
    const estYear = parseInt(estParts.find(p => p.type === "year")?.value || "2025");
    const estMonth = parseInt(estParts.find(p => p.type === "month")?.value || "1"); // 1-indexed for DB
    const estDay = parseInt(estParts.find(p => p.type === "day")?.value || "1");

    // Month boundaries in EST, converted to UTC for database queries
    const estMonth0 = estMonth - 1; // 0-indexed for Date constructor
    const monthStart = new Date(Date.UTC(estYear, estMonth0, 1, 5, 0, 0)).toISOString();
    const lastDayOfMonth = new Date(estYear, estMonth0 + 1, 0).getDate();
    const monthEnd = new Date(Date.UTC(estYear, estMonth0, lastDayOfMonth, 28, 59, 59)).toISOString();

    // Build EST date strings for velocity queries
    const todayEST = `${estYear}-${String(estMonth).padStart(2, '0')}-${String(estDay).padStart(2, '0')}`;
    const threeDaysAgo = new Date(estYear, estMonth - 1, estDay - 3);
    const threeDayStartEST = `${threeDaysAgo.getFullYear()}-${String(threeDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(threeDaysAgo.getDate()).padStart(2, '0')}`;
    const sixDaysAgo = new Date(estYear, estMonth - 1, estDay - 6);
    const sixDayStartEST = `${sixDaysAgo.getFullYear()}-${String(sixDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sixDaysAgo.getDate()).padStart(2, '0')}`;

    // Run ALL queries in parallel for performance
    const [
      currentMonthBudgetsResult,
      allBudgetsResult,
      inventoryResult,
      productsResult,
      monthlySalesResult,
      monthlyB2BResult,
      sales3DayResult,
      salesPrior3DayResult,
    ] = await Promise.all([
      // 1. Current month budgets
      supabase
        .from("budgets")
        .select("sku, budget")
        .eq("year", estYear)
        .eq("month", estMonth),

      // 2. All budgets for DOI
      supabase
        .from("budgets")
        .select("sku, year, month, budget"),

      // 3. Inventory
      supabase
        .from("inventory")
        .select("sku, warehouse_id, available, synced_at")
        .order("sku"),

      // 4. Products
      supabase
        .from("products")
        .select("sku, display_name, category")
        .eq("is_active", true),

      // 5. Monthly retail sales
      supabase
        .from("line_items")
        .select("sku, quantity, orders!inner(created_at, canceled)")
        .gte("orders.created_at", monthStart)
        .lte("orders.created_at", monthEnd)
        .eq("orders.canceled", false)
        .limit(2000000),

      // 6. Monthly B2B (filter out cancelled orders using soft-delete column)
      supabase
        .from("b2b_fulfilled")
        .select("sku, quantity")
        .gte("fulfilled_at", monthStart)
        .lte("fulfilled_at", monthEnd)
        .is("cancelled_at", null)
        .limit(1000000),

      // 7. 3-day sales
      supabase
        .from("line_items")
        .select("sku, quantity, orders!inner(created_at, canceled)")
        .gte("orders.created_at", threeDayStartEST)
        .lt("orders.created_at", todayEST)
        .eq("orders.canceled", false)
        .limit(1000000),

      // 8. Prior 3-day sales
      supabase
        .from("line_items")
        .select("sku, quantity, orders!inner(created_at, canceled)")
        .gte("orders.created_at", sixDayStartEST)
        .lt("orders.created_at", threeDayStartEST)
        .eq("orders.canceled", false)
        .limit(1000000),
    ]);

    // Extract data and check for errors
    const { data: currentMonthBudgets } = currentMonthBudgetsResult;
    const { data: allBudgets } = allBudgetsResult;
    const { data: inventoryData, error: inventoryError } = inventoryResult;
    const { data: productsData, error: productsError } = productsResult;
    const { data: monthlySalesData, error: monthlySalesError } = monthlySalesResult;
    const { data: monthlyB2BData, error: monthlyB2BError } = monthlyB2BResult;
    const { data: sales3DayData, error: sales3DayError } = sales3DayResult;
    const { data: salesPrior3DayData, error: salesPrior3DayError } = salesPrior3DayResult;

    if (inventoryError) throw new Error(`Failed to fetch inventory: ${inventoryError.message}`);
    if (productsError) throw new Error(`Failed to fetch products: ${productsError.message}`);
    if (monthlySalesError) throw new Error(`Failed to fetch monthly sales: ${monthlySalesError.message}`);
    if (monthlyB2BError) throw new Error(`Failed to fetch monthly B2B data: ${monthlyB2BError.message}`);
    if (sales3DayError) throw new Error(`Failed to fetch 3-day sales: ${sales3DayError.message}`);
    if (salesPrior3DayError) throw new Error(`Failed to fetch prior 3-day sales: ${salesPrior3DayError.message}`);

    // Data truncation warnings - log if we hit limit boundaries
    const MONTHLY_LIMIT = 2000000;
    const OTHER_LIMIT = 1000000;
    if (monthlySalesData && monthlySalesData.length >= MONTHLY_LIMIT) {
      console.error(`[INVENTORY API] WARNING: Monthly sales data truncated at ${MONTHLY_LIMIT} rows. Data may be incomplete.`);
    }
    if (monthlyB2BData && monthlyB2BData.length >= OTHER_LIMIT) {
      console.error(`[INVENTORY API] WARNING: Monthly B2B data truncated at ${OTHER_LIMIT} rows. Data may be incomplete.`);
    }
    if (sales3DayData && sales3DayData.length >= OTHER_LIMIT) {
      console.error(`[INVENTORY API] WARNING: 3-day sales data truncated at ${OTHER_LIMIT} rows. Data may be incomplete.`);
    }
    if (salesPrior3DayData && salesPrior3DayData.length >= OTHER_LIMIT) {
      console.error(`[INVENTORY API] WARNING: Prior 3-day sales data truncated at ${OTHER_LIMIT} rows. Data may be incomplete.`);
    }

    // Create current month budget lookup (for display)
    const budgetBySku = new Map<string, number>();
    for (const b of currentMonthBudgets || []) {
      budgetBySku.set(b.sku.toLowerCase(), b.budget);
    }

    // Build budget lookup for DOI calculation
    const budgetLookup = buildBudgetLookup(allBudgets || []);

    // Aggregate retail ordered quantity by SKU (case-insensitive)
    const retailSalesBySku = new Map<string, number>();
    for (const item of monthlySalesData || []) {
      if (item.sku) {
        const skuLower = item.sku.toLowerCase();
        const current = retailSalesBySku.get(skuLower) || 0;
        retailSalesBySku.set(skuLower, current + (item.quantity || 0));
      }
    }

    // Aggregate B2B fulfilled quantity by SKU (case-insensitive)
    const b2bSalesBySku = new Map<string, number>();
    for (const item of monthlyB2BData || []) {
      if (item.sku) {
        const skuLower = item.sku.toLowerCase();
        const current = b2bSalesBySku.get(skuLower) || 0;
        b2bSalesBySku.set(skuLower, current + (item.quantity || 0));
      }
    }

    // Combine retail + B2B for total monthly sold
    const monthlySalesBySku = new Map<string, number>();
    const allSkus = new Set([...retailSalesBySku.keys(), ...b2bSalesBySku.keys()]);
    for (const skuLower of allSkus) {
      const retail = retailSalesBySku.get(skuLower) || 0;
      const b2b = b2bSalesBySku.get(skuLower) || 0;
      monthlySalesBySku.set(skuLower, retail + b2b);
    }

    // Aggregate 3-day sales by SKU
    const sales3DayBySku = new Map<string, number>();
    for (const item of sales3DayData || []) {
      if (item.sku) {
        const skuLower = item.sku.toLowerCase();
        const current = sales3DayBySku.get(skuLower) || 0;
        sales3DayBySku.set(skuLower, current + (item.quantity || 0));
      }
    }

    // Aggregate prior 3-day sales by SKU
    const salesPrior3DayBySku = new Map<string, number>();
    for (const item of salesPrior3DayData || []) {
      if (item.sku) {
        const skuLower = item.sku.toLowerCase();
        const current = salesPrior3DayBySku.get(skuLower) || 0;
        salesPrior3DayBySku.set(skuLower, current + (item.quantity || 0));
      }
    }

    // Create product lookup map (lowercase keys for case-insensitive matching)
    const productMap = new Map(
      productsData?.map((p) => [p.sku.toLowerCase(), { displayName: p.display_name, category: p.category }]) || []
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

      // Use AVAILABLE (sellable inventory) not on_hand
      if (inv.warehouse_id === WAREHOUSE_IDS.pipefitter) {
        existing.pipefitter = inv.available;
      } else if (inv.warehouse_id === WAREHOUSE_IDS.hobson) {
        existing.hobson = inv.available;
      } else if (inv.warehouse_id === WAREHOUSE_IDS.selery) {
        existing.selery = inv.available;
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
      const product = productMap.get(sku.toLowerCase());
      const category = product?.category || "accessory";
      const displayName = product?.displayName || sku;

      // Apply category filter if provided
      if (categoryFilter && category !== categoryFilter) {
        continue;
      }

      const total = inv.pipefitter + inv.hobson + inv.selery;

      // Include products with any inventory (including negative/backordered)
      if (total !== 0) {
        // Calculate DOI using monthly budgets from database
        // Only calculate for positive inventory
        const doiResult = total > 0 ? calculateDOI(sku, total, budgetLookup) : undefined;

        // Get monthly metrics using budgets from Supabase
        const monthSold = monthlySalesBySku.get(sku.toLowerCase()) || 0;
        const monthBudget = budgetBySku.get(sku.toLowerCase());
        const monthPct = monthBudget && monthBudget > 0
          ? Math.round((monthSold / monthBudget) * 100)
          : undefined;

        inventory.push({
          sku,
          displayName,
          category: category as InventoryCategory,
          pipefitter: inv.pipefitter,
          hobson: inv.hobson,
          selery: inv.selery,
          total,
          doi: doiResult?.doi,
          stockoutWeek: doiResult?.stockoutWeek,
          stockoutYear: doiResult?.stockoutYear,
          isBackordered: total < 0,
          monthSold,
          monthBudget,
          monthPct,
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

    // Build sales velocity data for all SKUs (3-day moving average)
    const buildVelocity = (category: "cast_iron" | "carbon_steel" | "accessory" | "glass_lid"): SkuSalesVelocity[] => {
      const velocityList: SkuSalesVelocity[] = [];

      // Get all products for this category
      const categoryProducts = productsData?.filter(p => p.category === category) || [];

      for (const product of categoryProducts) {
        const skuLower = product.sku.toLowerCase();
        const sales3DayTotal = sales3DayBySku.get(skuLower) || 0;
        const prior3DayTotal = salesPrior3DayBySku.get(skuLower) || 0;
        const sales3DayAvg = Math.round(sales3DayTotal / 3); // Whole numbers
        const prior3DayAvg = Math.round(prior3DayTotal / 3);

        // Calculate delta percentage
        const delta = prior3DayAvg > 0
          ? Math.round(((sales3DayAvg - prior3DayAvg) / prior3DayAvg) * 100)
          : sales3DayAvg > 0 ? 100 : 0;

        velocityList.push({
          sku: product.sku,
          displayName: product.display_name,
          category: category,
          sales3DayTotal,
          sales3DayAvg,
          prior3DayAvg,
          delta,
        });
      }

      // Sort by daily velocity descending
      return velocityList.sort((a, b) => b.sales3DayAvg - a.sales3DayAvg);
    };

    const salesVelocity = {
      cast_iron: buildVelocity("cast_iron"),
      carbon_steel: buildVelocity("carbon_steel"),
      accessory: buildVelocity("accessory"),
      glass_lid: buildVelocity("glass_lid"),
    };

    const response: InventoryResponse = {
      inventory,
      totals,
      byCategory,
      salesVelocity,
      lastSynced,
    };

    // Add cache headers - inventory syncs every 15 min, cache for 60s
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
