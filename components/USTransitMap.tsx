"use client";

import { useState } from "react";
import type { TransitAnalytics, StateTransitStats } from "@/lib/types";
import { US_STATES } from "@/lib/us-states";

interface USTransitMapProps {
  analytics: TransitAnalytics[];
  loading?: boolean;
}

export function USTransitMap({ analytics, loading }: USTransitMapProps) {
  const [hoveredState, setHoveredState] = useState<{
    state: string;
    warehouse: string;
    data: StateTransitStats | null;
    x: number;
    y: number;
  } | null>(null);

  // Build lookup maps for each warehouse
  const dataByWarehouse = analytics.reduce((acc, wh) => {
    const stateMap: Record<string, StateTransitStats> = {};
    for (const st of wh.by_state) {
      stateMap[st.state] = st;
    }
    acc[wh.warehouse] = { stateMap, avgDays: wh.avg_transit_days, totalDelivered: wh.total_delivered };
    return acc;
  }, {} as Record<string, { stateMap: Record<string, StateTransitStats>; avgDays: number; totalDelivered: number }>);

  // Color scale: 1-3 days = green, 4-5 = yellow, 6+ = red
  const getColor = (days: number | null, isSmithey: boolean): string => {
    if (days === null) return "#374151"; // No data - visible gray
    if (days <= 3) return isSmithey ? "#10B981" : "#059669"; // Green
    if (days <= 5) return "#F59E0B"; // Yellow/Warning
    return "#DC2626"; // Red/Bad
  };

  const getOpacity = (hasData: boolean): number => {
    return hasData ? 0.9 : 0.5;
  };

  const hasData = analytics.some((a) => a.total_delivered > 0);
  if (!hasData && !loading) {
    return (
      <div className="bg-bg-secondary rounded border border-border p-6">
        <h3 className="text-label font-medium text-text-tertiary mb-4">
          TRANSIT TIME BY REGION
        </h3>
        <div className="text-context text-text-muted py-8 text-center">
          No delivery data yet
        </div>
      </div>
    );
  }

  const renderMap = (warehouse: string, isSmithey: boolean) => {
    const data = dataByWarehouse[warehouse];

    return (
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className={`text-label font-medium ${isSmithey ? "text-accent-blue" : "text-text-tertiary"}`}>
            {warehouse.toUpperCase()}
          </div>
          {data && (
            <div className="text-context text-text-muted">
              Avg: <span className="text-text-primary font-medium">{data.avgDays}d</span>
              <span className="mx-2 text-border">|</span>
              {data.totalDelivered.toLocaleString()} delivered
            </div>
          )}
        </div>
        <svg
          viewBox="0 0 959 593"
          className="w-full h-auto"
          style={{ maxHeight: "280px" }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Background */}
          <rect x="0" y="0" width="959" height="593" fill="transparent" />

          {/* State paths */}
          {Object.entries(US_STATES).map(([abbr, { path, name }]) => {
            const stateData = data?.stateMap[abbr];
            const days = stateData?.avg_transit_days ?? null;
            const hasStateData = stateData !== undefined;

            return (
              <path
                key={abbr}
                d={path}
                fill={getColor(days, isSmithey)}
                fillOpacity={getOpacity(hasStateData)}
                stroke={hoveredState?.state === abbr && hoveredState?.warehouse === warehouse ? "#60A5FA" : "#1F2937"}
                strokeWidth={hoveredState?.state === abbr && hoveredState?.warehouse === warehouse ? "2" : "0.5"}
                className="transition-all duration-150 cursor-pointer hover:brightness-125"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredState({
                    state: abbr,
                    warehouse,
                    data: stateData || null,
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                  });
                }}
                onMouseLeave={() => setHoveredState(null)}
              />
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 transition-all hover:border-border-hover">
      <h3 className="text-label font-medium text-text-tertiary mb-6">
        TRANSIT TIME BY REGION
      </h3>

      {loading ? (
        <div className="h-[280px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {renderMap("smithey", true)}
            {renderMap("selery", false)}
          </div>

          {/* Legend */}
          <div className="flex justify-center items-center gap-6 mt-6 pt-4 border-t border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-status-good opacity-85" />
              <span className="text-context text-text-muted">1-3 days</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-status-warning opacity-85" />
              <span className="text-context text-text-muted">4-5 days</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-status-bad opacity-85" />
              <span className="text-context text-text-muted">6+ days</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-gray-600 opacity-50" />
              <span className="text-context text-text-muted">No data</span>
            </div>
          </div>
        </>
      )}

      {/* Tooltip */}
      {hoveredState && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: hoveredState.x,
            top: hoveredState.y - 10,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="bg-bg-primary border border-border rounded px-3 py-2 shadow-lg">
            <div className="text-sm font-medium text-text-primary mb-1">
              {US_STATES[hoveredState.state]?.name || hoveredState.state}
            </div>
            {hoveredState.data ? (
              <>
                <div className="text-context">
                  <span className="text-text-primary font-medium">
                    {hoveredState.data.avg_transit_days}d
                  </span>
                  <span className="text-text-muted ml-1">avg transit</span>
                </div>
                <div className="text-context text-text-muted">
                  {hoveredState.data.shipment_count.toLocaleString()} shipments
                </div>
              </>
            ) : (
              <div className="text-context text-text-muted">No delivery data</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
