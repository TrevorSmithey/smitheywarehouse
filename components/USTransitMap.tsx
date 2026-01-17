"use client";

import { useState, useMemo } from "react";
import { MapPin, TrendingUp, TrendingDown, Zap } from "lucide-react";
import type { TransitAnalytics, StateTransitStats } from "@/lib/types";
import { US_STATES } from "@/lib/us-states";
import { formatNumber } from "@/lib/dashboard-utils";

type ViewMode = "combined" | "smithey" | "selery";

interface USTransitMapProps {
  analytics: TransitAnalytics[];
  loading?: boolean;
}

interface CombinedStateData {
  state: string;
  avg_transit_days: number;
  shipment_count: number;
  smithey_days: number | null;
  selery_days: number | null;
  smithey_count: number;
  selery_count: number;
}

// Color stops for smooth gradient interpolation
// Using a sophisticated teal → gold → coral gradient
const GRADIENT_STOPS = [
  { value: 1, color: [16, 185, 129] },   // Emerald - fastest
  { value: 2, color: [52, 211, 153] },   // Light emerald
  { value: 3, color: [134, 239, 172] },  // Mint
  { value: 4, color: [253, 224, 71] },   // Yellow
  { value: 5, color: [251, 191, 36] },   // Amber
  { value: 6, color: [249, 115, 22] },   // Orange
  { value: 7, color: [239, 68, 68] },    // Red - slowest
];

// Smooth interpolation between color stops
function interpolateColor(days: number): string {
  if (days <= GRADIENT_STOPS[0].value) return rgbToHex(GRADIENT_STOPS[0].color);
  if (days >= GRADIENT_STOPS[GRADIENT_STOPS.length - 1].value) {
    return rgbToHex(GRADIENT_STOPS[GRADIENT_STOPS.length - 1].color);
  }

  // Find the two stops we're between
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    const start = GRADIENT_STOPS[i];
    const end = GRADIENT_STOPS[i + 1];

    if (days >= start.value && days <= end.value) {
      // Calculate interpolation factor (0-1)
      const t = (days - start.value) / (end.value - start.value);

      // Lerp each RGB component
      const r = Math.round(start.color[0] + (end.color[0] - start.color[0]) * t);
      const g = Math.round(start.color[1] + (end.color[1] - start.color[1]) * t);
      const b = Math.round(start.color[2] + (end.color[2] - start.color[2]) * t);

      return rgbToHex([r, g, b]);
    }
  }

  return rgbToHex(GRADIENT_STOPS[GRADIENT_STOPS.length - 1].color);
}

function rgbToHex(rgb: number[]): string {
  return `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

// Generate CSS gradient for legend
function generateGradientCSS(): string {
  const stops = GRADIENT_STOPS.map((stop, i) => {
    const pct = (i / (GRADIENT_STOPS.length - 1)) * 100;
    return `${rgbToHex(stop.color)} ${pct}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

// Gradient legend bar - extracted to module level to avoid re-creation on render
function GradientLegend() {
  return (
    <div className="flex flex-col items-center gap-2 mt-6 pt-4 border-t border-border/30">
      <div className="text-[10px] text-text-muted font-semibold tracking-[0.15em] uppercase">
        Transit Time (Days)
      </div>
      <div className="flex items-center gap-3 w-full max-w-sm">
        <span className="text-[10px] font-medium text-status-good">Fast</span>
        <div
          className="flex-1 h-2 rounded-full"
          style={{
            background: generateGradientCSS(),
          }}
        />
        <span className="text-[10px] font-medium text-status-bad">Slow</span>
      </div>
      <div className="flex justify-between w-full max-w-sm text-[10px] text-text-tertiary px-6">
        <span>1d</span>
        <span>2d</span>
        <span>3d</span>
        <span>4d</span>
        <span>5d</span>
        <span>6d</span>
        <span>7d+</span>
      </div>
    </div>
  );
}

// Summary stats component
function TransitSummary({
  stateMap,
  avgDays,
  totalDelivered,
}: {
  stateMap: Record<string, StateTransitStats | CombinedStateData>;
  avgDays: number;
  totalDelivered: number;
}) {
  // Find fastest and slowest states
  const statesWithData = Object.entries(stateMap)
    .filter(([, data]) => data.shipment_count >= 10) // Only states with meaningful sample size
    .sort((a, b) => a[1].avg_transit_days - b[1].avg_transit_days);

  const fastestStates = statesWithData.slice(0, 3);
  const slowestStates = statesWithData.slice(-3).reverse();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Overall Average */}
      <div className="bg-bg-tertiary/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-3.5 h-3.5 text-accent-blue" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">
            Avg Transit
          </span>
        </div>
        <div className="text-3xl font-bold tabular-nums text-text-primary">
          {avgDays}d
        </div>
        <div className="text-xs text-text-muted mt-1">
          {formatNumber(totalDelivered)} deliveries
        </div>
      </div>

      {/* Fastest States */}
      <div className="bg-bg-tertiary/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-status-good" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">
            Fastest States
          </span>
        </div>
        <div className="space-y-1">
          {fastestStates.map(([abbr, data]) => (
            <div key={abbr} className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">
                {US_STATES[abbr]?.name || abbr}
              </span>
              <span className="text-xs font-medium text-status-good tabular-nums">
                {data.avg_transit_days}d
              </span>
            </div>
          ))}
          {fastestStates.length === 0 && (
            <div className="text-xs text-text-muted">No data yet</div>
          )}
        </div>
      </div>

      {/* Slowest States */}
      <div className="bg-bg-tertiary/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingDown className="w-3.5 h-3.5 text-status-warning" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted">
            Slowest States
          </span>
        </div>
        <div className="space-y-1">
          {slowestStates.map(([abbr, data]) => (
            <div key={abbr} className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">
                {US_STATES[abbr]?.name || abbr}
              </span>
              <span className="text-xs font-medium text-status-warning tabular-nums">
                {data.avg_transit_days}d
              </span>
            </div>
          ))}
          {slowestStates.length === 0 && (
            <div className="text-xs text-text-muted">No data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function USTransitMap({ analytics, loading }: USTransitMapProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("combined");
  const [hoveredState, setHoveredState] = useState<{
    state: string;
    data: CombinedStateData | StateTransitStats | null;
    x: number;
    y: number;
  } | null>(null);

  // Build lookup maps for each warehouse
  const dataByWarehouse = useMemo(() => {
    return analytics.reduce((acc, wh) => {
      const stateMap: Record<string, StateTransitStats> = {};
      for (const st of wh.by_state) {
        stateMap[st.state] = st;
      }
      acc[wh.warehouse] = { stateMap, avgDays: wh.avg_transit_days, totalDelivered: wh.total_delivered };
      return acc;
    }, {} as Record<string, { stateMap: Record<string, StateTransitStats>; avgDays: number; totalDelivered: number }>);
  }, [analytics]);

  // Build combined data (weighted average by shipment count)
  const combinedData = useMemo(() => {
    const smitheyData = dataByWarehouse["smithey"];
    const seleryData = dataByWarehouse["selery"];
    const combinedMap: Record<string, CombinedStateData> = {};

    const allStates = new Set<string>();
    if (smitheyData) Object.keys(smitheyData.stateMap).forEach(s => allStates.add(s));
    if (seleryData) Object.keys(seleryData.stateMap).forEach(s => allStates.add(s));

    for (const state of allStates) {
      const smithey = smitheyData?.stateMap[state];
      const selery = seleryData?.stateMap[state];

      const smitheyCount = smithey?.shipment_count || 0;
      const seleryCount = selery?.shipment_count || 0;
      const totalCount = smitheyCount + seleryCount;

      let avgDays = 0;
      if (totalCount > 0) {
        const smitheyWeight = smitheyCount / totalCount;
        const seleryWeight = seleryCount / totalCount;
        avgDays = (smithey?.avg_transit_days || 0) * smitheyWeight +
                  (selery?.avg_transit_days || 0) * seleryWeight;
        avgDays = Math.round(avgDays * 10) / 10;
      }

      combinedMap[state] = {
        state,
        avg_transit_days: avgDays,
        shipment_count: totalCount,
        smithey_days: smithey?.avg_transit_days ?? null,
        selery_days: selery?.avg_transit_days ?? null,
        smithey_count: smitheyCount,
        selery_count: seleryCount,
      };
    }

    const totalDelivered = (smitheyData?.totalDelivered || 0) + (seleryData?.totalDelivered || 0);
    const smitheyTotal = smitheyData?.totalDelivered || 0;
    const seleryTotal = seleryData?.totalDelivered || 0;
    const avgDays = totalDelivered > 0
      ? Math.round(((smitheyData?.avgDays || 0) * smitheyTotal + (seleryData?.avgDays || 0) * seleryTotal) / totalDelivered * 10) / 10
      : 0;

    return { stateMap: combinedMap, avgDays, totalDelivered };
  }, [dataByWarehouse]);

  const hasData = analytics.some((a) => a.total_delivered > 0);
  if (!hasData && !loading) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-4 h-4 text-text-muted" />
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            US TRANSIT MAP
          </h3>
        </div>
        <div className="text-sm text-text-muted py-12 text-center">
          No delivery data yet
        </div>
      </div>
    );
  }

  const renderSingleMap = (
    label: string,
    stateMap: Record<string, StateTransitStats | CombinedStateData>,
    avgDays: number,
    totalDelivered: number,
    isFeatured: boolean = false
  ) => {
    return (
      <div className="relative">
        {/* Map header */}
        <div className="flex items-baseline justify-between mb-4">
          <h4 className={`font-semibold tracking-wide ${isFeatured ? 'text-lg text-text-primary' : 'text-sm text-text-secondary'}`}>
            {label}
          </h4>
          <div className="flex items-baseline gap-4 text-sm">
            <div>
              <span className={`font-bold ${isFeatured ? 'text-2xl' : 'text-xl'} text-text-primary`}>{avgDays}</span>
              <span className="text-text-muted ml-1">days avg</span>
            </div>
            <div className="text-text-muted">
              <span className="text-text-secondary font-medium">{totalDelivered.toLocaleString()}</span> delivered
            </div>
          </div>
        </div>

        {/* Map container with subtle depth */}
        <div
          className={`relative rounded-xl overflow-hidden ${isFeatured ? 'p-6' : 'p-4'}`}
          style={{
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.6) 0%, rgba(30, 41, 59, 0.4) 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 20px rgba(0,0,0,0.3)',
          }}
        >
          <svg
            viewBox="0 0 959 593"
            className="w-full h-auto"
            style={{
              maxHeight: isFeatured ? "420px" : "240px",
              filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))'
            }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Subtle grid pattern background */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="959" height="593" fill="url(#grid)" />

            {/* State paths */}
            {Object.entries(US_STATES).map(([abbr, { path }]) => {
              // Guard against empty or invalid path data
              if (!path || typeof path !== 'string' || path.length === 0) {
                return null;
              }

              const stateData = stateMap[abbr];
              const days = stateData?.avg_transit_days ?? null;
              const hasStateData = stateData !== undefined && stateData.shipment_count > 0;
              const isHovered = hoveredState?.state === abbr;

              // Smooth gradient color based on exact transit days
              const fillColor = hasStateData && days !== null
                ? interpolateColor(days)
                : "#1e293b"; // Dark slate for no data

              return (
                <path
                  key={abbr}
                  d={path || ""}
                  fill={fillColor}
                  fillOpacity={hasStateData ? 0.92 : 0.3}
                  stroke={isHovered ? "#ffffff" : "rgba(30, 41, 59, 0.8)"}
                  strokeWidth={isHovered ? "2" : "0.75"}
                  style={{
                    transition: 'all 0.2s ease-out',
                    filter: isHovered ? 'brightness(1.15) drop-shadow(0 0 8px rgba(255,255,255,0.3))' : 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredState({
                      state: abbr,
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
      </div>
    );
  };

  const renderComparisonMaps = () => {
    const smitheyData = dataByWarehouse["smithey"];
    const seleryData = dataByWarehouse["selery"];

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {smitheyData && renderSingleMap(
          "SMITHEY",
          smitheyData.stateMap,
          smitheyData.avgDays,
          smitheyData.totalDelivered
        )}
        {seleryData && renderSingleMap(
          "SELERY",
          seleryData.stateMap,
          seleryData.avgDays,
          seleryData.totalDelivered
        )}
      </div>
    );
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
      {/* Header with view toggle */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-text-muted" />
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
              US TRANSIT MAP
            </h3>
          </div>
          <p className="text-xs text-text-tertiary mt-1">
            Average delivery times by state
          </p>
        </div>
        <div className="flex gap-1">
          {[
            { id: "combined", label: "All" },
            { id: "smithey", label: "Smithey" },
            { id: "selery", label: "Selery" },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setViewMode(id as ViewMode)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                viewMode === id
                  ? "bg-accent-blue text-white"
                  : "text-text-tertiary hover:text-text-secondary hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-[400px] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
            <span className="text-sm text-text-muted">Loading map data...</span>
          </div>
        </div>
      ) : (
        <>
          {viewMode === "combined" && (
            <div className="space-y-6">
              {/* Summary Stats */}
              <TransitSummary
                stateMap={combinedData.stateMap}
                avgDays={combinedData.avgDays}
                totalDelivered={combinedData.totalDelivered}
              />

              {/* Main Map */}
              {renderSingleMap(
                "ALL WAREHOUSES",
                combinedData.stateMap,
                combinedData.avgDays,
                combinedData.totalDelivered,
                true
              )}

              {/* Warehouse Comparison */}
              <div className="pt-6 border-t border-border/30">
                <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.15em] mb-4">
                  Warehouse Comparison
                </div>
                {renderComparisonMaps()}
              </div>
            </div>
          )}

          {viewMode === "smithey" && dataByWarehouse["smithey"] && (
            <div className="space-y-6">
              <TransitSummary
                stateMap={dataByWarehouse["smithey"].stateMap}
                avgDays={dataByWarehouse["smithey"].avgDays}
                totalDelivered={dataByWarehouse["smithey"].totalDelivered}
              />
              {renderSingleMap(
                "SMITHEY WAREHOUSE",
                dataByWarehouse["smithey"].stateMap,
                dataByWarehouse["smithey"].avgDays,
                dataByWarehouse["smithey"].totalDelivered,
                true
              )}
            </div>
          )}

          {viewMode === "selery" && dataByWarehouse["selery"] && (
            <div className="space-y-6">
              <TransitSummary
                stateMap={dataByWarehouse["selery"].stateMap}
                avgDays={dataByWarehouse["selery"].avgDays}
                totalDelivered={dataByWarehouse["selery"].totalDelivered}
              />
              {renderSingleMap(
                "SELERY WAREHOUSE",
                dataByWarehouse["selery"].stateMap,
                dataByWarehouse["selery"].avgDays,
                dataByWarehouse["selery"].totalDelivered,
                true
              )}
            </div>
          )}

          <GradientLegend />
        </>
      )}

      {/* Tooltip */}
      {hoveredState && hoveredState.data && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: hoveredState.x,
            top: hoveredState.y - 12,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div
            className="rounded-xl px-5 py-4 min-w-[200px]"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.95) 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="text-base font-bold text-white mb-3 pb-2 border-b border-white/10">
              {US_STATES[hoveredState.state]?.name || hoveredState.state}
            </div>

            {"smithey_days" in hoveredState.data ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-slate-400">Combined Avg</span>
                  <span
                    className="text-lg font-bold"
                    style={{ color: interpolateColor(hoveredState.data.avg_transit_days) }}
                  >
                    {hoveredState.data.avg_transit_days}d
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Smithey</span>
                    <span className="text-slate-300">
                      {hoveredState.data.smithey_days !== null
                        ? `${hoveredState.data.smithey_days}d · ${hoveredState.data.smithey_count.toLocaleString()}`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Selery</span>
                    <span className="text-slate-300">
                      {hoveredState.data.selery_days !== null
                        ? `${hoveredState.data.selery_days}d · ${hoveredState.data.selery_count.toLocaleString()}`
                        : "—"}
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                  <span className="text-xs text-slate-500">Total Shipments</span>
                  <span className="text-sm font-semibold text-white">
                    {hoveredState.data.shipment_count.toLocaleString()}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">Avg Transit</span>
                  <span
                    className="text-lg font-bold"
                    style={{ color: interpolateColor(hoveredState.data.avg_transit_days) }}
                  >
                    {hoveredState.data.avg_transit_days}d
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Shipments</span>
                  <span className="text-sm font-semibold text-white">
                    {hoveredState.data.shipment_count.toLocaleString()}
                  </span>
                </div>
              </>
            )}
          </div>
          {/* Tooltip arrow */}
          <div
            className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-4 h-4 rotate-45"
            style={{
              background: 'linear-gradient(135deg, transparent 50%, rgba(30, 41, 59, 0.95) 50%)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderTop: 'none',
              borderLeft: 'none',
            }}
          />
        </div>
      )}
    </div>
  );
}
