/**
 * Restoration Dashboard API
 *
 * Returns data for both Operations and Analytics views.
 *
 * KEY ARCHITECTURE:
 * - "restorations" array: ALL active items (for Operations Kanban)
 * - "current" stats: Current state metrics (STOCK - never filtered)
 * - "period" stats: Performance metrics (FLOW - filtered by shipped_at)
 * - "allTime" stats: Historical benchmarks (never filtered)
 * - "monthlyVolume": Trend chart data (respects period)
 *
 * Query params:
 * - periodStart: ISO date string - filters COMPLETED items by shipped_at >= this date
 *   Used for cycle time, SLA rate, throughput metrics
 *   Does NOT affect current state, active queue, or CS action items
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Restoration status values in workflow order
const STATUS_ORDER = [
  "pending_label",
  "label_sent",
  "in_transit_inbound",
  "delivered_warehouse",
  "received",
  "at_restoration",
  "ready_to_ship",
  "shipped",
  "delivered",
  "cancelled",
  "damaged", // Terminal status for damaged items
] as const;

type RestorationStatus = (typeof STATUS_ORDER)[number];

// Active statuses (in the pipeline, not terminal)
const ACTIVE_STATUSES: RestorationStatus[] = [
  "pending_label",
  "label_sent",
  "in_transit_inbound",
  "delivered_warehouse",
  "received",
  "at_restoration",
  "ready_to_ship",
];

// Pre-warehouse statuses (not yet at facility)
const PRE_WAREHOUSE_STATUSES: RestorationStatus[] = [
  "pending_label",
  "label_sent",
  "in_transit_inbound",
];

// Status display configuration
const STATUS_CONFIG: Record<RestorationStatus, { label: string; color: string }> = {
  pending_label: { label: "Pending Label", color: "slate" },
  label_sent: { label: "Label Sent", color: "amber" },
  in_transit_inbound: { label: "In Transit", color: "sky" },
  delivered_warehouse: { label: "Delivered", color: "orange" },
  received: { label: "Received", color: "emerald" },
  at_restoration: { label: "At Restoration", color: "purple" },
  ready_to_ship: { label: "Ready to Ship", color: "blue" },
  shipped: { label: "Shipped", color: "cyan" },
  delivered: { label: "Delivered to Customer", color: "green" },
  cancelled: { label: "Cancelled", color: "red" },
  damaged: { label: "Damaged", color: "rose" },
};

export interface RestorationRecord {
  id: number;
  order_id: number | null;
  aftership_return_id: string | null;
  rma_number: string | null;
  status: RestorationStatus;
  tag_numbers: string[]; // Array of tag numbers (replaces magnet_number as primary)
  magnet_number: string | null; // Legacy - kept for backward compatibility
  return_tracking_number: string | null;
  return_carrier: string | null;
  return_tracking_status: string | null;
  label_sent_at: string | null;
  customer_shipped_at: string | null;
  delivered_to_warehouse_at: string | null;
  received_at: string | null;
  sent_to_restoration_at: string | null;
  back_from_restoration_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  damaged_at: string | null; // When marked as damaged
  damage_reason: string | null; // Reason for damage: damaged_upon_arrival, damaged_internal, lost
  resolved_at: string | null; // When CS marked damaged item as resolved (NULL = needs CS attention)
  is_pos: boolean;
  notes: string | null;
  photos: string[];
  archived_at: string | null; // When set, hidden from ops board
  created_at: string;
  updated_at: string;
  order_name: string | null;
  order_created_at: string;
  shopify_order_id: number | null;
  customer_email: string | null;
  days_in_status: number;
  total_days: number;
}

// ============================================================================
// RESPONSE TYPES - Clear separation of concerns
// ============================================================================

/** Current state metrics - STOCK metrics, never filtered by date */
export interface CurrentStats {
  activeQueue: number;
  preWarehouse: number;
  inHouse: number;
  overdueCount: number; // Active items past 21 days
  byStatus: Record<RestorationStatus, number>;
}

/** Period performance metrics - FLOW metrics, filtered by shipped_at */
export interface PeriodStats {
  completed: number;
  medianCycleTime: number; // Total: order_created → shipped (for reference)
  avgCycleTime: number;
  // Internal cycle = (delivered_to_warehouse_at OR received_at) → shipped_at (what Smithey controls)
  internalMedian: number;
  internalAvg: number;
  slaRate: number; // % completing internal cycle within 21 days
  meetingSLA: number;
  d2cInternalMedian: number;
  posInternalMedian: number;
  // Internal cycle breakdown
  internalCycle: {
    receivedToRestoration: number;
    atRestoration: number;
    restorationToShipped: number;
    totalInternal: number;
  };
}

/** All-time benchmarks - never filtered */
export interface AllTimeStats {
  totalProcessed: number;
  completedCount: number;
  cancelledCount: number;
  completionRate: number;
  avgCycleTime: number;
  oldestActiveDate: string | null;
}

export interface RestorationStats {
  current: CurrentStats;
  period: PeriodStats;
  allTime: AllTimeStats;
  monthlyVolume: Array<{
    month: string;
    created: number;
    completed: number;
  }>;
  internalCycleTrend: Array<{
    month: string;
    medianDays: number;
    count: number;
    exceededSLA: number; // Count of items that took >21 days
  }>;
}

export interface RestorationResponse {
  restorations: RestorationRecord[];
  stats: RestorationStats;
  statusConfig: typeof STATUS_CONFIG;
  statusOrder: typeof STATUS_ORDER;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate median of an array of numbers
 * Returns 0 for empty arrays (safe default for division/display)
 * Note: We return 0 instead of null to avoid breaking existing API contracts
 * and TypeScript types. UI should handle 0 as "no data" when count is also 0.
 */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function computeCycleTime(orderCreatedAt: string, shippedAt: string | null): number | null {
  if (!shippedAt) return null;
  const days = Math.floor(
    (new Date(shippedAt).getTime() - new Date(orderCreatedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  return days >= 0 ? days : null;
}

/**
 * Get the start date for internal cycle (when Smithey becomes responsible)
 * - POS orders: Clock starts at order creation (immediate possession)
 * - Regular orders: Clock starts at courier delivery (delivered_to_warehouse_at)
 *   Fallback to received_at (manual check-in) if no courier data
 */
function getInternalStartDate(
  deliveredAt: string | null,
  receivedAt: string | null,
  isPOS?: boolean,
  createdAt?: string | null
): string | null {
  // POS orders start the clock at order creation (Smithey has immediate possession)
  if (isPOS && createdAt) {
    return createdAt;
  }
  // Regular orders: courier delivery > manual check-in
  return deliveredAt || receivedAt;
}

/** Internal cycle: internal_start → shipped_at (what Smithey controls) */
function computeInternalCycleTime(
  deliveredAt: string | null,
  receivedAt: string | null,
  shippedAt: string | null,
  isPOS?: boolean,
  createdAt?: string | null
): number | null {
  const startDate = getInternalStartDate(deliveredAt, receivedAt, isPOS, createdAt);
  if (!startDate || !shippedAt) return null;
  const days = Math.floor(
    (new Date(shippedAt).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  return days >= 0 ? days : null;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    const periodStart = searchParams.get("periodStart");
    const includeArchived = searchParams.get("includeArchived") === "true";

    const periodStartDate = periodStart ? new Date(periodStart) : null;

    // =========================================================================
    // FETCH RESTORATIONS
    // - Default: excludes archived items (for ops board)
    // - With includeArchived=true: returns all (for analytics)
    // =========================================================================
    let query = supabase
      .from("restorations")
      .select(`
        id,
        order_id,
        aftership_return_id,
        rma_number,
        status,
        tag_numbers,
        magnet_number,
        return_tracking_number,
        return_carrier,
        return_tracking_status,
        label_sent_at,
        customer_shipped_at,
        delivered_to_warehouse_at,
        received_at,
        sent_to_restoration_at,
        back_from_restoration_at,
        shipped_at,
        delivered_at,
        damaged_at,
        damage_reason,
        resolved_at,
        is_pos,
        notes,
        photos,
        archived_at,
        created_at,
        updated_at,
        orders!left (
          id,
          order_name,
          created_at,
          canceled,
          archived,
          fulfillment_status,
          shopify_customer_id
        )
      `);

    // Only filter out archived items for ops board (default behavior)
    if (!includeArchived) {
      query = query.is("archived_at", null);
    }

    const { data: restorations, error: restorationsError } = await query.order("created_at", { ascending: false });

    if (restorationsError) {
      console.error("[RESTORATIONS API] Error:", restorationsError);
      return NextResponse.json({ error: "Failed to fetch restorations" }, { status: 500 });
    }

    // =========================================================================
    // FETCH CUSTOMER EMAILS (for CS callouts)
    // =========================================================================
    const customerIds = new Set<number>();
    for (const r of restorations || []) {
      const ordersRaw = r.orders as unknown;
      const orderData = (Array.isArray(ordersRaw) ? ordersRaw[0] : ordersRaw) as
        { shopify_customer_id: number | null } | null;
      if (orderData?.shopify_customer_id) {
        customerIds.add(orderData.shopify_customer_id);
      }
    }

    const customerEmailMap = new Map<number, string>();
    if (customerIds.size > 0) {
      const { data: customers } = await supabase
        .from("shopify_customers")
        .select("shopify_customer_id, email")
        .in("shopify_customer_id", Array.from(customerIds));

      for (const c of customers || []) {
        if (c.email) customerEmailMap.set(c.shopify_customer_id, c.email);
      }
    }

    // =========================================================================
    // TRANSFORM RESTORATIONS
    // =========================================================================
    const now = new Date();
    const transformedRestorations: RestorationRecord[] = (restorations || []).map((r) => {
      const statusTimestamps: Record<RestorationStatus, string | null> = {
        pending_label: r.created_at,
        label_sent: r.label_sent_at,
        in_transit_inbound: r.customer_shipped_at,
        delivered_warehouse: r.delivered_to_warehouse_at,
        received: r.received_at,
        at_restoration: r.sent_to_restoration_at,
        ready_to_ship: r.back_from_restoration_at,
        shipped: r.shipped_at,
        delivered: r.delivered_at,
        cancelled: null,
        damaged: r.damaged_at,
      };

      const currentStatusTimestamp = statusTimestamps[r.status as RestorationStatus];
      const daysInStatus = currentStatusTimestamp
        ? Math.floor((now.getTime() - new Date(currentStatusTimestamp).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      const ordersRaw = r.orders as unknown;
      const orderData = (Array.isArray(ordersRaw) ? ordersRaw[0] : ordersRaw) as
        { id: number; order_name: string; created_at: string; canceled: boolean; archived: boolean; fulfillment_status: string | null; shopify_customer_id: number | null } | null;

      const orderCreatedAt = orderData?.created_at || r.created_at;
      const totalDays = Math.floor(
        (now.getTime() - new Date(orderCreatedAt).getTime()) / (1000 * 60 * 60 * 24)
      );

      const customerEmail = orderData?.shopify_customer_id
        ? customerEmailMap.get(orderData.shopify_customer_id) || null
        : null;

      return {
        id: r.id,
        order_id: r.order_id,
        aftership_return_id: r.aftership_return_id,
        rma_number: r.rma_number,
        status: r.status as RestorationStatus,
        tag_numbers: r.tag_numbers || [],
        magnet_number: r.magnet_number,
        return_tracking_number: r.return_tracking_number,
        return_carrier: r.return_carrier,
        return_tracking_status: r.return_tracking_status,
        label_sent_at: r.label_sent_at,
        customer_shipped_at: r.customer_shipped_at,
        delivered_to_warehouse_at: r.delivered_to_warehouse_at,
        received_at: r.received_at,
        sent_to_restoration_at: r.sent_to_restoration_at,
        back_from_restoration_at: r.back_from_restoration_at,
        shipped_at: r.shipped_at,
        delivered_at: r.delivered_at,
        damaged_at: r.damaged_at,
        damage_reason: r.damage_reason,
        resolved_at: r.resolved_at,
        is_pos: r.is_pos || false,
        notes: r.notes,
        photos: r.photos || [],
        archived_at: r.archived_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        order_name: orderData?.order_name || null,
        order_created_at: orderCreatedAt,
        shopify_order_id: orderData?.id || null,
        customer_email: customerEmail,
        days_in_status: daysInStatus,
        total_days: totalDays,
        _orderCanceled: orderData?.canceled || false,
        _orderArchived: orderData?.archived || false,
        _orderFulfillmentStatus: orderData?.fulfillment_status || null,
      };
    })
    .filter(r => {
      // Keep terminal statuses regardless of order status (for analytics)
      if (r.status === "cancelled" || r.status === "damaged") return true;

      // Keep shipped/delivered for analytics - these are completed restorations
      if (r.status === "shipped" || r.status === "delivered") return true;

      // POS items don't have Shopify orders - always keep them
      if (r.is_pos) return true;

      // Shopify order checks - only filter ACTIVE items based on order status
      const orderCanceled = (r as { _orderCanceled?: boolean })._orderCanceled;
      const orderArchived = (r as { _orderArchived?: boolean })._orderArchived;
      const orderFulfillmentStatus = (r as { _orderFulfillmentStatus?: string | null })._orderFulfillmentStatus;

      // Filter out if order was cancelled
      if (orderCanceled) return false;

      // Filter out if order was archived
      if (orderArchived) return false;

      // Filter out if order was fulfilled (completed) - only for active items
      if (orderFulfillmentStatus === 'fulfilled') return false;

      return true;
    })
    .map(({ _orderCanceled, _orderArchived, _orderFulfillmentStatus, ...rest }) => rest as RestorationRecord);

    // =========================================================================
    // COMPUTE CURRENT STATE METRICS (STOCK - never filtered)
    // =========================================================================
    const activeRestorations = transformedRestorations.filter(r =>
      ACTIVE_STATUSES.includes(r.status)
    );
    const preWarehouseRestorations = transformedRestorations.filter(r =>
      PRE_WAREHOUSE_STATUSES.includes(r.status)
    );
    // Overdue = items where Smithey is responsible AND internal time > 21 days
    // POS: from order creation (order_created_at). Regular: from courier delivery (or manual check-in)
    const overdueRestorations = activeRestorations.filter(r => {
      const internalStart = getInternalStartDate(r.delivered_to_warehouse_at, r.received_at, r.is_pos, r.order_created_at);
      if (!internalStart) return false; // Not our responsibility yet
      const internalDays = Math.floor(
        (now.getTime() - new Date(internalStart).getTime()) / (1000 * 60 * 60 * 24)
      );
      return internalDays > 21;
    });

    const byStatus: Record<RestorationStatus, number> = Object.fromEntries(
      STATUS_ORDER.map((status) => [status, 0])
    ) as Record<RestorationStatus, number>;
    for (const r of transformedRestorations) {
      byStatus[r.status]++;
    }

    const current: CurrentStats = {
      activeQueue: activeRestorations.length,
      preWarehouse: preWarehouseRestorations.length,
      inHouse: activeRestorations.length - preWarehouseRestorations.length,
      overdueCount: overdueRestorations.length,
      byStatus,
    };

    // =========================================================================
    // COMPUTE PERIOD METRICS (FLOW - filter completed by shipped_at)
    // =========================================================================
    const allCompleted = transformedRestorations.filter(
      r => r.status === "shipped" || r.status === "delivered"
    );

    // Filter completed restorations by shipped_at if periodStart provided
    const periodCompleted = periodStartDate
      ? allCompleted.filter(r => r.shipped_at && new Date(r.shipped_at) >= periodStartDate)
      : allCompleted;

    // Total cycle times (order_created → shipped) for reference
    const periodCycleTimes = periodCompleted
      .map(r => computeCycleTime(r.order_created_at, r.shipped_at))
      .filter((d): d is number => d !== null);

    // INTERNAL cycle times - what Smithey controls
    // POS: from order creation (order_created_at). Regular: from courier delivery (or manual check-in)
    const periodInternalCycleTimes = periodCompleted
      .map(r => computeInternalCycleTime(r.delivered_to_warehouse_at, r.received_at, r.shipped_at, r.is_pos, r.order_created_at))
      .filter((d): d is number => d !== null);

    const d2cInternalCycleTimes = periodCompleted
      .filter(r => !r.is_pos)
      .map(r => computeInternalCycleTime(r.delivered_to_warehouse_at, r.received_at, r.shipped_at, r.is_pos, r.order_created_at))
      .filter((d): d is number => d !== null);

    const posInternalCycleTimes = periodCompleted
      .filter(r => r.is_pos)
      .map(r => computeInternalCycleTime(r.delivered_to_warehouse_at, r.received_at, r.shipped_at, r.is_pos, r.order_created_at))
      .filter((d): d is number => d !== null);

    // SLA is based on INTERNAL cycle (what we control) - 21 days from received to shipped
    const meetingSLA = periodInternalCycleTimes.filter(d => d <= 21).length;

    // Internal cycle for period completions
    const periodInternalTimes = {
      receivedToRestoration: [] as number[],
      atRestoration: [] as number[],
      restorationToShipped: [] as number[],
      totalInternal: [] as number[],
    };

    for (const r of periodCompleted) {
      const internalStart = getInternalStartDate(r.delivered_to_warehouse_at, r.received_at, r.is_pos, r.order_created_at);

      // receivedToRestoration: from internal start to sent out
      if (internalStart && r.sent_to_restoration_at) {
        const days = Math.floor(
          (new Date(r.sent_to_restoration_at).getTime() - new Date(internalStart).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days >= 0) periodInternalTimes.receivedToRestoration.push(days);
      }
      if (r.sent_to_restoration_at && r.back_from_restoration_at) {
        const days = Math.floor(
          (new Date(r.back_from_restoration_at).getTime() - new Date(r.sent_to_restoration_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days >= 0) periodInternalTimes.atRestoration.push(days);
      }
      if (r.back_from_restoration_at && r.shipped_at) {
        const days = Math.floor(
          (new Date(r.shipped_at).getTime() - new Date(r.back_from_restoration_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days >= 0) periodInternalTimes.restorationToShipped.push(days);
      }
      // totalInternal: from internal start (delivered or received) to shipped
      if (internalStart && r.shipped_at) {
        const days = Math.floor(
          (new Date(r.shipped_at).getTime() - new Date(internalStart).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days >= 0) periodInternalTimes.totalInternal.push(days);
      }
    }

    const period: PeriodStats = {
      completed: periodCompleted.length,
      // Total cycle (order_created → shipped) for reference
      medianCycleTime: median(periodCycleTimes),
      avgCycleTime: periodCycleTimes.length > 0
        ? Math.round(periodCycleTimes.reduce((a, b) => a + b, 0) / periodCycleTimes.length)
        : 0,
      // Internal cycle (received → shipped) - what Smithey controls
      internalMedian: median(periodInternalCycleTimes),
      internalAvg: periodInternalCycleTimes.length > 0
        ? Math.round(periodInternalCycleTimes.reduce((a, b) => a + b, 0) / periodInternalCycleTimes.length)
        : 0,
      // SLA based on internal cycle
      slaRate: periodInternalCycleTimes.length > 0
        ? Math.round((meetingSLA / periodInternalCycleTimes.length) * 100)
        : 0,
      meetingSLA,
      d2cInternalMedian: median(d2cInternalCycleTimes),
      posInternalMedian: median(posInternalCycleTimes),
      // Internal cycle breakdown
      internalCycle: {
        receivedToRestoration: median(periodInternalTimes.receivedToRestoration),
        atRestoration: median(periodInternalTimes.atRestoration),
        restorationToShipped: median(periodInternalTimes.restorationToShipped),
        totalInternal: median(periodInternalTimes.totalInternal),
      },
    };

    // =========================================================================
    // COMPUTE ALL-TIME METRICS (BENCHMARK - never filtered)
    // =========================================================================
    const allCycleTimes = allCompleted
      .map(r => computeCycleTime(r.order_created_at, r.shipped_at))
      .filter((d): d is number => d !== null);

    const cancelledCount = transformedRestorations.filter(r => r.status === "cancelled").length;
    const oldestActive = activeRestorations.length > 0
      ? activeRestorations.reduce((oldest, r) =>
          new Date(r.order_created_at) < new Date(oldest.order_created_at) ? r : oldest
        )
      : null;

    // Completion rate = success rate of TERMINAL items (completed vs cancelled)
    const terminalCount = allCompleted.length + cancelledCount;

    const allTime: AllTimeStats = {
      totalProcessed: transformedRestorations.length,
      completedCount: allCompleted.length,
      cancelledCount,
      // Success rate: of all terminal restorations, what % were completed (not cancelled)
      completionRate: terminalCount > 0
        ? Math.round((allCompleted.length / terminalCount) * 100)
        : 0,
      avgCycleTime: allCycleTimes.length > 0
        ? Math.round(allCycleTimes.reduce((a, b) => a + b, 0) / allCycleTimes.length)
        : 0,
      oldestActiveDate: oldestActive?.order_created_at || null,
    };

    // =========================================================================
    // COMPUTE MONTHLY VOLUME (respects period for chart display)
    // =========================================================================
    // Determine how many months to show based on period or actual data range
    let monthsToShow: number;
    if (periodStartDate) {
      monthsToShow = Math.min(36, Math.ceil((now.getTime() - periodStartDate.getTime()) / (1000 * 60 * 60 * 24 * 30)));
    } else {
      // "All" mode - find oldest shipped restoration to determine range
      const oldestShipped = allCompleted.reduce((oldest, r) => {
        if (!r.shipped_at) return oldest;
        return !oldest || new Date(r.shipped_at) < new Date(oldest) ? r.shipped_at : oldest;
      }, null as string | null);
      if (oldestShipped) {
        monthsToShow = Math.min(36, Math.ceil((now.getTime() - new Date(oldestShipped).getTime()) / (1000 * 60 * 60 * 24 * 30)));
      } else {
        monthsToShow = 6; // fallback
      }
    }

    const monthlyVolume: Array<{ month: string; created: number; completed: number }> = [];
    for (let i = Math.max(5, monthsToShow - 1); i >= 0; i--) {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() - i);
      const monthStr = monthDate.toISOString().slice(0, 7);

      // Skip months before periodStart
      if (periodStartDate) {
        const monthStart = new Date(monthStr + "-01");
        if (monthStart < periodStartDate) continue;
      }

      const created = transformedRestorations.filter(r =>
        r.order_created_at?.startsWith(monthStr)
      ).length;

      const completed = allCompleted.filter(r =>
        r.shipped_at?.startsWith(monthStr)
      ).length;

      monthlyVolume.push({ month: monthStr, created, completed });
    }

    // =========================================================================
    // COMPUTE INTERNAL CYCLE TREND (respects period)
    // =========================================================================
    const internalCycleTrend: Array<{ month: string; medianDays: number; count: number; exceededSLA: number }> = [];
    for (let i = Math.max(5, monthsToShow - 1); i >= 0; i--) {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() - i);
      const monthStr = monthDate.toISOString().slice(0, 7);

      if (periodStartDate) {
        const monthStart = new Date(monthStr + "-01");
        if (monthStart < periodStartDate) continue;
      }

      // For median: items that STARTED in this month (cohort tracking)
      // Shows "what happened to items that came in during month X?"
      const monthCompletions = allCompleted.filter(r => {
        const internalStart = getInternalStartDate(r.delivered_to_warehouse_at, r.received_at, r.is_pos, r.order_created_at);
        return internalStart?.startsWith(monthStr);
      });

      const monthInternalTimes = monthCompletions.map(r => {
        const internalStart = getInternalStartDate(r.delivered_to_warehouse_at, r.received_at, r.is_pos, r.order_created_at);
        const days = Math.floor(
          (new Date(r.shipped_at!).getTime() - new Date(internalStart!).getTime()) / (1000 * 60 * 60 * 24)
        );
        return days >= 0 ? days : null;
      }).filter((d): d is number => d !== null);

      // For exceeded SLA: items where Smithey became responsible in this month (cohort tracking)
      // Anchor on internal start date (POS: order creation, Regular: courier delivery)
      const monthReceipts = transformedRestorations.filter(r => {
        const internalStart = getInternalStartDate(r.delivered_to_warehouse_at, r.received_at, r.is_pos, r.order_created_at);
        return internalStart?.startsWith(monthStr);
      });

      const exceededSLA = monthReceipts.filter(r => {
        const internalStart = getInternalStartDate(r.delivered_to_warehouse_at, r.received_at, r.is_pos, r.order_created_at);
        if (!internalStart) return false;

        if (r.shipped_at) {
          // Completed - check actual internal cycle time
          const internalDays = Math.floor(
            (new Date(r.shipped_at).getTime() - new Date(internalStart).getTime()) / (1000 * 60 * 60 * 24)
          );
          return internalDays > 21;
        } else if (ACTIVE_STATUSES.includes(r.status)) {
          // Still active - check if already overdue
          const daysSinceStart = Math.floor(
            (now.getTime() - new Date(internalStart).getTime()) / (1000 * 60 * 60 * 24)
          );
          return daysSinceStart > 21;
        }
        return false;
      }).length;

      internalCycleTrend.push({
        month: monthStr,
        medianDays: median(monthInternalTimes),
        count: monthInternalTimes.length,
        exceededSLA,
      });
    }

    // =========================================================================
    // BUILD RESPONSE
    // =========================================================================
    const stats: RestorationStats = {
      current,
      period,
      allTime,
      monthlyVolume,
      internalCycleTrend,
    };

    const response: RestorationResponse = {
      restorations: transformedRestorations,
      stats,
      statusConfig: STATUS_CONFIG,
      statusOrder: STATUS_ORDER,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[RESTORATIONS API] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
