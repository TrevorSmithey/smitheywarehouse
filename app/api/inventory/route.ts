import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";
import type {
  ProductInventory,
  InventoryCategory,
  InventoryResponse,
  SkuSalesVelocity,
  B2BDraftOrderSku,
} from "@/lib/types";
import { calculateDOI, buildWeeklyWeightsLookup, buildAnnualBudgetLookup } from "@/lib/doi";
import { WAREHOUSE_IDS, QUERY_LIMITS, checkQueryLimit } from "@/lib/constants";
import { checkRateLimit, rateLimitedResponse, addRateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`inventory:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

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
      weeklyWeightsResult,
      inventoryResult,
      productsResult,
      monthlySalesResult,
      monthlyB2BResult,
      sales3DayResult,
      salesPrior3DayResult,
      draftOrdersResult,
    ] = await Promise.all([
      // 1. Current month budgets (use 'total' channel for combined demand)
      supabase
        .from("budgets")
        .select("sku, budget")
        .eq("year", estYear)
        .eq("month", estMonth)
        .eq("channel", "total"),

      // 2. All budgets for DOI (use 'total' channel for combined retail+wholesale demand)
      supabase
        .from("budgets")
        .select("sku, year, month, budget")
        .eq("channel", "total"),

      // 3. Weekly weights for DOI (seasonal demand distribution)
      supabase
        .from("weekly_weights")
        .select("week, weight")
        .order("week"),

      // 4. Inventory
      supabase
        .from("inventory")
        .select("sku, warehouse_id, available, synced_at")
        .order("sku"),

      // 5. Products
      supabase
        .from("products")
        .select("sku, display_name, category")
        .eq("is_active", true),

      // 6. Monthly retail sales (using efficient RPC that filters orders first)
      supabase.rpc("get_sku_sales_by_date_range", {
        p_start_date: monthStart,
        p_end_date: monthEnd,
        p_include_cancelled: false,
      }),

      // 7. Monthly B2B (filter out cancelled orders using soft-delete column)
      supabase
        .from("b2b_fulfilled")
        .select("sku, quantity")
        .gte("fulfilled_at", monthStart)
        .lte("fulfilled_at", monthEnd)
        .is("cancelled_at", null)
        .limit(QUERY_LIMITS.INVENTORY_B2B_SALES),

      // 8. 3-day sales (using efficient RPC - end date is yesterday 23:59:59 UTC)
      supabase.rpc("get_sku_sales_by_date_range", {
        p_start_date: `${threeDayStartEST}T05:00:00Z`, // EST midnight in UTC
        p_end_date: new Date(Date.UTC(estYear, estMonth - 1, estDay, 4, 59, 59)).toISOString(), // Just before midnight EST today
        p_include_cancelled: false,
      }),

      // 9. Prior 3-day sales (using efficient RPC)
      supabase.rpc("get_sku_sales_by_date_range", {
        p_start_date: `${sixDayStartEST}T05:00:00Z`, // EST midnight in UTC
        p_end_date: `${threeDayStartEST}T04:59:59Z`, // Just before EST midnight 3 days ago
        p_include_cancelled: false,
      }),

      // 10. B2B Draft Orders (open draft orders from Shopify B2B)
      supabase
        .from("b2b_draft_orders")
        .select("sku, quantity, price, draft_order_id"),
    ]);

    // Extract data and check for errors
    const { data: currentMonthBudgets } = currentMonthBudgetsResult;
    const { data: allBudgets } = allBudgetsResult;
    const { data: weeklyWeightsData, error: weeklyWeightsError } = weeklyWeightsResult;
    const { data: inventoryData, error: inventoryError } = inventoryResult;
    const { data: productsData, error: productsError } = productsResult;
    const { data: monthlySalesData, error: monthlySalesError } = monthlySalesResult;
    const { data: monthlyB2BData, error: monthlyB2BError } = monthlyB2BResult;
    const { data: sales3DayData, error: sales3DayError } = sales3DayResult;
    const { data: salesPrior3DayData, error: salesPrior3DayError } = salesPrior3DayResult;
    const { data: draftOrdersData, error: draftOrdersError } = draftOrdersResult;

    if (inventoryError) throw new Error(`Failed to fetch inventory: ${inventoryError.message}`);
    if (productsError) throw new Error(`Failed to fetch products: ${productsError.message}`);
    // Weekly weights: gracefully handle missing table (migration may not have run yet)
    if (weeklyWeightsError) {
      if (weeklyWeightsError.message.includes("does not exist")) {
        console.warn("Weekly weights table does not exist yet (migration pending) - DOI will return N/A");
      } else {
        throw new Error(`Failed to fetch weekly weights: ${weeklyWeightsError.message}`);
      }
    }
    if (monthlySalesError) throw new Error(`Failed to fetch monthly sales: ${monthlySalesError.message}`);
    if (monthlyB2BError) throw new Error(`Failed to fetch monthly B2B data: ${monthlyB2BError.message}`);
    if (sales3DayError) throw new Error(`Failed to fetch 3-day sales: ${sales3DayError.message}`);
    if (salesPrior3DayError) throw new Error(`Failed to fetch prior 3-day sales: ${salesPrior3DayError.message}`);
    // Draft orders: gracefully handle missing table, but throw on real errors
    if (draftOrdersError) {
      if (draftOrdersError.message.includes("does not exist")) {
        console.warn("Draft orders table does not exist yet (migration pending)");
      } else {
        // Real error - throw it so it doesn't silently return stale data
        throw new Error(`Failed to fetch draft orders: ${draftOrdersError.message}`);
      }
    }

    // Data truncation warnings - log if we hit limit boundaries
    checkQueryLimit(monthlySalesData?.length || 0, QUERY_LIMITS.INVENTORY_RETAIL_SALES, "inventory_monthly_retail");
    checkQueryLimit(monthlyB2BData?.length || 0, QUERY_LIMITS.INVENTORY_B2B_SALES, "inventory_monthly_b2b");
    checkQueryLimit(sales3DayData?.length || 0, QUERY_LIMITS.INVENTORY_VELOCITY, "inventory_3day_velocity");
    checkQueryLimit(salesPrior3DayData?.length || 0, QUERY_LIMITS.INVENTORY_VELOCITY, "inventory_prior_3day_velocity");

    // Create current month budget lookup (for display)
    const budgetBySku = new Map<string, number>();
    for (const b of currentMonthBudgets || []) {
      budgetBySku.set(b.sku.toLowerCase(), b.budget);
    }

    // Build lookups for DOI calculation
    // Weekly weights: seasonal demand distribution (sum = 1.0)
    const weeklyWeightsLookup = buildWeeklyWeightsLookup(weeklyWeightsData || []);
    // Annual budget: sum of 12 monthly 'total' budgets per SKU/year
    const annualBudgetLookup = buildAnnualBudgetLookup(allBudgets || []);

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
        // Calculate DOI using weekly weights for seasonal demand
        // Only calculate for positive inventory
        const doiResult = total > 0
          ? calculateDOI(sku, total, weeklyWeightsLookup, annualBudgetLookup)
          : undefined;

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

    // Process B2B draft orders - aggregate by SKU
    let draftOrderSkus: B2BDraftOrderSku[] | undefined;
    let draftOrderTotals: { totalUnits: number; totalSkus: number; totalOrders: number } | undefined;

    if (draftOrdersData && draftOrdersData.length > 0) {
      // Aggregate by SKU: sum quantities, count unique draft orders, average price
      const skuAggregates = new Map<string, {
        quantity: number;
        orderIds: Set<number>;
        totalPrice: number;
        priceCount: number;
      }>();

      for (const item of draftOrdersData) {
        const skuLower = item.sku.toLowerCase();
        const existing = skuAggregates.get(skuLower) || {
          quantity: 0,
          orderIds: new Set<number>(),
          totalPrice: 0,
          priceCount: 0,
        };

        existing.quantity += item.quantity;
        existing.orderIds.add(item.draft_order_id);
        if (item.price !== null) {
          existing.totalPrice += item.price * item.quantity;
          existing.priceCount += item.quantity;
        }

        skuAggregates.set(skuLower, existing);
      }

      // Build draft order SKU list with product info
      draftOrderSkus = [];
      let totalUnits = 0;
      const allOrderIds = new Set<number>();

      for (const [skuLower, agg] of skuAggregates) {
        const product = productMap.get(skuLower);

        draftOrderSkus.push({
          sku: skuLower.toUpperCase(), // Normalize to uppercase for display
          displayName: product?.displayName || skuLower.toUpperCase(),
          category: (product?.category as InventoryCategory) || null,
          quantity: agg.quantity,
          orderCount: agg.orderIds.size,
          avgPrice: agg.priceCount > 0 ? Math.round((agg.totalPrice / agg.priceCount) * 100) / 100 : null,
        });

        totalUnits += agg.quantity;
        for (const orderId of agg.orderIds) {
          allOrderIds.add(orderId);
        }
      }

      // Sort by quantity descending
      draftOrderSkus.sort((a, b) => b.quantity - a.quantity);

      draftOrderTotals = {
        totalUnits,
        totalSkus: draftOrderSkus.length,
        totalOrders: allOrderIds.size,
      };
    }

    const response: InventoryResponse = {
      inventory,
      totals,
      byCategory,
      salesVelocity,
      draftOrderSkus,
      draftOrderTotals,
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
