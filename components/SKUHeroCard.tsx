"use client";

import { useMemo, useState, useRef } from "react";
import { Package } from "lucide-react";

// ============================================================================
// SKU HERO CARD
// ============================================================================
// Unified view of SKU state: inventory + year context + runway projection
// Designed as single source of truth for "where are we with this SKU"
// ============================================================================

interface Props {
  onHand: number;
  doi: number | null;
  yearForecast: number;
  ytdProduced: number;
  yearRemaining: number;
  loading?: boolean;
  error?: boolean;
}

interface WeekProjection {
  week: number;
  projected: number;
  percentRemaining: number;
}

export default function SKUHeroCard({
  onHand,
  doi,
  yearForecast,
  ytdProduced,
  yearRemaining,
  loading = false,
  error = false,
}: Props) {
  const [hoveredWeek, setHoveredWeek] = useState<WeekProjection | null>(null);
  const [tooltipX, setTooltipX] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  // Calculate 52-week projections based on DOI burn rate
  const projections = useMemo(() => {
    if (!doi || doi <= 0 || onHand <= 0) return [];

    const dailyBurn = onHand / doi;
    const result: WeekProjection[] = [];

    for (let w = 1; w <= 52; w++) {
      const daysElapsed = w * 7;
      const projected = Math.round(onHand - daysElapsed * dailyBurn);
      const percentRemaining = (projected / onHand) * 100;
      result.push({ week: w, projected, percentRemaining });
    }

    return result;
  }, [onHand, doi]);

  // Find stockout week
  const stockoutWeek = projections.find((p) => p.projected <= 0)?.week;
  const runwayWeeks = stockoutWeek ? stockoutWeek - 1 : 52;

  // Determine urgency for status styling
  const urgency = useMemo(() => {
    if (!stockoutWeek) return "safe"; // 52+ weeks
    if (stockoutWeek <= 8) return "critical"; // Under 2 months
    if (stockoutWeek <= 16) return "warning"; // Under 4 months
    return "healthy";
  }, [stockoutWeek]);

  // Handle hover for tooltip positioning
  const handleMouseMove = (e: React.MouseEvent, week: WeekProjection) => {
    if (barRef.current) {
      const rect = barRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setTooltipX(Math.max(50, Math.min(x, rect.width - 50)));
    }
    setHoveredWeek(week);
  };

  // Status dot color
  const statusColor = {
    critical: "bg-red-500",
    warning: "bg-amber-400",
    healthy: "bg-emerald-400",
    safe: "bg-emerald-400",
  }[urgency];

  // Status text
  const statusText = stockoutWeek
    ? `Stockout week ${stockoutWeek}`
    : "52+ weeks runway";

  return (
    <div className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-[var(--color-text-tertiary)]" />
          <h2 className="text-[10px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-widest">
            SKU Snapshot
          </h2>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="px-4 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
          {/* On Hand */}
          <div>
            <p className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
              On Hand
            </p>
            <p className="text-2xl font-semibold text-white tabular-nums">
              {loading ? "..." : onHand.toLocaleString()}
            </p>
          </div>

          {/* Days of Inventory */}
          <div>
            <p className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
              Days of Inv
            </p>
            <p className="text-2xl font-semibold text-white tabular-nums">
              {loading ? "..." : doi ? `${doi}d` : "—"}
            </p>
          </div>

          {/* YTD Produced */}
          <div>
            <p className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
              YTD Produced
            </p>
            <p className="text-2xl font-semibold text-white tabular-nums">
              {ytdProduced.toLocaleString()}
            </p>
          </div>

          {/* Year Remaining */}
          <div>
            <p className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
              Year Remain
            </p>
            <p className="text-2xl font-semibold text-white tabular-nums">
              {yearRemaining.toLocaleString()}
            </p>
          </div>
        </div>

        {error && (
          <p className="text-xs text-amber-400 mt-3">
            Failed to load inventory data
          </p>
        )}
      </div>

      {/* Runway Section */}
      {doi && doi > 0 && (
        <div className="px-4 pb-4 pt-2 border-t border-[var(--color-border-subtle)]">
          {/* Runway Header */}
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
            <p className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-widest">
              {statusText}
            </p>
          </div>

          {/* Runway Bar - Continuous gradient, no gaps */}
          <div ref={barRef} className="relative">
            {/* The continuous bar */}
            <div className="h-8 rounded overflow-hidden relative">
              <svg width="100%" height="100%" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="runwayGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    {projections.map((p, i) => {
                      const percent = (i / 51) * 100;
                      const color = getGradientColor(p.percentRemaining);
                      return (
                        <stop
                          key={i}
                          offset={`${percent}%`}
                          stopColor={color}
                        />
                      );
                    })}
                  </linearGradient>
                </defs>
                <rect
                  width="100%"
                  height="100%"
                  fill="url(#runwayGradient)"
                  rx="4"
                />
              </svg>

              {/* Hover zones - invisible but capture mouse events */}
              <div className="absolute inset-0 flex">
                {projections.map((p) => (
                  <div
                    key={p.week}
                    className="flex-1 cursor-crosshair"
                    onMouseEnter={(e) => handleMouseMove(e, p)}
                    onMouseMove={(e) => handleMouseMove(e, p)}
                    onMouseLeave={() => setHoveredWeek(null)}
                  />
                ))}
              </div>

              {/* Stockout marker line */}
              {stockoutWeek && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white/60"
                  style={{ left: `${((stockoutWeek - 0.5) / 52) * 100}%` }}
                >
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-b-[5px] border-transparent border-b-white/60" />
                </div>
              )}
            </div>

            {/* Tooltip */}
            {hoveredWeek && (
              <div
                className="absolute -top-12 transform -translate-x-1/2 pointer-events-none z-20"
                style={{ left: tooltipX }}
              >
                <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-md px-2.5 py-1.5 shadow-xl">
                  <p className="text-[11px] whitespace-nowrap tabular-nums font-medium">
                    <span className="text-[var(--color-text-tertiary)]">
                      W{hoveredWeek.week}
                    </span>
                    <span className="mx-2 text-[var(--color-border)]">·</span>
                    <span
                      className={
                        hoveredWeek.projected >= 0
                          ? "text-white"
                          : "text-red-400"
                      }
                    >
                      {hoveredWeek.projected >= 0
                        ? hoveredWeek.projected.toLocaleString()
                        : `−${Math.abs(hoveredWeek.projected).toLocaleString()}`}
                    </span>
                    <span className="text-[var(--color-text-tertiary)] ml-1">
                      units
                    </span>
                  </p>
                </div>
                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-transparent border-t-[var(--color-border)]" />
              </div>
            )}

            {/* Week markers */}
            <div className="flex justify-between mt-2 text-[9px] text-[var(--color-text-tertiary)]/50 tabular-nums">
              <span>1</span>
              <span>13</span>
              <span>26</span>
              <span>39</span>
              <span>52</span>
            </div>
          </div>
        </div>
      )}

      {/* No DOI fallback */}
      {(!doi || doi <= 0) && (
        <div className="px-4 pb-4 pt-2 border-t border-[var(--color-border-subtle)]">
          <p className="text-xs text-[var(--color-text-tertiary)]/60">
            No velocity data for runway projection
          </p>
        </div>
      )}
    </div>
  );
}

// Color function - returns HSL color based on percent remaining
function getGradientColor(percentRemaining: number): string {
  const pct = Math.max(-50, Math.min(100, percentRemaining));

  if (pct >= 50) {
    // Emerald zone
    return `hsl(152, 70%, ${35 + (pct - 50) * 0.2}%)`;
  } else if (pct >= 25) {
    // Transition to yellow
    const t = (pct - 25) / 25;
    const hue = 45 + t * 107; // 45 (yellow) to 152 (emerald)
    return `hsl(${hue}, 70%, 45%)`;
  } else if (pct >= 0) {
    // Orange to red
    const hue = (pct / 25) * 45; // 0 to 45
    return `hsl(${hue}, 75%, 50%)`;
  } else {
    // Deep red for negative
    const lightness = Math.max(25, 45 + pct * 0.4);
    return `hsl(0, 65%, ${lightness}%)`;
  }
}
