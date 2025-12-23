"use client";

import { useState, useMemo } from "react";
import { US_STATES } from "@/lib/us-states";

interface StateRevenueData {
  provinceCode: string;
  provinceName: string;
  countryCode: string;
  orderCount: number;
  totalRevenue: number;
  uniqueCustomers: number;
  avgOrderValue: number;
}

interface USRevenueMapProps {
  data: StateRevenueData[];
  loading?: boolean;
}

// Revenue color gradient - from light (low) to deep emerald (high)
const REVENUE_GRADIENT_STOPS = [
  { pct: 0, color: [30, 41, 59] },      // Slate (no/low data)
  { pct: 0.1, color: [20, 83, 45] },    // Dark green
  { pct: 0.25, color: [22, 101, 52] },  // Forest green
  { pct: 0.5, color: [34, 197, 94] },   // Emerald
  { pct: 0.75, color: [74, 222, 128] }, // Light emerald
  { pct: 1, color: [134, 239, 172] },   // Mint (highest)
];

function interpolateRevenueColor(value: number, maxValue: number): string {
  if (maxValue === 0 || value === 0) return rgbToHex(REVENUE_GRADIENT_STOPS[0].color);

  const pct = Math.min(value / maxValue, 1);

  // Find the two stops we're between
  for (let i = 0; i < REVENUE_GRADIENT_STOPS.length - 1; i++) {
    const start = REVENUE_GRADIENT_STOPS[i];
    const end = REVENUE_GRADIENT_STOPS[i + 1];

    if (pct >= start.pct && pct <= end.pct) {
      const t = (pct - start.pct) / (end.pct - start.pct);
      const r = Math.round(start.color[0] + (end.color[0] - start.color[0]) * t);
      const g = Math.round(start.color[1] + (end.color[1] - start.color[1]) * t);
      const b = Math.round(start.color[2] + (end.color[2] - start.color[2]) * t);
      return rgbToHex([r, g, b]);
    }
  }

  return rgbToHex(REVENUE_GRADIENT_STOPS[REVENUE_GRADIENT_STOPS.length - 1].color);
}

function rgbToHex(rgb: number[]): string {
  return `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
}

// Generate CSS gradient for legend
function generateGradientCSS(): string {
  const stops = REVENUE_GRADIENT_STOPS.slice(1).map((stop, i) => {
    const pct = (i / (REVENUE_GRADIENT_STOPS.length - 2)) * 100;
    return `${rgbToHex(stop.color)} ${pct}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function GradientLegend({ maxRevenue }: { maxRevenue: number }) {
  return (
    <div className="flex flex-col items-center gap-2 mt-4 pt-4 border-t border-border/50">
      <div className="text-xs text-text-muted font-medium tracking-wider uppercase">
        Revenue by State
      </div>
      <div className="flex items-center gap-3 w-full max-w-md">
        <span className="text-xs font-semibold text-slate-400">$0</span>
        <div
          className="flex-1 h-3 rounded-full"
          style={{
            background: generateGradientCSS(),
            boxShadow: '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)'
          }}
        />
        <span className="text-xs font-semibold text-emerald-400">{formatCurrency(maxRevenue)}</span>
      </div>
    </div>
  );
}

export function USRevenueMap({ data, loading }: USRevenueMapProps) {
  const [hoveredState, setHoveredState] = useState<{
    state: string;
    data: StateRevenueData | null;
    x: number;
    y: number;
  } | null>(null);

  // Build lookup map and find max revenue
  const { stateMap, maxRevenue, totalRevenue, totalOrders } = useMemo(() => {
    const map: Record<string, StateRevenueData> = {};
    let max = 0;
    let total = 0;
    let orders = 0;

    for (const state of data) {
      map[state.provinceCode] = state;
      if (state.totalRevenue > max) max = state.totalRevenue;
      total += state.totalRevenue;
      orders += state.orderCount;
    }

    return { stateMap: map, maxRevenue: max, totalRevenue: total, totalOrders: orders };
  }, [data]);

  if (loading) {
    return (
      <div className="bg-card-dark border border-border/30 rounded-lg p-6">
        <h3 className="text-sm font-semibold tracking-wider text-text-secondary uppercase mb-4">
          Revenue by Region
        </h3>
        <div className="h-[300px] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            <span className="text-sm text-text-muted">Loading map data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-card-dark border border-border/30 rounded-lg p-6">
        <h3 className="text-sm font-semibold tracking-wider text-text-secondary uppercase mb-4">
          Revenue by Region
        </h3>
        <div className="text-sm text-text-muted py-12 text-center">
          No geographic data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card-dark border border-border/30 rounded-lg p-6 transition-all hover:border-border/50">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-semibold tracking-wider text-text-secondary uppercase">
          Revenue by Region
        </h3>
        <div className="flex items-baseline gap-4 text-sm">
          <div>
            <span className="font-bold text-xl text-text-primary">{formatCurrency(totalRevenue)}</span>
            <span className="text-text-muted ml-1">total</span>
          </div>
          <div className="text-text-muted">
            <span className="text-text-secondary font-medium">{formatNumber(totalOrders)}</span> orders
          </div>
        </div>
      </div>

      {/* Map container */}
      <div
        className="relative rounded-xl overflow-hidden p-4"
        style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.6) 0%, rgba(30, 41, 59, 0.4) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <svg
          viewBox="0 0 959 593"
          className="w-full h-auto"
          style={{
            maxHeight: "380px",
            filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))'
          }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Subtle grid pattern background */}
          <defs>
            <pattern id="revenue-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="959" height="593" fill="url(#revenue-grid)" />

          {/* State paths */}
          {Object.entries(US_STATES).map(([abbr, { path }]) => {
            // Guard against empty or invalid path data
            if (!path || typeof path !== 'string' || path.length === 0) {
              return null;
            }

            const stateData = stateMap[abbr];
            const revenue = stateData?.totalRevenue ?? 0;
            const hasStateData = stateData !== undefined && revenue > 0;
            const isHovered = hoveredState?.state === abbr;

            const fillColor = hasStateData
              ? interpolateRevenueColor(revenue, maxRevenue)
              : "#1e293b";

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

      <GradientLegend maxRevenue={maxRevenue} />

      {/* Tooltip */}
      {hoveredState && (
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

            {hoveredState.data ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-slate-400">Revenue</span>
                  <span className="text-lg font-bold text-emerald-400">
                    {formatCurrency(hoveredState.data.totalRevenue)}
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Orders</span>
                    <span className="text-slate-300">
                      {formatNumber(hoveredState.data.orderCount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Customers</span>
                    <span className="text-slate-300">
                      {formatNumber(hoveredState.data.uniqueCustomers)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Avg Order</span>
                    <span className="text-slate-300">
                      {formatCurrency(hoveredState.data.avgOrderValue)}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-400">No data for this state</div>
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
