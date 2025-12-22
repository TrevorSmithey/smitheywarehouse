"use client";

import { useMemo, useState, useRef } from "react";

interface Props {
  onHand: number;
  doi: number | null;
}

interface WeekData {
  week: number;
  projected: number;
  percentRemaining: number;
}

export default function InventoryRunway({ onHand, doi }: Props) {
  const [hoveredWeek, setHoveredWeek] = useState<WeekData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate weekly projections
  const weeks = useMemo(() => {
    if (!doi || doi <= 0 || onHand <= 0) return [];

    const dailyBurn = onHand / doi;
    const result: WeekData[] = [];

    for (let w = 1; w <= 52; w++) {
      const daysElapsed = w * 7;
      const projected = Math.round(onHand - (daysElapsed * dailyBurn));
      const percentRemaining = (projected / onHand) * 100;
      result.push({ week: w, projected, percentRemaining });
    }

    return result;
  }, [onHand, doi]);

  // Get HSL color for smooth gradient
  const getColor = (percentRemaining: number): string => {
    // Clamp to reasonable range for color calculation
    const pct = Math.max(-50, Math.min(100, percentRemaining));

    if (pct >= 50) {
      // Green zone: hue 145 (emerald) to 160
      return `hsl(152, 70%, ${35 + (pct - 50) * 0.3}%)`;
    } else if (pct >= 20) {
      // Yellow-green transition: hue 60-145
      const hue = 60 + ((pct - 20) / 30) * 92;
      return `hsl(${hue}, 75%, 45%)`;
    } else if (pct > 0) {
      // Orange-red zone: hue 0-60
      const hue = (pct / 20) * 40;
      return `hsl(${hue}, 80%, 50%)`;
    } else {
      // Negative: deep red with decreasing lightness
      const lightness = Math.max(25, 40 + pct * 0.3);
      return `hsl(0, 70%, ${lightness}%)`;
    }
  };

  // Get stockout week
  const stockoutWeek = weeks.find(w => w.projected <= 0)?.week;
  const runwayWeeks = stockoutWeek ? stockoutWeek - 1 : 52;

  // Handle hover with position tracking for tooltip
  const handleHover = (week: WeekData | null, event?: React.MouseEvent) => {
    setHoveredWeek(week);
    if (event && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const pos = event.clientX - rect.left;
      setTooltipPos(Math.max(40, Math.min(pos, rect.width - 40)));
    }
  };

  if (!doi || doi <= 0) {
    return (
      <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-1 rounded-full bg-[var(--color-text-tertiary)]" />
          <p className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-widest">
            Runway
          </p>
        </div>
        <p className="text-xs text-[var(--color-text-tertiary)]/60">
          No velocity data
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
      {/* Minimal header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${stockoutWeek && stockoutWeek <= 12 ? 'bg-red-400' : stockoutWeek && stockoutWeek <= 26 ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
          <p className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-widest">
            {runwayWeeks < 52 ? `${runwayWeeks}w runway` : "52+ weeks"}
          </p>
        </div>
      </div>

      {/* Runway bar */}
      <div ref={containerRef} className="relative group">
        {/* The 52 week cells */}
        <div className="flex gap-px rounded-md overflow-hidden">
          {weeks.map((week) => {
            const isStockout = week.projected <= 0;
            const isHovered = hoveredWeek?.week === week.week;

            return (
              <div
                key={week.week}
                className="flex-1 h-6 cursor-crosshair transition-opacity duration-100"
                style={{
                  backgroundColor: getColor(week.percentRemaining),
                  opacity: isHovered ? 1 : 0.85,
                }}
                onMouseEnter={(e) => handleHover(week, e)}
                onMouseMove={(e) => handleHover(week, e)}
                onMouseLeave={() => handleHover(null)}
              />
            );
          })}
        </div>

        {/* Stockout marker line */}
        {stockoutWeek && (
          <div
            className="absolute top-0 bottom-0 w-px bg-white/40"
            style={{ left: `${((stockoutWeek - 0.5) / 52) * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3px] border-r-[3px] border-t-[4px] border-transparent border-t-white/40" />
          </div>
        )}

        {/* Floating tooltip */}
        {hoveredWeek && (
          <div
            className="absolute -top-10 transform -translate-x-1/2 pointer-events-none z-10"
            style={{ left: tooltipPos }}
          >
            <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 shadow-lg">
              <p className="text-[11px] whitespace-nowrap tabular-nums">
                <span className="text-[var(--color-text-tertiary)]">W{hoveredWeek.week}</span>
                <span className="mx-1.5 text-[var(--color-border)]">|</span>
                <span className={hoveredWeek.projected >= 0 ? "text-white" : "text-red-400"}>
                  {hoveredWeek.projected >= 0 ? hoveredWeek.projected.toLocaleString() : `−${Math.abs(hoveredWeek.projected).toLocaleString()}`}
                </span>
              </p>
            </div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[var(--color-border)]" />
          </div>
        )}

        {/* Quarter markers */}
        <div className="flex justify-between mt-1.5 px-px">
          {['Q1', 'Q2', 'Q3', 'Q4'].map((q, i) => (
            <span key={q} className="text-[9px] text-[var(--color-text-tertiary)]/40 font-medium tracking-wide">
              {q}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
