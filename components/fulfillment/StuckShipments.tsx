"use client";

import { AlertTriangle, Clock, ExternalLink } from "lucide-react";
import type { StuckShipment } from "@/lib/types";
import { formatNumber } from "@/lib/dashboard-utils";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatRelativeTime(timestamp: string | null): string | null {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getMostRecentCheck(shipments: StuckShipment[]): string | null {
  if (shipments.length === 0) return null;

  const checkedShipments = shipments.filter(s => s.checked_at);
  if (checkedShipments.length === 0) return null;

  return checkedShipments.reduce((latest, s) => {
    if (!s.checked_at) return latest;
    if (!latest) return s.checked_at;
    return new Date(s.checked_at) > new Date(latest) ? s.checked_at : latest;
  }, null as string | null);
}

// ============================================================================
// COMPONENT
// ============================================================================

interface StuckShipmentsProps {
  shipments: StuckShipment[];
  threshold: number;
  trackingShippedWithin: "7days" | "14days" | "30days" | "all";
  setTrackingShippedWithin: (v: "7days" | "14days" | "30days" | "all") => void;
  stuckThreshold: 1 | 2 | 3;
  setStuckThreshold: (v: 1 | 2 | 3) => void;
}

export function StuckShipments({
  shipments,
  threshold,
  trackingShippedWithin,
  setTrackingShippedWithin,
  stuckThreshold,
  setStuckThreshold,
}: StuckShipmentsProps) {
  const smithey = shipments.filter((s) => s.warehouse === "smithey");
  const selery = shipments.filter((s) => s.warehouse === "selery");

  const lastSyncTime = getMostRecentCheck(shipments);
  const lastSyncAgo = formatRelativeTime(lastSyncTime);

  const ShipmentRow = ({ shipment }: { shipment: StuckShipment }) => {
    const verifiedAgo = formatRelativeTime(shipment.checked_at);
    const isDanger = shipment.days_without_scan >= 7;
    const isWarning = shipment.days_without_scan >= 5;

    return (
      <div className="group flex items-center justify-between py-3 border-b border-border/20 last:border-0 hover:bg-white/[0.02] transition-colors">
        <div className="min-w-0 flex-1">
          <a
            href={`https://admin.shopify.com/store/smithey-iron-ware/orders/${shipment.order_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-accent-blue hover:underline"
          >
            {shipment.order_name}
            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
          <div className="text-xs text-text-muted truncate mt-0.5">
            {shipment.carrier} · {shipment.tracking_number}
          </div>
          {verifiedAgo && (
            <div className="text-[10px] text-text-tertiary flex items-center gap-1 mt-1">
              <Clock className="w-2.5 h-2.5" />
              Verified {verifiedAgo}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <div className={`text-lg font-bold tabular-nums ${
            isDanger ? "text-status-bad" : isWarning ? "text-status-warning" : "text-text-primary"
          }`}>
            {shipment.days_without_scan}d
          </div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide">no scan</div>
        </div>
      </div>
    );
  };

  const WarehouseColumn = ({
    name,
    items,
    accentColor,
  }: {
    name: string;
    items: StuckShipment[];
    accentColor: string;
  }) => (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className={`text-xs font-semibold uppercase tracking-[0.15em] ${accentColor}`}>
          {name}
        </div>
        <div className={`text-sm font-bold tabular-nums ${items.length > 0 ? "text-status-warning" : "text-text-muted"}`}>
          {formatNumber(items.length)}
        </div>
      </div>
      {items.length > 0 ? (
        <div className="max-h-[360px] overflow-y-auto pr-2 scrollbar-thin">
          {items.map((s) => (
            <ShipmentRow key={`${s.order_id}-${s.tracking_number}`} shipment={s} />
          ))}
        </div>
      ) : (
        <div className="py-8 text-center">
          <div className="text-status-good text-sm font-medium">All clear</div>
          <div className="text-xs text-text-muted mt-1">No stuck shipments</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-status-warning flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            STUCK SHIPMENTS
          </h3>
          <p className="text-xs text-text-muted mt-1">
            No carrier scans in {threshold}+ day{threshold > 1 ? "s" : ""}
            {lastSyncAgo && (
              <span className="ml-2 text-text-tertiary">
                · Last sync: {lastSyncAgo}
              </span>
            )}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wide">Shipped</span>
            <div className="flex gap-1">
              {(["7days", "14days", "30days", "all"] as const).map((option) => {
                const labels = { "7days": "7d", "14days": "14d", "30days": "30d", "all": "All" };
                return (
                  <button
                    key={option}
                    onClick={() => setTrackingShippedWithin(option)}
                    className={`px-2 py-1 text-xs font-medium transition-all rounded ${
                      trackingShippedWithin === option
                        ? "bg-accent-blue text-white"
                        : "text-text-tertiary hover:text-text-secondary hover:bg-white/5"
                    }`}
                  >
                    {labels[option]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wide">Threshold</span>
            <div className="flex gap-1">
              {([1, 2, 3] as const).map((days) => (
                <button
                  key={days}
                  onClick={() => setStuckThreshold(days)}
                  className={`px-2 py-1 text-xs font-medium transition-all rounded ${
                    stuckThreshold === days
                      ? "bg-status-warning text-bg-primary"
                      : "text-text-tertiary hover:text-text-secondary hover:bg-white/5"
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <WarehouseColumn name="Smithey" items={smithey} accentColor="text-accent-blue" />
        <WarehouseColumn name="Selery" items={selery} accentColor="text-[#8B5CF6]" />
      </div>

      {/* Footer with total */}
      {shipments.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border/30 flex items-center justify-between">
          <div className="text-xs text-text-muted">
            {formatNumber(shipments.length)} shipment{shipments.length !== 1 ? "s" : ""} requiring attention
          </div>
          <div className="text-xs text-text-tertiary">
            Data synced hourly from EasyPost
          </div>
        </div>
      )}
    </div>
  );
}
