"use client";

import { Package, Truck, TrendingUp } from "lucide-react";
import type { MetricsResponse } from "@/lib/types";
import { formatNumber } from "@/lib/dashboard-utils";
import { USTransitMap } from "@/components/USTransitMap";
import { BacklogTrend } from "@/components/fulfillment/BacklogTrend";
import { LeadTimeTrend } from "@/components/fulfillment/LeadTimeTrend";
import { FulfillmentTrend } from "@/components/fulfillment/FulfillmentTrend";

// ============================================================================
// MAIN COMPONENT - ANALYSIS VIEW
// ============================================================================

interface FulfillmentTrackingProps {
  metrics: MetricsResponse | null;
  loading: boolean;
  chartData: Array<{
    date: string;
    rawDate: string;
    Smithey: number;
    Selery: number;
  }>;
}

export function FulfillmentTracking({
  metrics,
  loading,
  chartData,
}: FulfillmentTrackingProps) {
  // Calculate summary stats
  const transitAnalytics = metrics?.transitAnalytics || [];
  const totalDelivered = transitAnalytics.reduce((sum, t) => sum + t.total_delivered, 0);
  const weightedSum = transitAnalytics.reduce((sum, t) => sum + (t.avg_transit_days * t.total_delivered), 0);
  const avgTransit = totalDelivered > 0 ? (weightedSum / totalDelivered).toFixed(1) : "—";

  // Calculate fulfillment stats
  const totalFulfilled = chartData.reduce((sum, d) => sum + d.Smithey + d.Selery, 0);
  const avgPerDay = chartData.length > 0 ? Math.round(totalFulfilled / chartData.length) : 0;

  return (
    <>
      {/* Summary Cards - Analysis focused metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" />
            TOTAL SHIPPED
          </div>
          <div className="text-4xl font-bold tabular-nums text-text-primary">
            {formatNumber(totalFulfilled)}
          </div>
          <div className="text-xs text-text-muted mt-1">
            In selected period
          </div>
        </div>
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
            <Package className="w-3 h-3" />
            DELIVERED
          </div>
          <div className="text-4xl font-bold tabular-nums text-status-good">
            {formatNumber(totalDelivered)}
          </div>
          <div className="text-xs text-text-muted mt-1">
            Confirmed deliveries
          </div>
        </div>
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
            <Truck className="w-3 h-3" />
            AVG TRANSIT
          </div>
          <div className="text-4xl font-bold tabular-nums text-text-primary">
            {avgTransit}d
          </div>
          <div className="text-xs text-text-muted mt-1">
            Average delivery time
          </div>
        </div>
      </div>

      {/* Fulfillment Volume Trend - Primary Chart */}
      <div className="mb-6">
        <FulfillmentTrend
          chartData={chartData}
          dailyOrders={metrics?.dailyOrders || []}
          loading={loading}
        />
      </div>

      {/* Two-column layout for Lead Time and Backlog */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <LeadTimeTrend
          data={metrics?.leadTimeVsVolume || []}
          loading={loading}
        />
        <BacklogTrend
          backlog={metrics?.dailyBacklog || []}
          loading={loading}
        />
      </div>

      {/* Transit Map */}
      <USTransitMap analytics={metrics?.transitAnalytics || []} loading={loading} />
    </>
  );
}
