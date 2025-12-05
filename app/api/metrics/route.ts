import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  MetricsResponse,
  WarehouseMetrics,
  DailyFulfillment,
  WeeklyFulfillment,
  QueueHealth,
  SkuInQueue,
  StuckShipment,
  TransitAnalytics,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = await createClient();
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    // Get restoration order IDs to exclude (SKUs containing "rest")
    // These are a different fulfillment cycle - customer ships item back first
    const { data: restorationItems } = await supabase
      .from("line_items")
      .select("order_id")
      .ilike("sku", "%rest%");

    const restorationOrderIds = new Set(
      (restorationItems || []).map((item) => item.order_id)
    );

    // Helper to filter out restoration orders from results
    // Works with order data that has an 'id' field or joined order data
    const filterRestorationOrders = <T extends Record<string, unknown>>(
      data: T[] | null,
      idField: keyof T = "id" as keyof T
    ): T[] => {
      if (!data || restorationOrderIds.size === 0) return data || [];
      return data.filter((row) => {
        const orderId = row[idField] as number | undefined;
        return orderId ? !restorationOrderIds.has(orderId) : true;
      });
    };

    // Date calculations
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Week boundaries (Monday-based)
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - mondayOffset);
    thisWeekStart.setHours(0, 0, 0, 0);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setMilliseconds(-1);

    // Run count queries in parallel (using exact counts, no row limit)
    const [
      // Unfulfilled counts by warehouse
      unfulfilledSmitheyCount,
      unfulfilledSeleryCount,
      partialSmitheyCount,
      partialSeleryCount,
      fulfilledTodaySmitheyCount,
      fulfilledTodaySeleryCount,
      fulfilled7dSmitheyCount,
      fulfilled7dSeleryCount,
      fulfilled30dSmitheyCount,
      fulfilled30dSeleryCount,
      thisWeekSmitheyCount,
      thisWeekSeleryCount,
      lastWeekSmitheyCount,
      lastWeekSeleryCount,
      // Data queries (with limits)
      dailyResult,
      oldestOrderResult,
      skuQueueResult,
      stuckShipmentsResult,
      transitDataResult,
    ] = await Promise.all([
      // Unfulfilled Smithey
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "smithey"),

      // Unfulfilled Selery
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "selery"),

      // Partial Smithey
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("fulfillment_status", "partial")
        .eq("canceled", false)
        .eq("warehouse", "smithey"),

      // Partial Selery
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("fulfillment_status", "partial")
        .eq("canceled", false)
        .eq("warehouse", "selery"),

      // Fulfilled today Smithey
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", `${today}T00:00:00`)
        .eq("canceled", false)
        .eq("warehouse", "smithey"),

      // Fulfilled today Selery
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", `${today}T00:00:00`)
        .eq("canceled", false)
        .eq("warehouse", "selery"),

      // Fulfilled 7d Smithey
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", sevenDaysAgo.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "smithey"),

      // Fulfilled 7d Selery
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", sevenDaysAgo.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "selery"),

      // Fulfilled 30d Smithey
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", thirtyDaysAgo.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "smithey"),

      // Fulfilled 30d Selery
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", thirtyDaysAgo.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "selery"),

      // This week Smithey
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", thisWeekStart.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "smithey"),

      // This week Selery
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", thisWeekStart.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "selery"),

      // Last week Smithey
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", lastWeekStart.toISOString())
        .lt("fulfilled_at", thisWeekStart.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "smithey"),

      // Last week Selery
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", lastWeekStart.toISOString())
        .lt("fulfilled_at", thisWeekStart.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "selery"),

      // Daily fulfillments for chart (30 days) - limit to reasonable amount
      supabase
        .from("orders")
        .select("id, warehouse, fulfilled_at")
        .gte("fulfilled_at", thirtyDaysAgo.toISOString())
        .eq("canceled", false)
        .not("warehouse", "is", null)
        .not("fulfilled_at", "is", null)
        .limit(10000),

      // Oldest unfulfilled order per warehouse
      supabase
        .from("orders")
        .select("id, warehouse, order_name, created_at")
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .not("warehouse", "is", null)
        .order("created_at", { ascending: true })
        .limit(20),

      // SKUs in unfulfilled queue - limit results
      supabase
        .from("line_items")
        .select(`
          sku,
          title,
          quantity,
          fulfilled_quantity,
          orders!inner(warehouse, fulfillment_status, canceled)
        `)
        .is("orders.fulfillment_status", null)
        .eq("orders.canceled", false)
        .not("orders.warehouse", "is", null)
        .limit(5000),

      // Stuck shipments - in transit with no scans for 3+ days
      supabase
        .from("shipments")
        .select(`
          order_id,
          tracking_number,
          carrier,
          shipped_at,
          days_without_scan,
          last_scan_location,
          orders!inner(order_name, warehouse)
        `)
        .eq("status", "in_transit")
        .gte("days_without_scan", 3)
        .order("days_without_scan", { ascending: false })
        .limit(20),

      // Transit time data for delivered shipments
      supabase
        .from("shipments")
        .select(`
          transit_days,
          delivery_state,
          orders!inner(warehouse)
        `)
        .eq("status", "delivered")
        .not("transit_days", "is", null)
        .gte("shipped_at", "2024-11-15T00:00:00.000Z")
        .limit(5000),
    ]);

    // Build warehouse metrics from count queries
    const smitheyUnfulfilled = unfulfilledSmitheyCount.count || 0;
    const seleryUnfulfilled = unfulfilledSeleryCount.count || 0;
    const smitheyPartial = partialSmitheyCount.count || 0;
    const seleryPartial = partialSeleryCount.count || 0;
    const smitheyToday = fulfilledTodaySmitheyCount.count || 0;
    const seleryToday = fulfilledTodaySeleryCount.count || 0;
    const smithey7d = fulfilled7dSmitheyCount.count || 0;
    const selery7d = fulfilled7dSeleryCount.count || 0;
    const smithey30d = fulfilled30dSmitheyCount.count || 0;
    const selery30d = fulfilled30dSeleryCount.count || 0;
    const smitheyThisWeek = thisWeekSmitheyCount.count || 0;
    const seleryThisWeek = thisWeekSeleryCount.count || 0;
    const smitheyLastWeek = lastWeekSmitheyCount.count || 0;
    const seleryLastWeek = lastWeekSeleryCount.count || 0;

    const smitheyWeekChange = smitheyLastWeek > 0
      ? ((smitheyThisWeek - smitheyLastWeek) / smitheyLastWeek) * 100
      : smitheyThisWeek > 0 ? 100 : 0;
    const seleryWeekChange = seleryLastWeek > 0
      ? ((seleryThisWeek - seleryLastWeek) / seleryLastWeek) * 100
      : seleryThisWeek > 0 ? 100 : 0;

    const warehouses: WarehouseMetrics[] = [
      {
        warehouse: "smithey",
        unfulfilled_count: smitheyUnfulfilled,
        partial_count: smitheyPartial,
        fulfilled_today: smitheyToday,
        fulfilled_7d: smithey7d,
        fulfilled_30d: smithey30d,
        avg_per_day_7d: Math.round((smithey7d / 7) * 10) / 10,
        avg_per_day_30d: Math.round((smithey30d / 30) * 10) / 10,
        fulfilled_this_week: smitheyThisWeek,
        fulfilled_last_week: smitheyLastWeek,
        week_over_week_change: Math.round(smitheyWeekChange * 10) / 10,
      },
      {
        warehouse: "selery",
        unfulfilled_count: seleryUnfulfilled,
        partial_count: seleryPartial,
        fulfilled_today: seleryToday,
        fulfilled_7d: selery7d,
        fulfilled_30d: selery30d,
        avg_per_day_7d: Math.round((selery7d / 7) * 10) / 10,
        avg_per_day_30d: Math.round((selery30d / 30) * 10) / 10,
        fulfilled_this_week: seleryThisWeek,
        fulfilled_last_week: seleryLastWeek,
        week_over_week_change: Math.round(seleryWeekChange * 10) / 10,
      },
    ];

    // Process daily fulfillments - filter out restoration orders
    const filteredDailyData = filterRestorationOrders(dailyResult.data);
    const daily = processDailyFulfillments(filteredDailyData);

    // Process weekly fulfillments (last 8 weeks)
    const weekly = processWeeklyFulfillments(filteredDailyData);

    // Process queue health using oldest order data
    const queueHealth: QueueHealth[] = [
      {
        warehouse: "smithey",
        waiting_1_day: 0, // TODO: add count queries for aging
        waiting_3_days: 0,
        waiting_7_days: 0,
        oldest_order_days: 0,
        oldest_order_name: null,
      },
      {
        warehouse: "selery",
        waiting_1_day: 0,
        waiting_3_days: 0,
        waiting_7_days: 0,
        oldest_order_days: 0,
        oldest_order_name: null,
      },
    ];
    // Find oldest per warehouse from oldestOrderResult
    for (const order of oldestOrderResult.data || []) {
      const wh = order.warehouse as string;
      const whHealth = queueHealth.find(h => h.warehouse === wh);
      if (whHealth && !whHealth.oldest_order_name) {
        const days = Math.floor((now.getTime() - new Date(order.created_at).getTime()) / (24 * 60 * 60 * 1000));
        whHealth.oldest_order_days = days;
        whHealth.oldest_order_name = order.order_name;
      }
    }

    // Process SKU queue - filter out restoration SKUs directly
    const topSkusInQueue = processSkuQueue(
      (skuQueueResult.data || []).filter(
        (row: { sku: string | null }) => !row.sku?.toLowerCase().includes("rest")
      )
    );

    // Process stuck shipments
    const stuckShipments = processStuckShipments(stuckShipmentsResult.data || [], now);

    // Process transit analytics
    const transitAnalytics = processTransitAnalytics(transitDataResult.data || []);

    const response: MetricsResponse = {
      warehouses,
      daily,
      weekly,
      queueHealth,
      topSkusInQueue,
      stuckShipments,
      transitAnalytics,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}

function countByWarehouse(
  data: Array<{ warehouse: string | null; id?: number }>
): Record<string, number> {
  return data.reduce((acc, row) => {
    if (row.warehouse) {
      acc[row.warehouse] = (acc[row.warehouse] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
}

function processDailyFulfillments(
  data: Array<{ warehouse: string | null; fulfilled_at: string | null; id?: number }>
): DailyFulfillment[] {
  const grouped = new Map<string, number>();

  for (const row of data) {
    if (!row.warehouse || !row.fulfilled_at) continue;
    const date = row.fulfilled_at.split("T")[0];
    const key = `${date}|${row.warehouse}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }

  const result: DailyFulfillment[] = [];
  for (const [key, count] of grouped) {
    const [date, warehouse] = key.split("|");
    result.push({ date, warehouse, count });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function processWeeklyFulfillments(
  data: Array<{ warehouse: string | null; fulfilled_at: string | null; id?: number }>
): WeeklyFulfillment[] {
  const grouped = new Map<string, number>();

  for (const row of data) {
    if (!row.warehouse || !row.fulfilled_at) continue;

    const date = new Date(row.fulfilled_at);
    const dayOfWeek = date.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - mondayOffset);
    const weekKey = weekStart.toISOString().split("T")[0];

    const key = `${weekKey}|${row.warehouse}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }

  const result: WeeklyFulfillment[] = [];
  for (const [key, count] of grouped) {
    const [week_start, warehouse] = key.split("|");
    result.push({ week_start, warehouse, count });
  }

  return result.sort((a, b) => a.week_start.localeCompare(b.week_start));
}

function processQueueHealth(
  queueData: Array<{ warehouse: string | null; created_at: string; id?: number }>,
  oldestOrders: Array<{ warehouse: string | null; order_name: string; created_at: string; id?: number }>,
  now: Date
): QueueHealth[] {
  const oneDayAgo = now.getTime() - 1 * 24 * 60 * 60 * 1000;
  const threeDaysAgo = now.getTime() - 3 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  const healthByWh: Record<string, {
    waiting_1_day: number;
    waiting_3_days: number;
    waiting_7_days: number;
  }> = {
    smithey: { waiting_1_day: 0, waiting_3_days: 0, waiting_7_days: 0 },
    selery: { waiting_1_day: 0, waiting_3_days: 0, waiting_7_days: 0 },
  };

  for (const row of queueData) {
    if (!row.warehouse) continue;
    const createdAt = new Date(row.created_at).getTime();

    if (createdAt < oneDayAgo) healthByWh[row.warehouse].waiting_1_day++;
    if (createdAt < threeDaysAgo) healthByWh[row.warehouse].waiting_3_days++;
    if (createdAt < sevenDaysAgo) healthByWh[row.warehouse].waiting_7_days++;
  }

  // Find oldest per warehouse
  const oldestByWh: Record<string, { days: number; name: string | null }> = {
    smithey: { days: 0, name: null },
    selery: { days: 0, name: null },
  };

  for (const order of oldestOrders) {
    if (!order.warehouse) continue;
    if (!oldestByWh[order.warehouse].name) {
      const days = Math.floor((now.getTime() - new Date(order.created_at).getTime()) / (24 * 60 * 60 * 1000));
      oldestByWh[order.warehouse] = { days, name: order.order_name };
    }
  }

  return ["smithey", "selery"].map((wh) => ({
    warehouse: wh,
    waiting_1_day: healthByWh[wh]?.waiting_1_day || 0,
    waiting_3_days: healthByWh[wh]?.waiting_3_days || 0,
    waiting_7_days: healthByWh[wh]?.waiting_7_days || 0,
    oldest_order_days: oldestByWh[wh]?.days || 0,
    oldest_order_name: oldestByWh[wh]?.name || null,
  }));
}

interface SkuQueueRow {
  sku: string | null;
  title: string | null;
  quantity: number;
  fulfilled_quantity: number;
  orders: {
    warehouse: string | null;
    fulfillment_status: string | null;
    canceled: boolean;
  } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processSkuQueue(data: any[]): SkuInQueue[] {
  const grouped = new Map<string, {
    title: string | null;
    warehouse: string;
    quantity: number;
    orderIds: Set<number>;
  }>();

  for (const row of data) {
    const orders = row.orders as SkuQueueRow["orders"];
    if (!row.sku || !orders?.warehouse) continue;

    const unfulfilled = row.quantity - row.fulfilled_quantity;
    if (unfulfilled <= 0) continue;

    const key = `${row.sku}|${orders.warehouse}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.quantity += unfulfilled;
      // We don't have order_id here, so we'll approximate order_count
    } else {
      grouped.set(key, {
        title: row.title,
        warehouse: orders.warehouse,
        quantity: unfulfilled,
        orderIds: new Set(),
      });
    }
  }

  // Convert to array and sort by quantity
  const result: SkuInQueue[] = [];
  for (const [key, value] of grouped) {
    const [sku] = key.split("|");
    result.push({
      sku,
      title: value.title,
      warehouse: value.warehouse,
      quantity: value.quantity,
      order_count: Math.ceil(value.quantity / 2), // Approximate
    });
  }

  // Sort by quantity descending, take top 20
  return result
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);
}

interface StuckShipmentRow {
  order_id: number;
  tracking_number: string;
  carrier: string | null;
  shipped_at: string;
  days_without_scan: number;
  last_scan_location: string | null;
  orders: {
    order_name: string;
    warehouse: string | null;
  } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processStuckShipments(data: any[], now: Date): StuckShipment[] {
  return data
    .filter((row) => row.orders?.warehouse)
    .map((row: StuckShipmentRow) => {
      const shippedAt = new Date(row.shipped_at);
      const daysSinceShipped = Math.floor(
        (now.getTime() - shippedAt.getTime()) / (24 * 60 * 60 * 1000)
      );

      return {
        order_id: row.order_id,
        order_name: row.orders?.order_name || `#${row.order_id}`,
        warehouse: row.orders?.warehouse || "unknown",
        tracking_number: row.tracking_number,
        carrier: row.carrier,
        shipped_at: row.shipped_at,
        days_since_shipped: daysSinceShipped,
        days_without_scan: row.days_without_scan,
        last_scan_location: row.last_scan_location,
      };
    });
}

interface TransitDataRow {
  transit_days: number;
  delivery_state: string | null;
  orders: {
    warehouse: string | null;
  } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processTransitAnalytics(data: any[]): TransitAnalytics[] {
  const byWarehouse = new Map<string, {
    totalDays: number;
    count: number;
    byState: Map<string, { totalDays: number; count: number }>;
  }>();

  // Initialize warehouses
  byWarehouse.set("smithey", { totalDays: 0, count: 0, byState: new Map() });
  byWarehouse.set("selery", { totalDays: 0, count: 0, byState: new Map() });

  for (const row of data) {
    const typedRow = row as TransitDataRow;
    const warehouse = typedRow.orders?.warehouse;
    if (!warehouse || !typedRow.transit_days) continue;

    const whData = byWarehouse.get(warehouse);
    if (!whData) continue;

    whData.totalDays += typedRow.transit_days;
    whData.count++;

    // Aggregate by state
    const state = typedRow.delivery_state?.toUpperCase() || "UNKNOWN";
    const stateData = whData.byState.get(state) || { totalDays: 0, count: 0 };
    stateData.totalDays += typedRow.transit_days;
    stateData.count++;
    whData.byState.set(state, stateData);
  }

  return ["smithey", "selery"].map((warehouse) => {
    const whData = byWarehouse.get(warehouse)!;

    // Get top 10 states by shipment count
    const stateStats = Array.from(whData.byState.entries())
      .map(([state, data]) => ({
        state,
        avg_transit_days: Math.round((data.totalDays / data.count) * 10) / 10,
        shipment_count: data.count,
      }))
      .sort((a, b) => b.shipment_count - a.shipment_count)
      .slice(0, 10);

    return {
      warehouse,
      avg_transit_days: whData.count > 0
        ? Math.round((whData.totalDays / whData.count) * 10) / 10
        : 0,
      total_delivered: whData.count,
      by_state: stateStats,
    };
  });
}
