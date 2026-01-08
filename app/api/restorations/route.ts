/**
 * Restoration Dashboard API
 *
 * Fetches restoration tracking data for the pipeline view.
 * Returns restorations grouped by status with order details.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

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
] as const;

type RestorationStatus = (typeof STATUS_ORDER)[number];

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
};

export interface RestorationRecord {
  id: number;
  order_id: number | null;
  aftership_return_id: string | null;
  rma_number: string | null;
  status: RestorationStatus;
  magnet_number: string | null;
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
  is_pos: boolean;
  notes: string | null;
  photos: string[]; // Array of Supabase Storage URLs (max 3)
  created_at: string;
  updated_at: string;
  // Joined order data
  order_name: string | null;
  order_created_at: string;
  shopify_order_id: number | null; // For Shopify admin links
  customer_email: string | null; // For CS callouts
  days_in_status: number;
  total_days: number;
}

export interface RestorationStats {
  total: number;
  active: number;
  byStatus: Record<RestorationStatus, number>;
  avgDaysInStage: Record<RestorationStatus, number>;
  alerts: {
    deliveredNotReceived: number;
    atRestorationTooLong: number;
    timeoutCandidates: number;
  };
  // Cycle time analytics
  cycleTime: {
    completed: number; // Total shipped/delivered
    medianDays: number; // Median cycle time for completed
    avgDays: number; // Average cycle time for completed
    meetingSLA: number; // Count meeting 21-day target
    slaRate: number; // % meeting SLA
    d2cMedian: number; // D2C median
    posMedian: number; // POS median
  };
  // All-time analytics
  allTime: {
    totalEver: number;
    completedEver: number;
    cancelledEver: number;
    completionRate: number;
    avgCycleTime: number;
    oldestActiveDate: string | null;
  };
  // Monthly volume (last 6 months)
  monthlyVolume: Array<{
    month: string;
    created: number;
    completed: number;
    cancelled: number;
  }>;
  // Internal cycle time breakdown (YOUR time - received to shipped)
  internalCycle: {
    // Stage durations (median days)
    receivedToRestoration: number; // How long to send out
    atRestoration: number; // Time with restoration crew
    restorationToShipped: number; // How long to ship after back
    totalInternal: number; // received_at → shipped_at (what YOU control)
    // Monthly trend of internal cycle time
    monthlyTrend: Array<{
      month: string;
      medianDays: number;
      count: number;
    }>;
  };
}

export interface RestorationResponse {
  restorations: RestorationRecord[];
  stats: RestorationStats;
  statusConfig: typeof STATUS_CONFIG;
  statusOrder: typeof STATUS_ORDER;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Fetch all active restorations with order details and customer email
    const { data: restorations, error: restorationsError } = await supabase
      .from("restorations")
      .select(`
        id,
        order_id,
        aftership_return_id,
        rma_number,
        status,
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
        is_pos,
        notes,
        photos,
        created_at,
        updated_at,
        orders!left (
          id,
          order_name,
          created_at,
          canceled,
          shopify_customer_id
        )
      `)
      .order("created_at", { ascending: false });

    // Fetch customer emails for CS callouts
    const customerIds = new Set<number>();
    for (const r of restorations || []) {
      const ordersRaw = r.orders as unknown;
      const orderData = (Array.isArray(ordersRaw) ? ordersRaw[0] : ordersRaw) as
        { shopify_customer_id: number | null } | null;
      if (orderData?.shopify_customer_id) {
        customerIds.add(orderData.shopify_customer_id);
      }
    }

    // Batch fetch customer emails
    const customerEmailMap = new Map<number, string>();
    if (customerIds.size > 0) {
      const { data: customers } = await supabase
        .from("shopify_customers")
        .select("shopify_customer_id, email")
        .in("shopify_customer_id", Array.from(customerIds));

      for (const c of customers || []) {
        if (c.email) {
          customerEmailMap.set(c.shopify_customer_id, c.email);
        }
      }
    }

    if (restorationsError) {
      console.error("[RESTORATIONS API] Error fetching restorations:", restorationsError);
      return NextResponse.json(
        { error: "Failed to fetch restorations" },
        { status: 500 }
      );
    }

    // Transform and compute derived fields
    const now = new Date();
    const transformedRestorations: RestorationRecord[] = (restorations || []).map((r) => {
      // Get the timestamp for current status to compute days in status
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
      };

      const currentStatusTimestamp = statusTimestamps[r.status as RestorationStatus];
      const daysInStatus = currentStatusTimestamp
        ? Math.floor((now.getTime() - new Date(currentStatusTimestamp).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Handle joined order data - Supabase returns as object for !left joins
      // Cast through unknown to handle TypeScript's strict array/object typing
      const ordersRaw = r.orders as unknown;
      const orderData = (Array.isArray(ordersRaw) ? ordersRaw[0] : ordersRaw) as
        { id: number; order_name: string; created_at: string; canceled: boolean; shopify_customer_id: number | null } | null;

      // Use order's created_at for accurate cycle time (not restoration backfill date)
      const orderCreatedAt = orderData?.created_at || r.created_at;
      const totalDaysFromOrder = Math.floor(
        (now.getTime() - new Date(orderCreatedAt).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Get customer email from map
      const customerEmail = orderData?.shopify_customer_id
        ? customerEmailMap.get(orderData.shopify_customer_id) || null
        : null;

      return {
        id: r.id,
        order_id: r.order_id,
        aftership_return_id: r.aftership_return_id,
        rma_number: r.rma_number,
        status: r.status as RestorationStatus,
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
        is_pos: r.is_pos || false,
        notes: r.notes,
        photos: r.photos || [],
        created_at: r.created_at,
        updated_at: r.updated_at,
        order_name: orderData?.order_name || null,
        order_created_at: orderCreatedAt,
        shopify_order_id: orderData?.id || null,
        customer_email: customerEmail,
        days_in_status: daysInStatus,
        total_days: totalDaysFromOrder,
        _orderCanceled: orderData?.canceled || false, // Internal flag for filtering
      };
    })
    // Safety filter: exclude any restoration whose Shopify order is cancelled
    // (even if restoration status wasn't updated)
    .filter(r => {
      // Keep all restorations in cancelled status (those are correctly marked)
      if (r.status === "cancelled") return true;
      // Exclude active restorations where the Shopify order is cancelled
      return !(r as { _orderCanceled?: boolean })._orderCanceled;
    })
    // Remove internal field before returning
    .map(({ _orderCanceled, ...rest }) => rest as RestorationRecord);

    // Compute stats
    const byStatus: Record<RestorationStatus, number> = Object.fromEntries(
      STATUS_ORDER.map((status) => [status, 0])
    ) as Record<RestorationStatus, number>;

    const daysInStageSum: Record<RestorationStatus, number> = Object.fromEntries(
      STATUS_ORDER.map((status) => [status, 0])
    ) as Record<RestorationStatus, number>;

    const daysInStageCount: Record<RestorationStatus, number> = Object.fromEntries(
      STATUS_ORDER.map((status) => [status, 0])
    ) as Record<RestorationStatus, number>;

    let deliveredNotReceived = 0;
    let atRestorationTooLong = 0;
    let timeoutCandidates = 0;

    for (const r of transformedRestorations) {
      byStatus[r.status]++;
      daysInStageSum[r.status] += r.days_in_status;
      daysInStageCount[r.status]++;

      // Alerts
      if (r.status === "delivered_warehouse" && r.days_in_status > 2) {
        deliveredNotReceived++;
      }
      if (r.status === "at_restoration" && r.days_in_status > 14) {
        atRestorationTooLong++;
      }
      if (r.total_days > 56 && !["shipped", "delivered", "cancelled"].includes(r.status)) {
        timeoutCandidates++;
      }
    }

    const avgDaysInStage: Record<RestorationStatus, number> = Object.fromEntries(
      STATUS_ORDER.map((status) => [
        status,
        daysInStageCount[status] > 0
          ? Math.round(daysInStageSum[status] / daysInStageCount[status])
          : 0,
      ])
    ) as Record<RestorationStatus, number>;

    const activeStatuses: RestorationStatus[] = [
      "pending_label",
      "label_sent",
      "in_transit_inbound",
      "delivered_warehouse",
      "received",
      "at_restoration",
      "ready_to_ship",
    ];

    // Compute cycle time for completed restorations
    const completedRestorations = transformedRestorations.filter(
      (r) => r.status === "shipped" || r.status === "delivered"
    );

    const cycleTimes = completedRestorations.map((r) => {
      // Cycle time = shipped_at - order_created_at (actual order date, not backfill date)
      const start = r.order_created_at;
      const end = r.shipped_at || r.delivered_at;
      if (!start || !end) return null;
      return Math.floor(
        (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
      );
    }).filter((d): d is number => d !== null);

    const d2cCycleTimes = completedRestorations
      .filter((r) => !r.is_pos)
      .map((r) => {
        const start = r.order_created_at;
        const end = r.shipped_at || r.delivered_at;
        if (!start || !end) return null;
        return Math.floor(
          (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
        );
      }).filter((d): d is number => d !== null);

    const posCycleTimes = completedRestorations
      .filter((r) => r.is_pos)
      .map((r) => {
        const start = r.order_created_at;
        const end = r.shipped_at || r.delivered_at;
        if (!start || !end) return null;
        return Math.floor(
          (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
        );
      }).filter((d): d is number => d !== null);

    // Helper to compute median
    const median = (arr: number[]): number => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };

    const meetingSLA = cycleTimes.filter((d) => d <= 21).length;

    // Compute monthly volume (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyVolume: RestorationStats["monthlyVolume"] = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() - i);
      const monthStr = monthDate.toISOString().slice(0, 7); // YYYY-MM

      // Use order_created_at (actual order date) not created_at (record insertion date)
      // This prevents backfilled historical data from skewing monthly volume
      const created = transformedRestorations.filter((r) =>
        r.order_created_at?.startsWith(monthStr)
      ).length;

      const completed = transformedRestorations.filter((r) =>
        (r.status === "shipped" || r.status === "delivered") &&
        (r.shipped_at?.startsWith(monthStr) || r.delivered_at?.startsWith(monthStr))
      ).length;

      const cancelled = transformedRestorations.filter((r) =>
        r.status === "cancelled" && r.updated_at?.startsWith(monthStr)
      ).length;

      monthlyVolume.push({
        month: monthStr,
        created,
        completed,
        cancelled,
      });
    }

    // All-time analytics
    const cancelledRestorations = transformedRestorations.filter(r => r.status === "cancelled");
    const totalEver = transformedRestorations.length;
    const completedEver = completedRestorations.length;
    const cancelledEver = cancelledRestorations.length;
    const completionRate = totalEver > 0 ? Math.round((completedEver / totalEver) * 100) : 0;

    // Find oldest active restoration
    const activeRestorations = transformedRestorations.filter(r => activeStatuses.includes(r.status));
    const oldestActive = activeRestorations.length > 0
      ? activeRestorations.reduce((oldest, r) =>
          new Date(r.order_created_at) < new Date(oldest.order_created_at) ? r : oldest
        )
      : null;

    // =========================================================================
    // INTERNAL CYCLE TIME - The time YOU control (received → shipped)
    // =========================================================================

    // Get raw restoration data for internal timing (need the timestamps)
    const { data: rawRestorations } = await supabase
      .from("restorations")
      .select("received_at, sent_to_restoration_at, back_from_restoration_at, shipped_at")
      .in("status", ["shipped", "delivered"]);

    // Compute stage durations for completed items
    const stageDurations = {
      receivedToRestoration: [] as number[],
      atRestoration: [] as number[],
      restorationToShipped: [] as number[],
      totalInternal: [] as number[],
    };

    for (const r of rawRestorations || []) {
      if (r.received_at && r.sent_to_restoration_at) {
        const days = Math.floor(
          (new Date(r.sent_to_restoration_at).getTime() - new Date(r.received_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days >= 0) stageDurations.receivedToRestoration.push(days);
      }
      if (r.sent_to_restoration_at && r.back_from_restoration_at) {
        const days = Math.floor(
          (new Date(r.back_from_restoration_at).getTime() - new Date(r.sent_to_restoration_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days >= 0) stageDurations.atRestoration.push(days);
      }
      if (r.back_from_restoration_at && r.shipped_at) {
        const days = Math.floor(
          (new Date(r.shipped_at).getTime() - new Date(r.back_from_restoration_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days >= 0) stageDurations.restorationToShipped.push(days);
      }
      if (r.received_at && r.shipped_at) {
        const days = Math.floor(
          (new Date(r.shipped_at).getTime() - new Date(r.received_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (days >= 0) stageDurations.totalInternal.push(days);
      }
    }

    // Compute monthly trend of internal cycle time
    const monthlyInternalTrend: Array<{ month: string; medianDays: number; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() - i);
      const monthStr = monthDate.toISOString().slice(0, 7);

      const monthCompletions = (rawRestorations || []).filter(r =>
        r.shipped_at?.startsWith(monthStr) && r.received_at
      );

      const monthInternalTimes = monthCompletions.map(r => {
        const days = Math.floor(
          (new Date(r.shipped_at!).getTime() - new Date(r.received_at!).getTime()) / (1000 * 60 * 60 * 24)
        );
        return days >= 0 ? days : null;
      }).filter((d): d is number => d !== null);

      monthlyInternalTrend.push({
        month: monthStr,
        medianDays: median(monthInternalTimes),
        count: monthInternalTimes.length,
      });
    }

    const internalCycle = {
      receivedToRestoration: median(stageDurations.receivedToRestoration),
      atRestoration: median(stageDurations.atRestoration),
      restorationToShipped: median(stageDurations.restorationToShipped),
      totalInternal: median(stageDurations.totalInternal),
      monthlyTrend: monthlyInternalTrend,
    };

    const stats: RestorationStats = {
      total: transformedRestorations.length,
      active: activeRestorations.length,
      byStatus,
      avgDaysInStage,
      alerts: {
        deliveredNotReceived,
        atRestorationTooLong,
        timeoutCandidates,
      },
      cycleTime: {
        completed: completedRestorations.length,
        medianDays: median(cycleTimes),
        avgDays: cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) : 0,
        meetingSLA,
        slaRate: cycleTimes.length > 0 ? Math.round((meetingSLA / cycleTimes.length) * 100) : 0,
        d2cMedian: median(d2cCycleTimes),
        posMedian: median(posCycleTimes),
      },
      allTime: {
        totalEver,
        completedEver,
        cancelledEver,
        completionRate,
        avgCycleTime: cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) : 0,
        oldestActiveDate: oldestActive?.order_created_at || null,
      },
      monthlyVolume,
      internalCycle,
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
