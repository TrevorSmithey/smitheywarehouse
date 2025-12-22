"use client";

import { useMemo, useState } from "react";

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

  // Get color based on inventory level
  const getColor = (percentRemaining: number): string => {
    if (percentRemaining >= 60) return "bg-emerald-500"; // Healthy
    if (percentRemaining >= 40) return "bg-emerald-400";
    if (percentRemaining >= 25) return "bg-yellow-400"; // Caution
    if (percentRemaining >= 10) return "bg-orange-400";
    if (percentRemaining > 0) return "bg-red-400"; // Critical
    return "bg-red-600"; // Stockout / negative
  };

  // Get stockout week
  const stockoutWeek = weeks.find(w => w.projected <= 0)?.week;

  if (!doi || doi <= 0) {
    return (
      <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
        <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
          52 Week Runway
        </p>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          No velocity data available
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">
          52 Week Runway
        </p>
        {stockoutWeek && (
          <p className="text-xs text-red-400">
            Stockout: Week {stockoutWeek}
          </p>
        )}
      </div>

      {/* Hover Info */}
      <div className="h-5 mb-2">
        {hoveredWeek ? (
          <p className="text-sm">
            <span className="text-[var(--color-text-tertiary)]">Week {hoveredWeek.week}:</span>{" "}
            <span className={hoveredWeek.projected >= 0 ? "text-white" : "text-red-400 font-medium"}>
              {hoveredWeek.projected.toLocaleString()} units
            </span>
            {hoveredWeek.projected < 0 && (
              <span className="text-red-400/70 text-xs ml-1">
                ({Math.abs(hoveredWeek.projected).toLocaleString()} short)
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Hover to see projected inventory
          </p>
        )}
      </div>

      {/* 52 Week Grid */}
      <div className="flex gap-[2px] flex-wrap">
        {weeks.map((week) => (
          <div
            key={week.week}
            className={`w-[14px] h-[14px] rounded-[2px] cursor-pointer transition-all
              ${getColor(week.percentRemaining)}
              ${hoveredWeek?.week === week.week ? "ring-2 ring-white ring-offset-1 ring-offset-[var(--color-bg-secondary)]" : ""}
              ${week.projected <= 0 ? "opacity-90" : ""}
            `}
            onMouseEnter={() => setHoveredWeek(week)}
            onMouseLeave={() => setHoveredWeek(null)}
            title={`Week ${week.week}: ${week.projected.toLocaleString()} units`}
          />
        ))}
      </div>

      {/* Month Labels */}
      <div className="flex justify-between mt-2 text-[10px] text-[var(--color-text-tertiary)]">
        <span>Jan</span>
        <span>Apr</span>
        <span>Jul</span>
        <span>Oct</span>
        <span>Dec</span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 text-[10px] text-[var(--color-text-tertiary)]">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-emerald-500" />
          <span>Healthy</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-yellow-400" />
          <span>Caution</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-red-400" />
          <span>Critical</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-red-600" />
          <span>Stockout</span>
        </div>
      </div>
    </div>
  );
}
