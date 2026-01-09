"use client";

import { AlertTriangle, Package, Truck } from "lucide-react";
import type { MetricsResponse, StuckShipment } from "@/lib/types";
import { formatNumber } from "@/lib/dashboard-utils";
import { USTransitMap } from "@/components/USTransitMap";

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function StuckShipmentsPanel({
  shipments,
  threshold,
  trackingShippedWithin,
  setTrackingShippedWithin,
  stuckThreshold,
  setStuckThreshold,
}: {
  shipments: StuckShipment[];
  threshold: number;
  trackingShippedWithin: "7days" | "14days" | "30days" | "all";
  setTrackingShippedWithin: (v: "7days" | "14days" | "30days" | "all") => void;
  stuckThreshold: 1 | 2 | 3;
  setStuckThreshold: (v: 1 | 2 | 3) => void;
}) {
  const smithey = shipments.filter((s) => s.warehouse === "smithey");
  const selery = shipments.filter((s) => s.warehouse === "selery");

  const renderShipment = (s: StuckShipment) => (
    <div
      key={`${s.order_id}-${s.tracking_number}`}
      className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0"
    >
      <div className="min-w-0">
        <a
          href={`https://admin.shopify.com/store/smithey-iron-ware/orders/${s.order_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-context text-accent-blue hover:underline"
        >
          {s.order_name}
        </a>
        <div className="text-label text-text-muted truncate">
          {s.carrier}: {s.tracking_number}
        </div>
      </div>
      <div className="text-right flex-shrink-0 ml-4">
        <div
          className={`text-context font-medium ${
            s.days_without_scan >= 7
              ? "text-status-bad"
              : s.days_without_scan >= 5
              ? "text-status-warning"
              : "text-text-primary"
          }`}
        >
          {s.days_without_scan}d
        </div>
        <div className="text-label text-text-muted">no scan</div>
      </div>
    </div>
  );

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 mb-6">
      {/* Header with integrated filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-label font-medium text-status-warning flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          STUCK SHIPMENTS — NO SCANS {threshold}+ DAY{threshold > 1 ? "S" : ""}
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-label text-text-tertiary">SHIPPED WITHIN</span>
            <div className="flex gap-1">
              {(["7days", "14days", "30days", "all"] as const).map((option) => {
                const labels = {
                  "7days": "7d",
                  "14days": "14d",
                  "30days": "30d",
                  "all": "All",
                };
                return (
                  <button
                    key={option}
                    onClick={() => setTrackingShippedWithin(option)}
                    className={`px-2 py-0.5 text-xs font-medium transition-all border rounded ${
                      trackingShippedWithin === option
                        ? "bg-accent-blue text-white border-accent-blue"
                        : "bg-transparent text-text-secondary border-border hover:border-border-hover hover:text-text-primary"
                    }`}
                  >
                    {labels[option]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-label text-text-tertiary">STUCK THRESHOLD</span>
            <div className="flex gap-1">
              {([1, 2, 3] as const).map((days) => (
                <button
                  key={days}
                  onClick={() => setStuckThreshold(days)}
                  className={`px-2 py-0.5 text-xs font-medium transition-all border rounded ${
                    stuckThreshold === days
                      ? "bg-status-warning text-bg-primary border-status-warning"
                      : "bg-transparent text-text-secondary border-border hover:border-border-hover hover:text-text-primary"
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-label text-text-tertiary mb-3">
            SMITHEY ({formatNumber(smithey.length)})
          </div>
          {smithey.length > 0 ? (
            <div className="max-h-[320px] overflow-y-auto pr-2 scrollbar-thin">
              {smithey.map(renderShipment)}
            </div>
          ) : (
            <div className="text-context text-text-muted py-2">All clear</div>
          )}
        </div>
        <div>
          <div className="text-label text-text-tertiary mb-3">
            SELERY ({formatNumber(selery.length)})
          </div>
          {selery.length > 0 ? (
            <div className="max-h-[320px] overflow-y-auto pr-2 scrollbar-thin">
              {selery.map(renderShipment)}
            </div>
          ) : (
            <div className="text-context text-text-muted py-2">All clear</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface FulfillmentTrackingProps {
  metrics: MetricsResponse | null;
  loading: boolean;
  filteredStuckShipments: StuckShipment[];
  stuckThreshold: 1 | 2 | 3;
  setStuckThreshold: (v: 1 | 2 | 3) => void;
  trackingShippedWithin: "7days" | "14days" | "30days" | "all";
  setTrackingShippedWithin: (v: "7days" | "14days" | "30days" | "all") => void;
}

export function FulfillmentTracking({
  metrics,
  loading,
  filteredStuckShipments,
  stuckThreshold,
  setStuckThreshold,
  trackingShippedWithin,
  setTrackingShippedWithin,
}: FulfillmentTrackingProps) {
  const stuckCount = filteredStuckShipments.length;

  return (
    <>
      {/* Tracking Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-status-warning" />
            STUCK SHIPMENTS
          </div>
          <div className={`text-4xl font-bold tabular-nums ${stuckCount > 0 ? "text-status-warning" : "text-text-primary"}`}>
            {formatNumber(stuckCount)}
          </div>
          <div className="text-xs text-text-muted mt-1">
            No scans in {stuckThreshold}+ day{stuckThreshold > 1 ? "s" : ""}
          </div>
        </div>
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
            <Package className="w-3 h-3" />
            DELIVERED
          </div>
          <div className="text-4xl font-bold tabular-nums text-status-good">
            {formatNumber((metrics?.transitAnalytics || []).reduce((sum, t) => sum + t.total_delivered, 0))}
          </div>
          <div className="text-xs text-text-muted mt-1">
            Shipments delivered
          </div>
        </div>
        <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
            <Truck className="w-3 h-3" />
            AVG TRANSIT
          </div>
          <div className="text-4xl font-bold tabular-nums text-text-primary">
            {(() => {
              const analytics = metrics?.transitAnalytics || [];
              const totalDelivered = analytics.reduce((sum, t) => sum + t.total_delivered, 0);
              const weightedSum = analytics.reduce((sum, t) => sum + (t.avg_transit_days * t.total_delivered), 0);
              return totalDelivered > 0 ? (weightedSum / totalDelivered).toFixed(1) : "—";
            })()}d
          </div>
          <div className="text-xs text-text-muted mt-1">
            Average delivery time
          </div>
        </div>
      </div>

      {/* Stuck Shipments with integrated filters */}
      <StuckShipmentsPanel
        shipments={filteredStuckShipments}
        threshold={stuckThreshold}
        trackingShippedWithin={trackingShippedWithin}
        setTrackingShippedWithin={setTrackingShippedWithin}
        stuckThreshold={stuckThreshold}
        setStuckThreshold={setStuckThreshold}
      />

      {/* Transit Map */}
      <USTransitMap analytics={metrics?.transitAnalytics || []} loading={loading} />
    </>
  );
}
