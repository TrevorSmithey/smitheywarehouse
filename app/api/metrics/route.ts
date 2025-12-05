import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  MetricsResponse,
  WarehouseMetrics,
  DailyFulfillment,
  DailyOrders,
  DailyBacklog,
  WeeklyFulfillment,
  QueueHealth,
  SkuInQueue,
  StuckShipment,
  FulfillmentLeadTime,
  TransitAnalytics,
  EngravingQueue,
  OrderAging,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Helper to fetch all rows with pagination (Supabase caps at 1000 rows)
async function fetchAllPaginated<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  select: string,
  filters: { column: string; op: string; value: unknown }[],
  pageSize = 1000
): Promise<T[]> {
  const allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(select);

    for (const f of filters) {
      if (f.op === "gte") query = query.gte(f.column, f.value);
      else if (f.op === "lte") query = query.lte(f.column, f.value);
      else if (f.op === "eq") query = query.eq(f.column, f.value);
      else if (f.op === "not.is.null") query = query.not(f.column, "is", null);
    }

    const { data, error } = await query.range(offset, offset + pageSize - 1);

    if (error || !data) {
      console.error("Pagination error:", error);
      break;
    }

    allData.push(...(data as T[]));
    hasMore = data.length === pageSize;
    offset += pageSize;
  }

  return allData;
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const now = new Date();

    // Parse date range from query params
    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    // Default to 7 days if no params provided
    const rangeStart = startParam ? new Date(startParam) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const rangeEnd = endParam ? new Date(endParam) : now;

    // Use EST/EDT for "today" calculations (Smithey is US-based)
    // EST = UTC - 5 hours, so subtract 5 hours from UTC to get EST time
    const estTime = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    const todayEST = estTime.toISOString().split("T")[0];
    // Convert EST midnight to UTC for database queries
    const todayStartUTC = new Date(`${todayEST}T05:00:00.000Z`); // EST midnight = UTC 5am

    // Get restoration order IDs to exclude (SKUs containing "-Rest-")
    // These are a different fulfillment cycle - customer ships item back first
    // Join with orders to get warehouse and fulfillment_status for per-warehouse counts
    const { data: restorationItems } = await supabase
      .from("line_items")
      .select("order_id, orders!inner(warehouse, fulfillment_status, canceled)")
      .ilike("sku", "%-Rest-%");

    const restorationOrderIds = new Set(
      (restorationItems || []).map((item) => item.order_id)
    );

    // Count unfulfilled restoration orders per warehouse (to subtract from queue counts)
    const restorationByWarehouse = { smithey: 0, selery: 0 };
    const countedOrderIds = new Set<number>();
    for (const item of restorationItems || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const order = (item as any).orders;
      if (!order || order.canceled || order.fulfillment_status === "fulfilled") continue;
      if (countedOrderIds.has(item.order_id)) continue; // Don't double-count orders with multiple restoration items
      countedOrderIds.add(item.order_id);
      if (order.warehouse === "smithey") restorationByWarehouse.smithey++;
      else if (order.warehouse === "selery") restorationByWarehouse.selery++;
    }

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
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
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
      // Queue aging counts
      waiting1dSmithey,
      waiting1dSelery,
      waiting3dSmithey,
      waiting3dSelery,
      waiting7dSmithey,
      waiting7dSelery,
      // Data queries (with limits)
      dailyResult,
      oldestSmitheyResult,
      oldestSeleryResult,
      skuQueueResult,
      stuckShipmentsResult,
      transitDataResult,
      dailyOrdersResult,
      leadTimeResult,
      engravingQueueResult,
      agingDataResult,
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

      // Fulfilled in selected range - Smithey
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", rangeStart.toISOString())
        .lte("fulfilled_at", rangeEnd.toISOString())
        .eq("canceled", false)
        .eq("warehouse", "smithey"),

      // Fulfilled in selected range - Selery
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("fulfilled_at", rangeStart.toISOString())
        .lte("fulfilled_at", rangeEnd.toISOString())
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

      // Queue aging: unfulfilled orders older than 1 day (Smithey)
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "smithey")
        .lt("created_at", oneDayAgo.toISOString()),

      // Queue aging: unfulfilled orders older than 1 day (Selery)
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "selery")
        .lt("created_at", oneDayAgo.toISOString()),

      // Queue aging: unfulfilled orders older than 3 days (Smithey)
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "smithey")
        .lt("created_at", threeDaysAgo.toISOString()),

      // Queue aging: unfulfilled orders older than 3 days (Selery)
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "selery")
        .lt("created_at", threeDaysAgo.toISOString()),

      // Queue aging: unfulfilled orders older than 7 days (Smithey)
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "smithey")
        .lt("created_at", sevenDaysAgo.toISOString()),

      // Queue aging: unfulfilled orders older than 7 days (Selery)
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "selery")
        .lt("created_at", sevenDaysAgo.toISOString()),

      // Daily fulfillments for chart - filtered by selected date range
      // Limit increased to handle high volume periods (1500/day × 30 days = 45k)
      supabase
        .from("orders")
        .select("id, warehouse, fulfilled_at")
        .gte("fulfilled_at", rangeStart.toISOString())
        .lte("fulfilled_at", rangeEnd.toISOString())
        .eq("canceled", false)
        .not("warehouse", "is", null)
        .not("fulfilled_at", "is", null)
        .order("fulfilled_at", { ascending: false })
        .limit(50000),

      // Oldest unfulfilled orders for Smithey (get 20 so we can filter out restoration)
      supabase
        .from("orders")
        .select("id, warehouse, order_name, created_at")
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "smithey")
        .order("created_at", { ascending: true })
        .limit(20),

      // Oldest unfulfilled orders for Selery (get 20 so we can filter out restoration)
      supabase
        .from("orders")
        .select("id, warehouse, order_name, created_at")
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("warehouse", "selery")
        .order("created_at", { ascending: true })
        .limit(20),

      // SKUs in unfulfilled queue - get all line items from unfulfilled orders
      // Increased limit from 5000 to 100000 to capture all data
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
        .limit(100000),

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

      // Transit time data for delivered shipments - filtered by date range
      supabase
        .from("shipments")
        .select(`
          order_id,
          transit_days,
          delivery_state,
          orders!inner(warehouse)
        `)
        .eq("status", "delivered")
        .not("transit_days", "is", null)
        .gte("delivered_at", rangeStart.toISOString())
        .lte("delivered_at", rangeEnd.toISOString())
        .limit(5000),

      // Daily orders - will be fetched separately with pagination
      Promise.resolve({ data: [] }),

      // Fulfillment lead time data - filtered by selected date range
      supabase
        .from("orders")
        .select("id, warehouse, created_at, fulfilled_at")
        .not("fulfilled_at", "is", null)
        .gte("fulfilled_at", rangeStart.toISOString())
        .lte("fulfilled_at", rangeEnd.toISOString())
        .eq("canceled", false)
        .not("warehouse", "is", null)
        .limit(10000),

      // Engraving queue - line items with SKU 'Smith-Eng' or 'Smith-Eng2'
      // Filter for non-canceled orders; exclude fulfilled orders client-side
      // (PostgREST's .neq() doesn't include NULL, which is unfulfilled status)
      supabase
        .from("line_items")
        .select(`
          order_id,
          sku,
          quantity,
          fulfilled_quantity,
          orders!inner(fulfillment_status, canceled)
        `)
        .or("sku.eq.Smith-Eng,sku.eq.Smith-Eng2")
        .eq("orders.canceled", false)
        .limit(10000),

      // Unfulfilled orders for aging analysis
      supabase
        .from("orders")
        .select("id, warehouse, created_at")
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .not("warehouse", "is", null)
        .limit(10000),
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
        unfulfilled_count: smitheyUnfulfilled - restorationByWarehouse.smithey,
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
        unfulfilled_count: seleryUnfulfilled - restorationByWarehouse.selery,
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

    // Process order aging data - filter out restoration orders FIRST
    // This filtered data is used for both queue health counts and the aging bar chart
    const filteredAgingData = filterRestorationOrders(agingDataResult.data || []);

    // Calculate queue health counts from filtered aging data (not raw count queries)
    // This ensures consistency with the order aging bar chart
    const nowMs = now.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const queueHealthCounts = {
      smithey: { waiting1d: 0, waiting3d: 0, waiting7d: 0 },
      selery: { waiting1d: 0, waiting3d: 0, waiting7d: 0 },
    };

    for (const order of filteredAgingData) {
      const warehouse = order.warehouse as "smithey" | "selery";
      if (!warehouse || !queueHealthCounts[warehouse]) continue;

      const createdAt = new Date(order.created_at).getTime();
      const ageMs = nowMs - createdAt;

      if (ageMs > oneDayMs) queueHealthCounts[warehouse].waiting1d++;
      if (ageMs > 3 * oneDayMs) queueHealthCounts[warehouse].waiting3d++;
      if (ageMs > 7 * oneDayMs) queueHealthCounts[warehouse].waiting7d++;
    }

    const queueHealth: QueueHealth[] = [
      {
        warehouse: "smithey",
        waiting_1_day: queueHealthCounts.smithey.waiting1d,
        waiting_3_days: queueHealthCounts.smithey.waiting3d,
        waiting_7_days: queueHealthCounts.smithey.waiting7d,
        oldest_order_days: 0,
        oldest_order_name: null,
      },
      {
        warehouse: "selery",
        waiting_1_day: queueHealthCounts.selery.waiting1d,
        waiting_3_days: queueHealthCounts.selery.waiting3d,
        waiting_7_days: queueHealthCounts.selery.waiting7d,
        oldest_order_days: 0,
        oldest_order_name: null,
      },
    ];
    // Set oldest order for Smithey (filter out restoration orders and excluded orders)
    const excludedOrderNames = new Set(["S321703"]);
    const oldestSmithey = (oldestSmitheyResult.data || [])
      .filter((o: { id: number; order_name: string }) =>
        !restorationOrderIds.has(o.id) && !excludedOrderNames.has(o.order_name)
      )[0];
    if (oldestSmithey) {
      const smitheyHealth = queueHealth.find(h => h.warehouse === "smithey");
      if (smitheyHealth) {
        const days = Math.floor((now.getTime() - new Date(oldestSmithey.created_at).getTime()) / (24 * 60 * 60 * 1000));
        smitheyHealth.oldest_order_days = days;
        smitheyHealth.oldest_order_name = oldestSmithey.order_name;
      }
    }

    // Set oldest order for Selery (filter out restoration orders)
    const oldestSelery = (oldestSeleryResult.data || [])
      .filter((o: { id: number }) => !restorationOrderIds.has(o.id))[0];
    if (oldestSelery) {
      const seleryHealth = queueHealth.find(h => h.warehouse === "selery");
      if (seleryHealth) {
        const days = Math.floor((now.getTime() - new Date(oldestSelery.created_at).getTime()) / (24 * 60 * 60 * 1000));
        seleryHealth.oldest_order_days = days;
        seleryHealth.oldest_order_name = oldestSelery.order_name;
      }
    }

    // Process SKU queue - filter out restoration SKUs directly
    const topSkusInQueue = processSkuQueue(
      (skuQueueResult.data || []).filter(
        (row: { sku: string | null }) => !row.sku?.includes("-Rest-")
      )
    );

    // Process stuck shipments - filter out restoration orders
    const stuckShipments = processStuckShipments(
      (stuckShipmentsResult.data || []).filter(
        (row: { order_id: number }) => !restorationOrderIds.has(row.order_id)
      ),
      now
    );

    // Process transit analytics - filter out restoration orders
    const transitAnalytics = processTransitAnalytics(
      (transitDataResult.data || []).filter(
        (row: { order_id: number }) => !restorationOrderIds.has(row.order_id)
      )
    );

    // Process daily orders for warehouse distribution - fetch with pagination to bypass 1000 row limit
    const dailyOrdersData = await fetchAllPaginated<{ id: number; warehouse: string | null; created_at: string }>(
      supabase,
      "orders",
      "id, warehouse, created_at",
      [
        { column: "created_at", op: "gte", value: rangeStart.toISOString() },
        { column: "created_at", op: "lte", value: rangeEnd.toISOString() },
        { column: "canceled", op: "eq", value: false },
        { column: "warehouse", op: "not.is.null", value: null },
      ]
    );
    // Filter out restoration orders from daily orders (for consistent backlog calculation)
    const filteredDailyOrdersData = filterRestorationOrders(dailyOrdersData);
    const dailyOrders = processDailyOrders(filteredDailyOrdersData);

    // Process fulfillment lead time analytics - filter out restoration orders
    // Calculate midpoint of range for trend comparison
    const rangeMidpoint = new Date(rangeStart.getTime() + (rangeEnd.getTime() - rangeStart.getTime()) / 2);
    const filteredLeadTimeData = filterRestorationOrders(leadTimeResult.data || []);
    const fulfillmentLeadTime = processFulfillmentLeadTime(filteredLeadTimeData, rangeMidpoint);

    // Process engraving queue
    const engravingQueue = processEngravingQueue(engravingQueueResult.data || []);

    // Process order aging for bar chart - uses filteredAgingData created earlier
    const orderAging = processOrderAging(filteredAgingData, now);

    // Calculate daily backlog (orders created - orders fulfilled)
    // Get current total unfulfilled to calculate running backlog
    const currentUnfulfilled = (unfulfilledSmitheyCount.count || 0) + (unfulfilledSeleryCount.count || 0) +
                               (partialSmitheyCount.count || 0) + (partialSeleryCount.count || 0);
    // For backlog, exclude restoration orders (they're waiting on customer, not warehouse)
    // Count unfulfilled restoration orders from aging data
    const restorationUnfulfilledCount = (agingDataResult.data || []).filter(
      (o: { id: number }) => restorationOrderIds.has(o.id)
    ).length;
    const currentUnfulfilledExcludingRestoration = currentUnfulfilled - restorationUnfulfilledCount;
    const dailyBacklog = calculateDailyBacklog(dailyOrders, daily, currentUnfulfilledExcludingRestoration);

    const response: MetricsResponse = {
      warehouses,
      daily,
      dailyOrders,
      dailyBacklog,
      weekly,
      queueHealth,
      topSkusInQueue,
      stuckShipments,
      fulfillmentLeadTime,
      transitAnalytics,
      engravingQueue,
      orderAging,
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

function processDailyFulfillments(
  data: Array<{ warehouse: string | null; fulfilled_at: string | null; id?: number }>
): DailyFulfillment[] {
  const grouped = new Map<string, number>();

  for (const row of data) {
    if (!row.warehouse || !row.fulfilled_at) continue;
    // Convert UTC timestamp to EST date for grouping
    const date = utcToEstDate(row.fulfilled_at);
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

// Convert UTC timestamp to EST date string (YYYY-MM-DD)
function utcToEstDate(utcTimestamp: string): string {
  const date = new Date(utcTimestamp);
  // EST is UTC-5 (ignoring DST for simplicity - within 1 hour)
  const estDate = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  return estDate.toISOString().split("T")[0];
}

function processWeeklyFulfillments(
  data: Array<{ warehouse: string | null; fulfilled_at: string | null; id?: number }>
): WeeklyFulfillment[] {
  const grouped = new Map<string, number>();

  for (const row of data) {
    if (!row.warehouse || !row.fulfilled_at) continue;

    // Convert UTC to EST first, then calculate week
    const utcDate = new Date(row.fulfilled_at);
    const date = new Date(utcDate.getTime() - 5 * 60 * 60 * 1000); // EST
    const dayOfWeek = date.getUTCDay(); // Use UTC methods since we already offset
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - mondayOffset);
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
  // Group by SKU AND warehouse (separate tables)
  const grouped = new Map<string, {
    sku: string;
    title: string | null;
    warehouse: string;
    quantity: number;
    orderCount: number;
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
      existing.orderCount += 1;
    } else {
      grouped.set(key, {
        sku: row.sku,
        title: row.title,
        warehouse: orders.warehouse,
        quantity: unfulfilled,
        orderCount: 1,
      });
    }
  }

  // Convert to array
  const result: SkuInQueue[] = [];
  for (const [, value] of grouped) {
    result.push({
      sku: value.sku,
      title: value.title,
      warehouse: value.warehouse,
      quantity: value.quantity,
      order_count: value.orderCount,
    });
  }

  // Get top 20 per warehouse (so both columns have scrollable lists)
  const smithey = result
    .filter((s) => s.warehouse === "smithey")
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);
  const selery = result
    .filter((s) => s.warehouse === "selery")
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);

  return [...smithey, ...selery];
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

// Process daily orders for warehouse distribution analysis
function processDailyOrders(
  data: Array<{ id: number; warehouse: string | null; created_at: string }>
): DailyOrders[] {
  const grouped = new Map<string, { smithey: number; selery: number }>();

  for (const row of data) {
    if (!row.warehouse || !row.created_at) continue;
    // Convert UTC timestamp to EST date for grouping
    const date = utcToEstDate(row.created_at);
    const existing = grouped.get(date) || { smithey: 0, selery: 0 };

    if (row.warehouse === "smithey") {
      existing.smithey++;
    } else if (row.warehouse === "selery") {
      existing.selery++;
    }

    grouped.set(date, existing);
  }

  const result: DailyOrders[] = [];
  for (const [date, counts] of grouped) {
    const total = counts.smithey + counts.selery;
    result.push({
      date,
      total,
      smithey: counts.smithey,
      selery: counts.selery,
      smithey_pct: total > 0 ? Math.round((counts.smithey / total) * 100) : 0,
      selery_pct: total > 0 ? Math.round((counts.selery / total) * 100) : 0,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// Calculate fulfillment lead time analytics
function processFulfillmentLeadTime(
  data: Array<{
    id: number;
    warehouse: string | null;
    created_at: string;
    fulfilled_at: string;
  }>,
  sevenDaysAgo: Date
): FulfillmentLeadTime[] {
  const byWarehouse = new Map<string, {
    leadTimes: number[]; // in hours
    recent: number[]; // last 7 days
    older: number[]; // 7-30 days ago
  }>();

  // Initialize
  byWarehouse.set("smithey", { leadTimes: [], recent: [], older: [] });
  byWarehouse.set("selery", { leadTimes: [], recent: [], older: [] });

  for (const row of data) {
    if (!row.warehouse || !row.created_at || !row.fulfilled_at) continue;

    const whData = byWarehouse.get(row.warehouse);
    if (!whData) continue;

    const created = new Date(row.created_at);
    const fulfilled = new Date(row.fulfilled_at);
    const leadTimeHours = (fulfilled.getTime() - created.getTime()) / (1000 * 60 * 60);

    // Skip negative or unreasonable values
    if (leadTimeHours < 0 || leadTimeHours > 720) continue; // max 30 days

    whData.leadTimes.push(leadTimeHours);

    // Categorize by recency for trend calculation
    if (fulfilled >= sevenDaysAgo) {
      whData.recent.push(leadTimeHours);
    } else {
      whData.older.push(leadTimeHours);
    }
  }

  return ["smithey", "selery"].map((warehouse) => {
    const whData = byWarehouse.get(warehouse)!;
    const sorted = [...whData.leadTimes].sort((a, b) => a - b);
    const count = sorted.length;

    if (count === 0) {
      return {
        warehouse,
        avg_hours: 0,
        avg_days: 0,
        median_hours: 0,
        total_fulfilled: 0,
        within_24h: 0,
        within_48h: 0,
        within_72h: 0,
        over_72h: 0,
        trend_pct: 0,
      };
    }

    // Calculate stats
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avgHours = sum / count;
    const medianHours = count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];

    // SLA buckets
    const within24h = sorted.filter((h) => h <= 24).length;
    const within48h = sorted.filter((h) => h <= 48).length;
    const within72h = sorted.filter((h) => h <= 72).length;
    const over72h = sorted.filter((h) => h > 72).length;

    // Trend: compare recent vs older average
    const recentAvg = whData.recent.length > 0
      ? whData.recent.reduce((a, b) => a + b, 0) / whData.recent.length
      : avgHours;
    const olderAvg = whData.older.length > 0
      ? whData.older.reduce((a, b) => a + b, 0) / whData.older.length
      : avgHours;
    const trendPct = olderAvg > 0
      ? ((recentAvg - olderAvg) / olderAvg) * 100
      : 0;

    return {
      warehouse,
      avg_hours: Math.round(avgHours * 10) / 10,
      avg_days: Math.round((avgHours / 24) * 10) / 10,
      median_hours: Math.round(medianHours * 10) / 10,
      total_fulfilled: count,
      within_24h: Math.round((within24h / count) * 100),
      within_48h: Math.round((within48h / count) * 100),
      within_72h: Math.round((within72h / count) * 100),
      over_72h: Math.round((over72h / count) * 100),
      trend_pct: Math.round(trendPct * 10) / 10,
    };
  });
}

// Process engraving queue - count unfulfilled engravings
const ENGRAVING_DAILY_CAPACITY = 250;

interface EngravingQueueRow {
  order_id: number;
  sku: string;
  quantity: number;
  fulfilled_quantity: number;
  orders: {
    fulfillment_status: string | null;
    canceled: boolean;
  } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processEngravingQueue(data: any[]): EngravingQueue {
  const orderIds = new Set<number>();
  let totalUnfulfilled = 0;

  for (const row of data) {
    const typedRow = row as EngravingQueueRow;
    if (!typedRow.orders) continue;

    // Skip fulfilled orders - they've already shipped
    // (unfulfilled = NULL, partial = 'partial', so we only exclude 'fulfilled')
    if (typedRow.orders.fulfillment_status === "fulfilled") continue;

    const unfulfilled = typedRow.quantity - typedRow.fulfilled_quantity;
    if (unfulfilled > 0) {
      totalUnfulfilled += unfulfilled;
      orderIds.add(typedRow.order_id);
    }
  }

  return {
    total_units: totalUnfulfilled,
    estimated_days: Math.round((totalUnfulfilled / ENGRAVING_DAILY_CAPACITY) * 10) / 10,
    order_count: orderIds.size,
  };
}

// Calculate daily backlog (created - fulfilled per day)
// Uses current unfulfilled count and works backwards to calculate running total
function calculateDailyBacklog(
  dailyOrders: DailyOrders[],
  dailyFulfillments: DailyFulfillment[],
  currentUnfulfilled: number
): DailyBacklog[] {
  // Build maps for orders created and fulfilled by date
  const createdByDate = new Map<string, number>();
  for (const d of dailyOrders) {
    createdByDate.set(d.date, d.total);
  }

  const fulfilledByDate = new Map<string, number>();
  for (const d of dailyFulfillments) {
    const existing = fulfilledByDate.get(d.date) || 0;
    fulfilledByDate.set(d.date, existing + d.count);
  }

  // Get all unique dates and sort descending (newest first)
  const allDates = new Set([...createdByDate.keys(), ...fulfilledByDate.keys()]);
  const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));

  // Build backlog array from newest to oldest
  const result: DailyBacklog[] = [];
  let runningBacklog = currentUnfulfilled;

  for (const date of sortedDates) {
    const created = createdByDate.get(date) || 0;
    const fulfilled = fulfilledByDate.get(date) || 0;
    const netChange = created - fulfilled;

    result.push({
      date,
      created,
      fulfilled,
      netChange,
      runningBacklog: Math.max(0, runningBacklog), // Clamp to 0 - can't have negative backlog
    });

    // Move backwards: previous day's backlog was current - netChange
    runningBacklog = runningBacklog - netChange;
  }

  // Reverse so oldest is first
  return result.reverse();
}

// Process order aging for bar chart
// Buckets: ≤1d, 2d, 3d, 4d, 5+d
// "≤1d" = created in last 24 hours (day 1 of waiting)
// "2d" = created 24-48 hours ago (day 2 of waiting)
// "3d" = created 48-72 hours ago (day 3 of waiting)
// "4d" = created 72-96 hours ago (day 4 of waiting)
// "5+d" = created 96+ hours ago (day 5+ of waiting)
function processOrderAging(
  data: Array<{ id: number; warehouse: string | null; created_at: string }>,
  now: Date
): OrderAging[] {
  // Initialize buckets for each warehouse
  const buckets = {
    smithey: { "≤1d": 0, "2d": 0, "3d": 0, "4d": 0, "5+d": 0 },
    selery: { "≤1d": 0, "2d": 0, "3d": 0, "4d": 0, "5+d": 0 },
  };

  const nowMs = now.getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  for (const order of data) {
    const warehouse = order.warehouse as "smithey" | "selery";
    if (!warehouse || !buckets[warehouse]) continue;

    const createdAt = new Date(order.created_at).getTime();
    const ageDays = Math.floor((nowMs - createdAt) / oneDay);

    // ageDays 0 = 0-23 hours (day 1, ≤1d)
    // ageDays 1 = 24-47 hours (day 2)
    // ageDays 2 = 48-71 hours (day 3)
    // ageDays 3 = 72-95 hours (day 4)
    // ageDays 4+ = 96+ hours (day 5+)
    if (ageDays === 0) {
      buckets[warehouse]["≤1d"]++;
    } else if (ageDays === 1) {
      buckets[warehouse]["2d"]++;
    } else if (ageDays === 2) {
      buckets[warehouse]["3d"]++;
    } else if (ageDays === 3) {
      buckets[warehouse]["4d"]++;
    } else {
      buckets[warehouse]["5+d"]++;
    }
  }

  // Convert to array format for chart
  const bucketOrder = ["≤1d", "2d", "3d", "4d", "5+d"] as const;
  return bucketOrder.map((bucket) => ({
    bucket,
    smithey: buckets.smithey[bucket],
    selery: buckets.selery[bucket],
  }));
}
