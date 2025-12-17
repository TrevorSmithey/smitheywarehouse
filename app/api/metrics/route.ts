import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { QUERY_LIMITS, checkQueryLimit, safeArrayAccess } from "@/lib/constants";
import { checkRateLimit, rateLimitedResponse, addRateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit";
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

    if (error) {
      console.error(`[PAGINATION ERROR] Table ${table} at offset ${offset}:`, error);
      // Return partial data instead of failing completely - more resilient during transient errors
      if (allData.length > 0) {
        console.warn(`[PAGINATION] Returning ${allData.length} rows fetched before error for ${table}`);
        break;
      }
      // Only throw if we have no data at all
      throw new Error(`Pagination failed for ${table}: ${error.message}`);
    }

    if (!data) {
      break;
    }

    allData.push(...(data as T[]));
    hasMore = data.length === pageSize;
    offset += pageSize;
  }

  return allData;
}

export async function GET(request: Request) {
  // Rate limiting - use IP or forwarded IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
             request.headers.get("x-real-ip") ||
             "unknown";
  const rateLimitResult = checkRateLimit(`metrics:${ip}`, RATE_LIMITS.API);

  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

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

    // Calculate previous period (same duration, shifted back)
    const rangeDuration = rangeEnd.getTime() - rangeStart.getTime();
    const prevRangeEnd = new Date(rangeStart.getTime() - 1); // 1ms before current range start
    const prevRangeStart = new Date(prevRangeEnd.getTime() - rangeDuration);

    // Use EST/EDT for "today" calculations (Smithey is US-based)
    // Proper timezone handling that accounts for DST
    const estFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const estParts = estFormatter.formatToParts(now);
    const estYear = estParts.find(p => p.type === "year")?.value || "2025";
    const estMonth = estParts.find(p => p.type === "month")?.value || "01";
    const estDay = estParts.find(p => p.type === "day")?.value || "01";
    const todayEST = `${estYear}-${estMonth}-${estDay}`;

    // Fixed 30-day window for transit time data (independent of date selector)
    // This ensures the map always has sufficient data to populate all states
    const transit30dStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // NOTE: Restoration orders are now filtered at query level using is_restoration column
    // No client-side filtering needed - all queries include .eq("is_restoration", false)

    // Date calculations
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // CONSOLIDATED QUERY: Replace 20 individual count queries with 1 SQL query
    // This dramatically reduces DB round-trips and improves performance
    const consolidatedCountsQuery = supabase.rpc("get_order_counts", {
      p_today_start: `${todayEST}T00:00:00`,
      p_today_end: `${todayEST}T23:59:59`,
      p_seven_days_ago: sevenDaysAgo.toISOString(),
      p_thirty_days_ago: thirtyDaysAgo.toISOString(),
      p_prev_range_start: prevRangeStart.toISOString(),
      p_prev_range_end: prevRangeEnd.toISOString(),
      p_range_start: rangeStart.toISOString(),
      p_range_end: rangeEnd.toISOString(),
      p_one_day_ago: oneDayAgo.toISOString(),
      p_three_days_ago: threeDaysAgo.toISOString(),
    });

    // Run consolidated count query + data queries in parallel
    const [
      consolidatedCounts,
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
      consolidatedCountsQuery,

      // Daily fulfillments for chart - filtered by selected date range
      // Limit increased to handle high volume periods (1500/day × 30 days = 45k)
      // Restoration orders excluded at query level for accurate counts
      supabase
        .from("orders")
        .select("id, warehouse, fulfilled_at")
        .gte("fulfilled_at", rangeStart.toISOString())
        .lte("fulfilled_at", rangeEnd.toISOString())
        .eq("canceled", false)
        .eq("is_restoration", false)
        .not("warehouse", "is", null)
        .not("fulfilled_at", "is", null)
        .order("fulfilled_at", { ascending: false })
        .limit(QUERY_LIMITS.DAILY_FULFILLMENTS),

      // Oldest unfulfilled orders for Smithey (restoration excluded at query level)
      supabase
        .from("orders")
        .select("id, warehouse, order_name, created_at")
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("is_restoration", false)
        .eq("warehouse", "smithey")
        .order("created_at", { ascending: true })
        .limit(QUERY_LIMITS.OLDEST_ORDERS_SMITHEY),

      // Oldest unfulfilled orders for Selery (restoration excluded at query level)
      supabase
        .from("orders")
        .select("id, warehouse, order_name, created_at")
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("is_restoration", false)
        .eq("warehouse", "selery")
        .order("created_at", { ascending: true })
        .limit(QUERY_LIMITS.OLDEST_ORDERS_SELERY),

      // SKUs in unfulfilled queue - get all line items from unfulfilled orders
      // Increased limit from 5000 to 100000 to capture all data
      // Restoration orders excluded at query level
      supabase
        .from("line_items")
        .select(`
          sku,
          title,
          quantity,
          fulfilled_quantity,
          orders!inner(warehouse, fulfillment_status, canceled, is_restoration)
        `)
        .is("orders.fulfillment_status", null)
        .eq("orders.canceled", false)
        .eq("orders.is_restoration", false)
        .not("orders.warehouse", "is", null)
        .limit(QUERY_LIMITS.SKU_QUEUE),

      // Stuck shipments - in transit with no scans for 3+ days
      // Restoration orders excluded at query level
      supabase
        .from("shipments")
        .select(`
          order_id,
          tracking_number,
          carrier,
          shipped_at,
          days_without_scan,
          last_scan_location,
          orders!inner(order_name, warehouse, is_restoration)
        `)
        .eq("status", "in_transit")
        .eq("orders.is_restoration", false)
        .gte("days_without_scan", 1)
        .order("days_without_scan", { ascending: false })
        .limit(QUERY_LIMITS.STUCK_SHIPMENTS),

      // Transit time data for delivered shipments - fixed 30-day window
      // Uses transit30dStart to ensure sufficient data regardless of date selector
      // Restoration orders excluded at query level
      supabase
        .from("shipments")
        .select(`
          order_id,
          transit_days,
          delivery_state,
          orders!inner(warehouse, is_restoration)
        `)
        .eq("status", "delivered")
        .eq("orders.is_restoration", false)
        .not("transit_days", "is", null)
        .gte("delivered_at", transit30dStart.toISOString())
        .lte("delivered_at", now.toISOString())
        .limit(QUERY_LIMITS.TRANSIT_DATA),

      // Daily orders - will be fetched separately with pagination
      Promise.resolve({ data: [] }),

      // Fulfillment lead time data - filtered by selected date range
      // Limit increased from 10000 to 50000 - peak periods can have 20k+ fulfilled orders in 30 days
      // Restoration orders excluded at query level
      supabase
        .from("orders")
        .select("id, warehouse, created_at, fulfilled_at")
        .not("fulfilled_at", "is", null)
        .gte("fulfilled_at", rangeStart.toISOString())
        .lte("fulfilled_at", rangeEnd.toISOString())
        .eq("canceled", false)
        .eq("is_restoration", false)
        .not("warehouse", "is", null)
        .limit(QUERY_LIMITS.LEAD_TIME),

      // Engraving queue - uses RPC for efficient aggregation
      // RPC handles all filtering: unfulfilled/partial orders, non-canceled, non-restoration, Smithey warehouse
      // Returns: { total_units: number, order_count: number }
      supabase.rpc("get_engraving_queue_stats"),

      // Unfulfilled orders for aging analysis
      // Restoration orders excluded at query level
      supabase
        .from("orders")
        .select("id, warehouse, created_at")
        .is("fulfillment_status", null)
        .eq("canceled", false)
        .eq("is_restoration", false)
        .not("warehouse", "is", null)
        .limit(QUERY_LIMITS.AGING_DATA),
    ]);

    // Check all query limits for potential data truncation
    // Note: engraving queue uses RPC aggregation, no limit check needed
    checkQueryLimit(dailyResult.data?.length || 0, QUERY_LIMITS.DAILY_FULFILLMENTS, "daily_fulfillments");
    checkQueryLimit(skuQueueResult.data?.length || 0, QUERY_LIMITS.SKU_QUEUE, "sku_queue");
    checkQueryLimit(transitDataResult.data?.length || 0, QUERY_LIMITS.TRANSIT_DATA, "transit_data");
    checkQueryLimit(leadTimeResult.data?.length || 0, QUERY_LIMITS.LEAD_TIME, "lead_time");
    checkQueryLimit(agingDataResult.data?.length || 0, QUERY_LIMITS.AGING_DATA, "aging_data");

    // Fail fast if consolidated count query errors
    if (consolidatedCounts.error) {
      throw new Error(`Consolidated count query failed: ${consolidatedCounts.error.message}`);
    }

    // Log engraving queue errors (don't fail, but make them visible)
    if (engravingQueueResult.error) {
      console.error("[METRICS] Engraving queue query error:", engravingQueueResult.error);
    }

    // Extract counts from consolidated query result
    // The RPC returns an array with one row per warehouse
    type CountRow = {
      warehouse: string;
      unfulfilled: number;
      partial: number;
      fulfilled_today: number;
      fulfilled_7d: number;
      fulfilled_30d: number;
      prev_period: number;
      in_range: number;
      waiting_1d: number;
      waiting_3d: number;
      waiting_7d: number;
    };
    const counts = (consolidatedCounts.data as CountRow[]) || [];
    const smitheyCounts = counts.find((r) => r.warehouse === "smithey") || {
      unfulfilled: 0, partial: 0, fulfilled_today: 0, fulfilled_7d: 0, fulfilled_30d: 0,
      prev_period: 0, in_range: 0, waiting_1d: 0, waiting_3d: 0, waiting_7d: 0,
    };
    const seleryCounts = counts.find((r) => r.warehouse === "selery") || {
      unfulfilled: 0, partial: 0, fulfilled_today: 0, fulfilled_7d: 0, fulfilled_30d: 0,
      prev_period: 0, in_range: 0, waiting_1d: 0, waiting_3d: 0, waiting_7d: 0,
    };

    // Build warehouse metrics from consolidated counts
    const smitheyUnfulfilled = smitheyCounts.unfulfilled;
    const seleryUnfulfilled = seleryCounts.unfulfilled;
    const smitheyPartial = smitheyCounts.partial;
    const seleryPartial = seleryCounts.partial;
    const smitheyToday = smitheyCounts.fulfilled_today;
    const seleryToday = seleryCounts.fulfilled_today;
    const smithey7d = smitheyCounts.fulfilled_7d;
    const selery7d = seleryCounts.fulfilled_7d;
    const smithey30d = smitheyCounts.fulfilled_30d;
    const selery30d = seleryCounts.fulfilled_30d;
    const smitheyPrevPeriod = smitheyCounts.prev_period;
    const smitheyInRange = smitheyCounts.in_range;
    const seleryInRange = seleryCounts.in_range;
    const seleryPrevPeriod = seleryCounts.prev_period;

    // Period-over-period change (current range vs previous period of same duration)
    const smitheyPeriodChange = smitheyPrevPeriod > 0
      ? ((smitheyInRange - smitheyPrevPeriod) / smitheyPrevPeriod) * 100
      : smitheyInRange > 0 ? 100 : 0;
    const seleryPeriodChange = seleryPrevPeriod > 0
      ? ((seleryInRange - seleryPrevPeriod) / seleryPrevPeriod) * 100
      : seleryInRange > 0 ? 100 : 0;

    const warehouses: WarehouseMetrics[] = [
      {
        warehouse: "smithey",
        unfulfilled_count: smitheyUnfulfilled, // Restoration already excluded at query level
        partial_count: smitheyPartial,
        fulfilled_today: smitheyToday, // Fixed to today (EST), always visible
        fulfilled_in_range: smitheyInRange, // Respects date filter selection
        fulfilled_7d: smithey7d,
        fulfilled_30d: smithey30d,
        avg_per_day_7d: Math.round((smithey7d / 7) * 10) / 10,
        avg_per_day_30d: Math.round((smithey30d / 30) * 10) / 10,
        fulfilled_this_week: smitheyInRange, // Uses selected period
        fulfilled_last_week: smitheyPrevPeriod,
        week_over_week_change: Math.round(smitheyPeriodChange * 10) / 10,
      },
      {
        warehouse: "selery",
        unfulfilled_count: seleryUnfulfilled, // Restoration already excluded at query level
        partial_count: seleryPartial,
        fulfilled_today: seleryToday, // Fixed to today (EST), always visible
        fulfilled_in_range: seleryInRange, // Respects date filter selection
        fulfilled_7d: selery7d,
        fulfilled_30d: selery30d,
        avg_per_day_7d: Math.round((selery7d / 7) * 10) / 10,
        avg_per_day_30d: Math.round((selery30d / 30) * 10) / 10,
        fulfilled_this_week: seleryInRange, // Uses selected period
        fulfilled_last_week: seleryPrevPeriod,
        week_over_week_change: Math.round(seleryPeriodChange * 10) / 10,
      },
    ];

    // Process daily fulfillments - restoration already filtered at query level
    const dailyData = dailyResult.data || [];
    const daily = processDailyFulfillments(dailyData);

    // Process weekly fulfillments (last 8 weeks)
    const weekly = processWeeklyFulfillments(dailyData);

    // Process order aging data - restoration already filtered at query level
    // This data is used for both queue health counts and the aging bar chart
    const agingData = agingDataResult.data || [];

    // Calculate queue health counts from filtered aging data (not raw count queries)
    // This ensures consistency with the order aging bar chart
    const nowMs = now.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const queueHealthCounts = {
      smithey: { waiting1d: 0, waiting3d: 0, waiting7d: 0 },
      selery: { waiting1d: 0, waiting3d: 0, waiting7d: 0 },
    };

    for (const order of agingData) {
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
    // Set oldest order for Smithey (restoration already filtered at query level)
    const excludedOrderNames = new Set(["S321703"]);
    const filteredSmitheyOrders = (oldestSmitheyResult.data || [])
      .filter((o: { order_name: string }) => !excludedOrderNames.has(o.order_name));
    const oldestSmithey = safeArrayAccess(filteredSmitheyOrders, 0);
    if (oldestSmithey) {
      const smitheyHealth = queueHealth.find(h => h.warehouse === "smithey");
      if (smitheyHealth) {
        const days = Math.floor((now.getTime() - new Date(oldestSmithey.created_at).getTime()) / (24 * 60 * 60 * 1000));
        smitheyHealth.oldest_order_days = days;
        smitheyHealth.oldest_order_name = oldestSmithey.order_name;
      }
    }

    // Set oldest order for Selery (restoration already filtered at query level)
    const oldestSelery = safeArrayAccess(oldestSeleryResult.data, 0);
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
    // Process stuck shipments - restoration already filtered at query level
    const stuckShipments = processStuckShipments(stuckShipmentsResult.data || [], now);

    // Process transit analytics - restoration already filtered at query level
    const transitAnalytics = processTransitAnalytics(transitDataResult.data || []);

    // Process daily orders for warehouse distribution - fetch with pagination to bypass 1000 row limit
    // Restoration orders filtered at query level
    const dailyOrdersData = await fetchAllPaginated<{ id: number; warehouse: string | null; created_at: string }>(
      supabase,
      "orders",
      "id, warehouse, created_at",
      [
        { column: "created_at", op: "gte", value: rangeStart.toISOString() },
        { column: "created_at", op: "lte", value: rangeEnd.toISOString() },
        { column: "canceled", op: "eq", value: false },
        { column: "is_restoration", op: "eq", value: false },
        { column: "warehouse", op: "not.is.null", value: null },
      ]
    );
    const dailyOrders = processDailyOrders(dailyOrdersData);

    // Process fulfillment lead time analytics - restoration already filtered at query level
    // Calculate midpoint of range for trend comparison
    const rangeMidpoint = new Date(rangeStart.getTime() + (rangeEnd.getTime() - rangeStart.getTime()) / 2);
    const fulfillmentLeadTime = processFulfillmentLeadTime(leadTimeResult.data || [], rangeMidpoint);

    // Process engraving queue from RPC result
    // RPC returns { total_units: number, order_count: number } directly
    const engravingRpcData = engravingQueueResult.data as { total_units: number; order_count: number } | null;
    const engravingQueue: EngravingQueue = engravingRpcData
      ? {
          total_units: engravingRpcData.total_units,
          estimated_days: Math.round((engravingRpcData.total_units / ENGRAVING_DAILY_CAPACITY) * 10) / 10,
          order_count: engravingRpcData.order_count,
          smithey_engraving_orders: engravingRpcData.order_count,
        }
      : { total_units: 0, estimated_days: 0, order_count: 0, smithey_engraving_orders: 0 };

    // Process order aging for bar chart - restoration already filtered at query level
    const orderAging = processOrderAging(agingData, now);

    // Calculate daily backlog (orders created - orders fulfilled)
    // Unfulfilled counts already exclude restoration orders at query level
    const currentUnfulfilled = smitheyUnfulfilled + seleryUnfulfilled + smitheyPartial + seleryPartial;
    const dailyBacklog = calculateDailyBacklog(dailyOrders, daily, currentUnfulfilled);

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

    // Cache for 2 minutes, stale-while-revalidate for 5 minutes
    // This reduces DB load significantly while keeping data reasonably fresh
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        "CDN-Cache-Control": "public, max-age=120",
        "Vercel-CDN-Cache-Control": "public, max-age=120",
      },
    });
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
// Uses Intl.DateTimeFormat to properly handle DST
function utcToEstDate(utcTimestamp: string): string {
  const date = new Date(utcTimestamp);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === "year")?.value || "2025";
  const month = parts.find(p => p.type === "month")?.value || "01";
  const day = parts.find(p => p.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function processWeeklyFulfillments(
  data: Array<{ warehouse: string | null; fulfilled_at: string | null; id?: number }>
): WeeklyFulfillment[] {
  const grouped = new Map<string, number>();

  // Use Intl.DateTimeFormat for proper DST-aware EST/EDT conversion
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  for (const row of data) {
    if (!row.warehouse || !row.fulfilled_at) continue;

    // Convert UTC to EST/EDT using Intl (handles DST correctly)
    const utcDate = new Date(row.fulfilled_at);
    const parts = estFormatter.formatToParts(utcDate);
    const year = parseInt(parts.find(p => p.type === "year")?.value || "2025");
    const month = parseInt(parts.find(p => p.type === "month")?.value || "1") - 1;
    const day = parseInt(parts.find(p => p.type === "day")?.value || "1");
    const weekday = parts.find(p => p.type === "weekday")?.value || "Mon";

    // Map weekday to day index (Mon=0, Sun=6 for Monday-based weeks)
    const weekdayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const dayIndex = weekdayMap[weekday] ?? 0;

    // Calculate Monday of this week
    const weekStart = new Date(year, month, day - dayIndex);
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

    // Get all states with data (for map visualization)
    const stateStats = Array.from(whData.byState.entries())
      .map(([state, data]) => ({
        state,
        avg_transit_days: Math.round((data.totalDays / data.count) * 10) / 10,
        shipment_count: data.count,
      }))
      .sort((a, b) => b.shipment_count - a.shipment_count);

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
    warehouse: string | null;
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

  // Query now filters to Smithey-only, so order_count = smithey_engraving_orders
  return {
    total_units: totalUnfulfilled,
    estimated_days: Math.round((totalUnfulfilled / ENGRAVING_DAILY_CAPACITY) * 10) / 10,
    order_count: orderIds.size,
    smithey_engraving_orders: orderIds.size,
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
