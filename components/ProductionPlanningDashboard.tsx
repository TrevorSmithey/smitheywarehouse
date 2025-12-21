"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  AlertTriangle,
  Download,
  ShoppingCart,
  Check,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Clock,
  Package,
  RefreshCw,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import type { ProductionPlanningResponse } from "@/app/api/production-planning/route";

// ============================================================================
// Types
// ============================================================================

interface Props {
  data: ProductionPlanningResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onPeriodChange?: (year: number, month: number) => void;
}

type TabType = "execute" | "orderbook" | "components" | "history";

interface OrderBookItem {
  sku: string;
  displayName: string;
  type: "component" | "accessory";
  available: number;
  required: number;
  shortfall: number;
  leadTimeDays: number | null;
  orderByDate: string | null;
  buffer: number; // per-item buffer percentage
  orderQty: number;
  isOrdered: boolean;
}

// ============================================================================
// Design System - Industrial Control Panel Aesthetic
// ============================================================================

// Blue input cells (Excel convention)
const INPUT_CELL = "bg-[#1e3a5f] text-[#58a6ff] font-mono tabular-nums text-right px-2 py-1 border border-[#30363d] hover:border-[#58a6ff] cursor-pointer transition-colors";
const INPUT_CELL_EDITING = "bg-[#1e3a5f] text-white font-mono tabular-nums text-right px-2 py-1 border-2 border-[#58a6ff] outline-none";

// Status colors
const STATUS = {
  good: "text-[#3fb950]",
  warning: "text-[#d29922]",
  bad: "text-[#f85149]",
  neutral: "text-[#8b949e]",
};

const STATUS_BG = {
  good: "bg-[#3fb950]/10",
  warning: "bg-[#d29922]/10",
  bad: "bg-[#f85149]/10",
};

// ============================================================================
// Utility Functions
// ============================================================================

function formatNum(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function getStatus(percent: number): "good" | "warning" | "bad" {
  if (percent >= 90) return "good";
  if (percent >= 70) return "warning";
  return "bad";
}

function getOrderByDate(leadTimeDays: number | null): string | null {
  if (!leadTimeDays) return null;
  const date = new Date();
  date.setDate(date.getDate() + leadTimeDays);
  return date.toISOString().split("T")[0];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ============================================================================
// Mini Progress Bar Component
// ============================================================================

function ProgressBar({ percent, size = "md" }: { percent: number; size?: "sm" | "md" }) {
  const status = getStatus(percent);
  const height = size === "sm" ? "h-1" : "h-1.5";
  const cappedPercent = Math.min(100, Math.max(0, percent));

  return (
    <div className={`w-full ${height} bg-[#21262d] rounded-full overflow-hidden`}>
      <div
        className={`${height} rounded-full transition-all ${
          status === "good" ? "bg-[#3fb950]" : status === "warning" ? "bg-[#d29922]" : "bg-[#f85149]"
        }`}
        style={{ width: `${cappedPercent}%` }}
      />
    </div>
  );
}

// ============================================================================
// Pace Indicator - Stable comparison of progress vs target (not volatile projections)
// ============================================================================

interface PaceIndicatorProps {
  producedMTD: number;
  target: number;
  daysElapsed: number;
  daysTotal: number;
}

function PaceIndicator({ producedMTD, target, daysElapsed, daysTotal }: PaceIndicatorProps) {
  const daysRemaining = daysTotal - daysElapsed;

  // Progress through month (time) vs progress through target (units)
  const timeProgress = (daysElapsed / daysTotal) * 100;
  const targetProgress = target > 0 ? (producedMTD / target) * 100 : 100;

  // Are we ahead or behind? Compare % of target complete vs % of time elapsed
  const isAhead = targetProgress >= timeProgress;
  const diffPercent = Math.abs(targetProgress - timeProgress);
  const remaining = Math.max(0, target - producedMTD);

  // Target already exceeded?
  const targetExceeded = producedMTD >= target;

  // Status thresholds (relative to time progress)
  const getStatus = () => {
    if (targetExceeded) return { label: "TARGET MET", color: "text-[#3fb950]", bg: "bg-[#3fb950]" };
    if (targetProgress >= timeProgress + 10) return { label: "AHEAD", color: "text-[#3fb950]", bg: "bg-[#3fb950]" };
    if (targetProgress >= timeProgress - 5) return { label: "ON PACE", color: "text-[#58a6ff]", bg: "bg-[#58a6ff]" };
    if (targetProgress >= timeProgress - 15) return { label: "SLIGHTLY BEHIND", color: "text-[#d29922]", bg: "bg-[#d29922]" };
    return { label: "BEHIND", color: "text-[#f85149]", bg: "bg-[#f85149]" };
  };

  const status = getStatus();

  return (
    <div className="space-y-3">
      {/* Visual progress bar - time vs production */}
      <div className="relative">
        {/* Background track */}
        <div className="h-8 bg-[#21262d] rounded overflow-hidden relative">
          {/* Time marker (where we are in the month) */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/50 z-10"
            style={{ left: `${timeProgress}%` }}
          />
          <div
            className="absolute -top-5 text-[10px] text-[#8b949e] transform -translate-x-1/2"
            style={{ left: `${timeProgress}%` }}
          >
            Today
          </div>

          {/* Production progress fill */}
          <div
            className={`absolute top-0 bottom-0 left-0 transition-all ${status.bg}/30`}
            style={{ width: `${Math.min(100, targetProgress)}%` }}
          />

          {/* Produced indicator */}
          <div
            className={`absolute top-0 bottom-0 w-1 ${status.bg}`}
            style={{ left: `${Math.min(100, targetProgress)}%` }}
          />
        </div>

        {/* Scale markers */}
        <div className="flex justify-between mt-1 text-[10px] text-[#484f58]">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Status and numbers */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className={`text-sm font-bold ${status.color}`}>{status.label}</span>
          {!targetExceeded && (
            <span className="text-xs text-[#8b949e]">
              {targetProgress.toFixed(0)}% complete with {timeProgress.toFixed(0)}% of month elapsed
            </span>
          )}
        </div>
        <div className="text-right">
          <span className="font-mono text-sm text-[#e6edf3]">{formatNum(producedMTD)}</span>
          <span className="text-[#8b949e]"> / </span>
          <span className="font-mono text-sm text-[#8b949e]">{formatNum(target)}</span>
          {!targetExceeded && (
            <span className="text-xs text-[#8b949e] ml-2">({formatNum(remaining)} to go, {daysRemaining}d left)</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Inventory Build Curve - Production vs Budget over time
// Shows if we're building inventory fast enough for seasonal demand
// ============================================================================

interface InventoryCurveChartProps {
  curve: ProductionPlanningResponse["aggregateCurve"];
  currentMonth: number;
  label?: string;
}

function InventoryCurveChart({ curve, currentMonth, label }: InventoryCurveChartProps) {
  if (!curve?.months?.length) return null;

  const months = curve.months;
  const maxValue = Math.max(
    ...months.map(m => Math.max(m.cumulativeBudget, m.cumulativeProduction))
  );

  // Chart dimensions
  const chartHeight = 120;
  const chartWidth = 100; // percentage

  // Generate path points
  const getY = (value: number) => chartHeight - (value / maxValue) * chartHeight;
  const getX = (index: number) => (index / 11) * 100;

  // Build SVG paths
  const budgetPath = months.map((m, i) =>
    `${i === 0 ? 'M' : 'L'} ${getX(i)}% ${getY(m.cumulativeBudget)}`
  ).join(' ');

  const productionPath = months.map((m, i) =>
    `${i === 0 ? 'M' : 'L'} ${getX(i)}% ${getY(m.cumulativeProduction)}`
  ).join(' ');

  // Fill area between curves (the gap)
  const gapPath = [
    ...months.map((m, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)}% ${getY(m.cumulativeProduction)}`),
    ...months.slice().reverse().map((m, i) => `L ${getX(11 - i)}% ${getY(m.cumulativeBudget)}`),
    'Z'
  ].join(' ');

  const currentGap = curve.currentGap;
  const statusColor = currentGap >= 0 ? "#3fb950" : "#f85149";
  const gapLabel = currentGap >= 0 ? `+${formatNum(currentGap)}` : formatNum(currentGap);

  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4">
      {label && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">{label}</span>
          <div className="flex items-center gap-4 text-[10px]">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-[#3fb950]"></span>
              Production
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-[#8b949e]"></span>
              Budget
            </span>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="relative" style={{ height: chartHeight }}>
        <svg className="w-full h-full" preserveAspectRatio="none">
          {/* Gap fill */}
          <path
            d={gapPath}
            fill={currentGap >= 0 ? "rgba(63, 185, 80, 0.15)" : "rgba(248, 81, 73, 0.15)"}
          />
          {/* Budget line (dashed) */}
          <path
            d={budgetPath}
            fill="none"
            stroke="#8b949e"
            strokeWidth="2"
            strokeDasharray="4 2"
            vectorEffect="non-scaling-stroke"
          />
          {/* Production line (solid) */}
          <path
            d={productionPath}
            fill="none"
            stroke="#3fb950"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {/* Current month marker */}
          <line
            x1={`${getX(currentMonth - 1)}%`}
            y1="0"
            x2={`${getX(currentMonth - 1)}%`}
            y2={chartHeight}
            stroke="#58a6ff"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        </svg>

        {/* Current position indicator */}
        <div
          className="absolute -translate-x-1/2"
          style={{
            left: `${getX(currentMonth - 1)}%`,
            top: getY(months[currentMonth - 1]?.cumulativeProduction || 0) - 20,
          }}
        >
          <div
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap"
            style={{ backgroundColor: statusColor, color: "#0d1117" }}
          >
            {gapLabel}
          </div>
        </div>
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between mt-2 text-[9px] text-[#484f58]">
        {months.map((m, i) => (
          <span
            key={m.month}
            className={i === currentMonth - 1 ? "text-[#58a6ff] font-bold" : ""}
          >
            {m.monthName.slice(0, 1)}
          </span>
        ))}
      </div>

      {/* Status summary */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#21262d]">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <span className="text-sm" style={{ color: statusColor }}>
            {currentGap >= 0 ? "Ahead of demand" : "Behind demand"}
          </span>
        </div>
        <div className="text-right">
          <span className="font-mono text-sm" style={{ color: statusColor }}>
            {gapLabel} units
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SKU Inventory Status Cards - Quick view of each SKU's position
// ============================================================================

interface SKUInventoryCardProps {
  curve: NonNullable<ProductionPlanningResponse["inventoryCurves"]>[0];
  onClick?: () => void;
}

function SKUInventoryCard({ curve, onClick }: SKUInventoryCardProps) {
  const statusColors = {
    critical: "#f85149",
    behind: "#d29922",
    on_track: "#8b949e",
    ahead: "#3fb950",
  };
  const statusLabels = {
    critical: "CRITICAL",
    behind: "BEHIND",
    on_track: "ON TRACK",
    ahead: "AHEAD",
  };

  const color = statusColors[curve.status];
  const gapLabel = curve.currentGap >= 0 ? `+${formatCompact(curve.currentGap)}` : formatCompact(curve.currentGap);

  return (
    <button
      onClick={onClick}
      className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 text-left hover:border-[#484f58] transition-colors w-full"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[#e6edf3] truncate">{curve.displayName}</span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-bold"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {statusLabels[curve.status]}
        </span>
      </div>

      {/* Mini sparkline of the gap */}
      <div className="h-6 flex items-end gap-px mb-2">
        {curve.months.map((m, i) => {
          const isPositive = m.gap >= 0;
          const maxGap = Math.max(...curve.months.map(x => Math.abs(x.gap)));
          const height = maxGap > 0 ? (Math.abs(m.gap) / maxGap) * 100 : 0;
          return (
            <div
              key={m.month}
              className="flex-1 rounded-t"
              style={{
                height: `${Math.max(2, height)}%`,
                backgroundColor: isPositive ? "#3fb950" : "#f85149",
                opacity: m.isActual ? 1 : 0.4,
              }}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-[#8b949e]">Current gap:</span>
        <span className="font-mono font-bold" style={{ color }}>{gapLabel}</span>
      </div>

      {curve.stockoutRisk && (
        <div className="flex items-center gap-1 mt-2 text-[10px] text-[#f85149]">
          <AlertTriangle className="w-3 h-3" />
          <span>Risk in {curve.minGapMonth}</span>
        </div>
      )}
    </button>
  );
}

// ============================================================================
// SKU Detail Page - Full Page Industrial Command Center
// ============================================================================
// Design: Industrial Control Room meets Bloomberg Terminal
// Hero: Year Timeline with Budget vs Actual and Cumulative Spillover
// ============================================================================

interface SKUDetailPageProps {
  sku: NonNullable<ProductionPlanningResponse["skuData"][0]>;
  period: ProductionPlanningResponse["period"];
  forecast: ProductionPlanningResponse["forecast"];
  components: ProductionPlanningResponse["components"];
  onBack: () => void;
}

interface YearTimelineMonth {
  month: string;
  monthNum: number;
  budget: number;
  actual: number | null;
  delta: number;
  cumulative: number;
  isCurrent: boolean;
  isFuture: boolean;
}

function SKUDetailPage({ sku, period, forecast, components, onBack }: SKUDetailPageProps) {
  const { daysElapsedInMonth, daysInMonth, monthName, year } = period;
  const daysRemaining = daysInMonth - daysElapsedInMonth;

  // Core metrics
  const target = sku.monthlyTarget;
  const produced = sku.producedMTD;
  const remaining = Math.max(0, target - produced);
  const percentComplete = target > 0 ? (produced / target) * 100 : 0;
  const timeProgress = (daysElapsedInMonth / daysInMonth) * 100;

  // Projection calculations (stable, forward-looking)
  const avgDailyRate = daysElapsedInMonth > 0 ? produced / daysElapsedInMonth : 0;
  const projectedTotal = avgDailyRate * daysInMonth;
  const projectedPercent = target > 0 ? (projectedTotal / target) * 100 : 0;
  const requiredDailyRate = daysRemaining > 0 ? remaining / daysRemaining : 0;

  // Status determination
  const getStatus = () => {
    if (produced >= target) {
      return { label: "TARGET MET", color: "#3fb950", icon: "✓" };
    }
    if (projectedPercent >= 110) {
      return { label: "AHEAD", color: "#3fb950", icon: "↑" };
    }
    if (projectedPercent >= 95) {
      return { label: "ON PACE", color: "#58a6ff", icon: "→" };
    }
    if (projectedPercent >= 80) {
      return { label: "AT RISK", color: "#d29922", icon: "!" };
    }
    return { label: "BEHIND", color: "#f85149", icon: "↓" };
  };

  const status = getStatus();
  const bom = sku.bomComponents || [];

  // Extract this SKU's forecast for remaining months of the year
  const skuForecast = useMemo(() => {
    if (!forecast) return [];
    return forecast
      .map((month) => {
        const skuTarget = month.skuTargets.find((t) => t.sku === sku.sku);
        return {
          year: month.year,
          month: month.month,
          monthName: month.monthName,
          target: skuTarget?.target || 0,
          canProduce: skuTarget?.canProduce || 0,
          hasConstraint: skuTarget?.hasConstraint || false,
        };
      })
      .filter((m) => m.target > 0); // Only months with targets
  }, [forecast, sku.sku]);

  // Get shared component data for this SKU's components
  const sharedComponentData = useMemo(() => {
    if (!components || !bom) return new Map<string, {
      totalDemandThisMonth: number;
      usedBySkus: Array<{ displayName: string; demandThisMonth: number }>;
    }>();

    const map = new Map<string, {
      totalDemandThisMonth: number;
      usedBySkus: Array<{ displayName: string; demandThisMonth: number }>;
    }>();

    bom.forEach((bomItem) => {
      const compData = components.find((c) => c.sku === bomItem.component);
      if (compData) {
        map.set(bomItem.component, {
          totalDemandThisMonth: compData.totalDemandThisMonth,
          usedBySkus: compData.usedBySkus || [],
        });
      }
    });

    return map;
  }, [components, bom]);

  // Simulated daily production data (in real app, would come from API)
  const dailyProduction = useMemo(() => {
    const days: { date: string; qty: number; running: number }[] = [];
    let running = 0;
    const avgPerDay = produced / Math.max(1, daysElapsedInMonth);

    for (let d = 1; d <= daysElapsedInMonth; d++) {
      // Add some variance for realism
      const variance = 0.3;
      const dayQty = Math.round(avgPerDay * (1 + (Math.random() - 0.5) * variance * 2));
      running += dayQty;
      days.push({
        date: `${monthName.slice(0, 3)} ${d}`,
        qty: dayQty,
        running: Math.min(running, produced), // Cap at actual produced
      });
    }

    // Normalize last day to match actual produced
    if (days.length > 0) {
      const diff = produced - days[days.length - 1].running;
      days[days.length - 1].qty += diff;
      days[days.length - 1].running = produced;
    }

    return days.slice(-10); // Last 10 days
  }, [produced, daysElapsedInMonth, monthName]);

  // Build year timeline data with budget vs actual and spillover
  const yearTimelineData = useMemo(() => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentMonth = period.month;
    const currentYear = period.year;

    // For now, use monthly target as budget baseline (in real app, would come from budgets table)
    // Production targets are level-loaded, so use that as budget
    const monthlyBudget = sku.monthlyTarget;

    // Build timeline with simulated historical data
    // In production, this would come from actual monthly production data
    const timeline: Array<{
      month: string;
      monthNum: number;
      budget: number;
      actual: number | null;  // null for future months
      delta: number;
      cumulative: number;
      isCurrent: boolean;
      isFuture: boolean;
    }> = [];

    let cumulativeDelta = 0;

    // Only show production months (Jan-Oct for 2026, or full year for 2025)
    const productionMonths = currentYear >= 2026 ? 10 : 12;

    for (let m = 1; m <= productionMonths; m++) {
      const isCurrent = m === currentMonth && currentYear === period.year;
      const isFuture = m > currentMonth || currentYear < period.year;

      // Simulate historical production (in real app, aggregate from assembly_sku_daily)
      let actual: number | null = null;
      if (!isFuture) {
        if (isCurrent) {
          actual = sku.producedMTD;
        } else {
          // Simulated historical - random variance around budget
          const variance = (Math.random() - 0.5) * 0.3;
          actual = Math.round(monthlyBudget * (1 + variance));
        }
      }

      const delta = actual !== null ? actual - monthlyBudget : 0;
      cumulativeDelta += delta;

      timeline.push({
        month: months[m - 1],
        monthNum: m,
        budget: monthlyBudget,
        actual,
        delta,
        cumulative: cumulativeDelta,
        isCurrent,
        isFuture,
      });
    }

    return timeline;
  }, [sku, period]);

  // Year totals
  const yearTotals = useMemo(() => {
    const budget = yearTimelineData.reduce((sum, m) => sum + m.budget, 0);
    const actual = yearTimelineData.reduce((sum, m) => sum + (m.actual || 0), 0);
    const remaining = budget - actual;
    const percentComplete = budget > 0 ? (actual / budget) * 100 : 0;
    // Cumulative is the running delta (actual - budget) up to the current month
    const currentOrLastMonth = yearTimelineData.find(m => m.isCurrent) || yearTimelineData.filter(m => !m.isFuture).pop();
    const cumulative = currentOrLastMonth?.cumulative || actual - budget;
    return { budget, actual, remaining, percentComplete, cumulative };
  }, [yearTimelineData]);

  // Max value for chart scaling
  const maxChartValue = Math.max(
    ...yearTimelineData.map(m => Math.max(m.budget, m.actual || 0)),
    1
  );

  // Max cumulative for spillover line scaling
  const maxCumulative = Math.max(
    ...yearTimelineData.map(m => Math.abs(m.cumulative)),
    1
  );

  return (
    <div className="min-h-screen bg-[#0a0c10]">
      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER - Compact, data-dense metrics row
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="sticky top-0 z-20 bg-[#0a0c10]/95 backdrop-blur-sm border-b border-[#21262d]">
        <div className="max-w-7xl mx-auto px-6">
          {/* Top row: Back + SKU name + Status */}
          <div className="flex items-center justify-between py-3 border-b border-[#21262d]/50">
            <div className="flex items-center gap-6">
              <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-[#8b949e] hover:text-[#58a6ff] transition-colors group"
              >
                <ChevronRight className="w-4 h-4 rotate-180 group-hover:-translate-x-1 transition-transform" />
                <span className="hidden sm:inline">Back</span>
              </button>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">{sku.displayName}</h1>
                <span className="text-xs font-mono text-[#484f58]">{sku.sku}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded"
                style={{ backgroundColor: `${status.color}15`, color: status.color, border: `1px solid ${status.color}40` }}
              >
                {status.icon} {status.label}
              </span>
              {sku.hasConstraint && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-[#f85149]/10 text-[#f85149] border border-[#f85149]/40 animate-pulse">
                  ⚠ BLOCKED
                </span>
              )}
            </div>
          </div>

          {/* Bottom row: Key metrics - horizontal data density */}
          <div className="flex items-center justify-between py-2 text-xs">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <span className="text-[#484f58] uppercase tracking-wider">Target</span>
                <span className="font-mono font-bold text-[#58a6ff] text-lg tabular-nums">{formatNum(target)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#484f58] uppercase tracking-wider">Produced</span>
                <span className="font-mono font-bold text-[#e6edf3] text-lg tabular-nums">{formatNum(produced)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#484f58] uppercase tracking-wider">Remaining</span>
                <span className={`font-mono font-bold text-lg tabular-nums ${remaining > 0 ? "text-[#d29922]" : "text-[#3fb950]"}`}>
                  {remaining > 0 ? formatNum(remaining) : "✓"}
                </span>
              </div>
              <div className="h-4 w-px bg-[#21262d]" />
              <div className="flex items-center gap-2">
                <span className="text-[#484f58]">Day {daysElapsedInMonth}/{daysInMonth}</span>
                <span className="text-[#8b949e]">·</span>
                <span className="text-[#8b949e]">{daysRemaining}d left</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[#8b949e]">
              <span>{monthName} {year}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          CONSTRAINT ALERT - Clean, action-oriented
          ═══════════════════════════════════════════════════════════════════════ */}
      {sku.hasConstraint && (
        <div className="bg-[#f85149]/5 border-b border-[#f85149]/30">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
            <AlertTriangle className="w-5 h-5 text-[#f85149] flex-shrink-0" />
            <div className="flex-1 text-sm">
              <span className="text-[#f85149] font-semibold">{sku.constrainingComponent}</span>
              <span className="text-[#8b949e]"> limits production to </span>
              <span className="font-mono font-bold text-[#f85149]">{formatNum(sku.maxProducible)}</span>
              <span className="text-[#8b949e]"> units. </span>
              <span className="text-[#e6edf3]">Short </span>
              <span className="font-mono font-bold text-[#f85149]">{formatNum(sku.shortfall)}</span>
              <span className="text-[#8b949e]"> components.</span>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[#8b949e] uppercase">Can Make</div>
              <div className="font-mono font-bold text-[#f85149] text-xl">{formatNum(sku.maxProducible)}</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MAIN CONTENT
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ─────────────────────────────────────────────────────────────────────
            YEAR TIMELINE - The Hero
            Budget vs Actual bar chart with cumulative spillover line
            ───────────────────────────────────────────────────────────────────── */}
        <div className="bg-[#0d1117] border border-[#21262d] rounded-lg overflow-hidden">
          {/* Chart Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#21262d]">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-[#e6edf3] uppercase tracking-wider">{year} Production Timeline</span>
              <span className="text-xs text-[#484f58]">Budget vs Actual with Spillover</span>
            </div>
            <div className="flex items-center gap-6 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-[#58a6ff] rounded-sm" />
                <span className="text-[#8b949e]">Budget</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-[#e6edf3] rounded-sm" />
                <span className="text-[#8b949e]">Actual</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-[#a371f7]" />
                <span className="text-[#8b949e]">Cumulative</span>
              </div>
            </div>
          </div>

          {/* Chart Body */}
          <div className="p-5">
            {/* Summary Stats Row */}
            <div className="flex items-end justify-between mb-6">
              <div className="flex items-center gap-8">
                <div>
                  <div className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Year Budget</div>
                  <div className="text-2xl font-mono font-bold text-[#58a6ff] tabular-nums">{formatNum(yearTotals.budget)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Year Actual</div>
                  <div className="text-2xl font-mono font-bold text-[#e6edf3] tabular-nums">{formatNum(yearTotals.actual)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Remaining</div>
                  <div className={`text-2xl font-mono font-bold tabular-nums italic ${yearTotals.remaining > 0 ? "text-[#d29922]" : "text-[#3fb950]"}`}>
                    {yearTotals.remaining > 0 ? formatNum(yearTotals.remaining) : "✓ Done"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-[#484f58] uppercase tracking-wider mb-1">Year Progress</div>
                <div className={`text-3xl font-mono font-bold tabular-nums italic ${yearTotals.percentComplete >= 100 ? "text-[#3fb950]" : "text-[#e6edf3]"}`}>
                  {yearTotals.percentComplete.toFixed(0)}%
                </div>
              </div>
            </div>

            {/* Legend + YTD Badge */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-6 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-[#58a6ff]/60 rounded-sm border border-[#58a6ff]" />
                  <span className="text-[#8b949e]">Budget</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-[#3fb950] rounded-sm" />
                  <span className="text-[#8b949e]">Over</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-[#f85149] rounded-sm" />
                  <span className="text-[#8b949e]">Under</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#8b949e]">YTD:</span>
                <span className={`font-mono font-bold px-2 py-0.5 rounded ${yearTotals.cumulative >= 0 ? "bg-[#238636]/20 text-[#3fb950]" : "bg-[#da3633]/20 text-[#f85149]"}`}>
                  {yearTotals.cumulative >= 0 ? "+" : ""}{formatNum(yearTotals.cumulative)}
                </span>
              </div>
            </div>

            {/* The Chart */}
            {(() => {
              const BAR_HEIGHT = 180;
              const niceMax = Math.ceil(maxChartValue / 500) * 500;
              const yLabels = [niceMax, Math.round(niceMax / 2), 0];

              return (
                <div className="flex">
                  {/* Y-Axis */}
                  <div className="flex flex-col justify-between pr-3 text-[10px] text-[#484f58] font-mono" style={{ height: BAR_HEIGHT }}>
                    {yLabels.map((val, i) => (
                      <span key={i}>{formatCompact(val)}</span>
                    ))}
                  </div>

                  {/* Chart Area */}
                  <div className="flex-1 relative" style={{ height: BAR_HEIGHT }}>
                    {/* Grid Lines */}
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                      <div className="border-t border-[#21262d]" />
                      <div className="border-t border-[#21262d] border-dashed opacity-50" />
                      <div className="border-t border-[#21262d]" />
                    </div>

                    {/* Bars Container */}
                    <div className="relative h-full flex items-end">
                      {yearTimelineData.map((m, i) => {
                        const budgetHeight = niceMax > 0 ? (m.budget / niceMax) * BAR_HEIGHT : 0;
                        const actualHeight = m.actual !== null && niceMax > 0 ? (m.actual / niceMax) * BAR_HEIGHT : 0;
                        const isOver = m.actual !== null && m.actual >= m.budget;
                        const isUnder = m.actual !== null && m.actual < m.budget;

                        return (
                          <div
                            key={i}
                            className={`flex-1 flex flex-col items-center relative ${m.isCurrent ? "bg-[#21262d]/50 -mx-px px-px rounded-t" : ""}`}
                            style={{ height: BAR_HEIGHT }}
                          >
                            {/* Bars - absolute positioned from bottom */}
                            <div className="absolute bottom-0 left-0 right-0 flex justify-center items-end gap-1 px-1">
                              {/* Budget Bar */}
                              <div
                                className="w-4 bg-[#58a6ff]/60 border border-[#58a6ff] rounded-t transition-all"
                                style={{ height: Math.max(1, budgetHeight) }}
                              />
                              {/* Actual Bar (only if we have data) */}
                              {m.actual !== null && (
                                <div
                                  className={`w-4 rounded-t transition-all ${isOver ? "bg-[#3fb950]" : "bg-[#f85149]"}`}
                                  style={{ height: Math.max(1, actualHeight) }}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* X-Axis Labels */}
            <div className="flex mt-2">
              <div className="w-10" /> {/* Spacer for Y-axis */}
              <div className="flex-1 flex">
                {yearTimelineData.map((m, i) => (
                  <div key={i} className={`flex-1 text-center ${m.isCurrent ? "bg-[#21262d]/50 rounded-b py-1 -mt-1" : ""}`}>
                    <div className={`text-[10px] font-medium ${m.isCurrent ? "text-[#e6edf3]" : m.isFuture ? "text-[#484f58]" : "text-[#8b949e]"}`}>
                      {m.month}
                    </div>
                    <div className={`text-[10px] font-mono ${m.delta > 0 ? "text-[#3fb950]" : m.delta < 0 ? "text-[#f85149]" : "text-[#484f58]"}`}>
                      {m.isFuture ? "—" : m.delta > 0 ? `+${formatNum(m.delta)}` : m.delta < 0 ? formatNum(m.delta) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────────────
            TWO COLUMN: Current Month Focus + BOM Table
            ───────────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-12 gap-6">
          {/* Current Month Focus */}
          <div className="col-span-4 bg-[#0d1117] border border-[#21262d] rounded-lg p-5">
            <div className="text-xs text-[#484f58] uppercase tracking-wider mb-4">Current Month Focus</div>

            {/* Circular Progress */}
            <div className="flex justify-center mb-4">
              <div className="relative w-32 h-32">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="64" cy="64" r="56"
                    fill="none" stroke="#21262d" strokeWidth="8"
                  />
                  <circle
                    cx="64" cy="64" r="56"
                    fill="none"
                    stroke={status.color}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${Math.min(100, percentComplete) * 3.52} 352`}
                    className="transition-all duration-700"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-mono font-bold" style={{ color: status.color }}>
                    {percentComplete.toFixed(0)}%
                  </span>
                  <span className="text-[10px] text-[#8b949e]">complete</span>
                </div>
              </div>
            </div>

            {/* Pace comparison */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#8b949e]">Time elapsed</span>
                <span className="text-xs font-mono text-[#e6edf3]">{timeProgress.toFixed(0)}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#8b949e]">Target progress</span>
                <span className="text-xs font-mono" style={{ color: status.color }}>{percentComplete.toFixed(0)}%</span>
              </div>
              <div className="h-px bg-[#21262d]" />
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#8b949e]">Avg daily</span>
                <span className="text-xs font-mono text-[#e6edf3]">{formatNum(Math.round(avgDailyRate))}/day</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#8b949e]">Need daily</span>
                <span className={`text-xs font-mono ${requiredDailyRate > avgDailyRate * 1.2 ? "text-[#f85149]" : "text-[#e6edf3]"}`}>
                  {daysRemaining > 0 ? `${formatNum(Math.ceil(requiredDailyRate))}/day` : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* BOM Components Table */}
          <div className="col-span-8 bg-[#0d1117] border border-[#21262d] rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#21262d]">
              <span className="text-xs text-[#484f58] uppercase tracking-wider">Bill of Materials</span>
              <span className="text-xs text-[#484f58]">{bom.length} components</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-[#484f58] uppercase tracking-wider">
                    <th className="text-left p-3 font-medium">Component</th>
                    <th className="text-right p-3 font-medium">Qty</th>
                    <th className="text-right p-3 font-medium">Need</th>
                    <th className="text-right p-3 font-medium">Avail</th>
                    <th className="text-right p-3 font-medium">Can Make</th>
                    <th className="text-center p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#21262d]/50">
                  {bom.map((comp) => {
                    const isLimiting = comp.isConstraining;
                    const needForTarget = comp.qtyRequired * target;

                    return (
                      <tr
                        key={comp.component}
                        className={`${isLimiting ? "bg-[#f85149]/5" : "hover:bg-[#161b22]"} transition-colors`}
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {isLimiting && <AlertTriangle className="w-3 h-3 text-[#f85149]" />}
                            <span className={`font-medium truncate ${isLimiting ? "text-[#f85149]" : "text-[#e6edf3]"}`}>
                              {comp.component}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono text-[#8b949e]">{comp.qtyRequired}</td>
                        <td className="p-3 text-right font-mono text-[#e6edf3]">{formatCompact(needForTarget)}</td>
                        <td className="p-3 text-right font-mono text-[#e6edf3]">{formatCompact(comp.available)}</td>
                        <td className="p-3 text-right">
                          <span className={`font-mono font-bold ${isLimiting ? "text-[#f85149]" : "text-[#e6edf3]"}`}>
                            {comp.canMake < 0 ? "∞" : formatCompact(comp.canMake)}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                            isLimiting
                              ? "bg-[#f85149]/20 text-[#f85149]"
                              : "bg-[#3fb950]/20 text-[#3fb950]"
                          }`}>
                            {isLimiting ? "LIMIT" : "OK"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ============================================================================
// Critical Constraint Alert Banner - Clickable for drill-down
// ============================================================================

interface ConstraintAlertBannerProps {
  alerts: Array<{
    sku: string;
    displayName: string;
    monthlyTarget: number;
    maxProducible: number;
    shortfall: number;
    constrainingComponent: string;
    componentAvailable: number;
  }>;
  onSkuClick?: (sku: string) => void;
}

function ConstraintAlertBanner({ alerts, onSkuClick }: ConstraintAlertBannerProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="bg-[#f85149]/10 border border-[#f85149]/50 rounded-lg overflow-hidden">
      <div className="bg-[#f85149]/20 px-4 py-1.5 flex items-center gap-2 border-b border-[#f85149]/30">
        <AlertCircle className="w-4 h-4 text-[#f85149]" />
        <span className="text-sm font-semibold text-[#f85149] uppercase tracking-wider">
          {alerts.length} SKU{alerts.length > 1 ? "s" : ""} Blocked by Components
        </span>
      </div>
      <div className="divide-y divide-[#21262d]">
        {alerts.map((alert) => (
          <button
            key={alert.sku}
            onClick={() => onSkuClick?.(alert.sku)}
            className="w-full text-left px-4 py-2 hover:bg-[#21262d] transition-colors flex items-center gap-4 text-sm group"
          >
            <div className="flex-1 min-w-0">
              <span className="font-medium text-[#e6edf3] group-hover:text-[#58a6ff]">{alert.displayName}</span>
              <span className="text-[#484f58] ml-2 text-xs">click for detail →</span>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[#8b949e]">Want </span>
              <span className="font-mono text-[#e6edf3]">{formatNum(alert.monthlyTarget)}</span>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[#8b949e]">Can make </span>
              <span className="font-mono text-[#f85149] font-bold">{formatNum(alert.maxProducible)}</span>
            </div>
            <div className="bg-[#21262d] rounded px-2 py-1 shrink-0">
              <span className="text-xs text-[#f85149]">{alert.constrainingComponent}</span>
              <span className="text-xs text-[#8b949e]"> ({formatNum(alert.componentAvailable)})</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Editable Cell Component
// ============================================================================

interface EditableCellProps {
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}

function EditableCell({ value, onChange, suffix = "" }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value.toString());

  const handleBlur = () => {
    setEditing(false);
    const newValue = parseInt(tempValue) || 0;
    if (newValue !== value) {
      onChange(newValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      setTempValue(value.toString());
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        type="number"
        value={tempValue}
        onChange={(e) => setTempValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={INPUT_CELL_EDITING}
        style={{ width: "80px" }}
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => {
        setTempValue(value.toString());
        setEditing(true);
      }}
      className={INPUT_CELL}
      title="Click to edit"
    >
      {formatNum(value)}{suffix}
    </button>
  );
}

// ============================================================================
// Tab Navigation
// ============================================================================

interface TabNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  orderBookCount: number;
}

function TabNav({ activeTab, onTabChange, orderBookCount }: TabNavProps) {
  const tabs: { id: TabType; label: string; badge?: number }[] = [
    { id: "execute", label: "EXECUTE" },
    { id: "orderbook", label: "ORDER BOOK", badge: orderBookCount },
    { id: "components", label: "COMPONENTS" },
    { id: "history", label: "HISTORY" },
  ];

  return (
    <div className="flex border-b border-[#30363d]">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative px-4 py-2 text-xs font-semibold tracking-wider transition-colors border-b-2 -mb-px ${
              isActive
                ? "border-[#58a6ff] text-[#58a6ff]"
                : "border-transparent text-[#8b949e] hover:text-[#c9d1d9]"
            }`}
          >
            {tab.label}
            {tab.badge && tab.badge > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#f85149] text-white">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Month Selector Component
// ============================================================================

interface MonthSelectorProps {
  currentYear: number;
  currentMonth: number;
  selectedYear: number;
  selectedMonth: number;
  onMonthChange: (year: number, month: number) => void;
}

function MonthSelector({ currentYear, currentMonth, selectedYear, selectedMonth, onMonthChange }: MonthSelectorProps) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Generate array of months (3 months back, current, 3 months forward)
  const monthOptions = useMemo(() => {
    const options: { year: number; month: number; label: string; isCurrent: boolean; isFuture: boolean }[] = [];

    for (let offset = -2; offset <= 4; offset++) {
      let m = currentMonth + offset;
      let y = currentYear;

      if (m > 12) {
        m -= 12;
        y += 1;
      } else if (m < 1) {
        m += 12;
        y -= 1;
      }

      options.push({
        year: y,
        month: m,
        label: `${months[m - 1]} ${y.toString().slice(-2)}`,
        isCurrent: y === currentYear && m === currentMonth,
        isFuture: y > currentYear || (y === currentYear && m > currentMonth),
      });
    }

    return options;
  }, [currentYear, currentMonth]);

  return (
    <div className="flex items-center gap-1 bg-[#161b22] rounded-lg p-1 border border-[#30363d]">
      {monthOptions.map((opt) => {
        const isSelected = opt.year === selectedYear && opt.month === selectedMonth;

        return (
          <button
            key={`${opt.year}-${opt.month}`}
            onClick={() => onMonthChange(opt.year, opt.month)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
              isSelected
                ? "bg-[#58a6ff] text-white"
                : opt.isCurrent
                  ? "bg-[#30363d] text-[#e6edf3] hover:bg-[#484f58]"
                  : opt.isFuture
                    ? "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
                    : "text-[#484f58] hover:bg-[#21262d] hover:text-[#8b949e]"
            }`}
          >
            {opt.label}
            {opt.isCurrent && !isSelected && (
              <span className="ml-1 text-[8px] text-[#3fb950]">●</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Hero Summary Panel - THE MISSION (Projection-Based, Stable)
// ============================================================================

interface HeroSummaryProps {
  period: ProductionPlanningResponse["period"];
  summary: ProductionPlanningResponse["summary"];
  constraintCount: number;
}

function HeroSummary({ period, summary, constraintCount }: HeroSummaryProps) {
  const { daysElapsedInMonth, daysInMonth } = period;
  const { totalMonthlyTarget: target, totalProducedMTD: produced } = summary;

  // Core calculations
  const timeProgress = (daysElapsedInMonth / daysInMonth) * 100;
  const targetProgress = target > 0 ? (produced / target) * 100 : 0;
  const remaining = Math.max(0, target - produced);
  const daysRemaining = daysInMonth - daysElapsedInMonth;

  // PROJECTION-BASED APPROACH (stable, forward-looking)
  // "If we keep going at this average rate, where will we end up?"
  const avgDailyRate = daysElapsedInMonth > 0 ? produced / daysElapsedInMonth : 0;
  const projectedTotal = avgDailyRate * daysInMonth;
  const projectedPercent = target > 0 ? (projectedTotal / target) * 100 : 0;

  // Required rate to hit target from here
  const requiredDailyRate = daysRemaining > 0 ? remaining / daysRemaining : 0;

  // Confidence level (how much to trust the projection)
  // Early in month = low confidence, late in month = high confidence
  const confidenceLevel = timeProgress; // 0-100 as we progress through month

  // STATUS DETERMINATION (based on projection, not point-in-time)
  // Using projection is more stable because daily variance gets averaged out
  const getStatus = () => {
    // Already hit target
    if (produced >= target) {
      return {
        label: "TARGET MET",
        color: "#3fb950",
        message: "Production goal achieved!",
        icon: "✓"
      };
    }

    // Use projection to determine status
    if (projectedPercent >= 110) {
      return {
        label: "AHEAD",
        color: "#3fb950",
        message: `Projecting ${projectedPercent.toFixed(0)}% of target`,
        icon: "↑"
      };
    }
    if (projectedPercent >= 95) {
      return {
        label: "ON PACE",
        color: "#58a6ff",
        message: `Projecting ${projectedPercent.toFixed(0)}% of target`,
        icon: "→"
      };
    }
    if (projectedPercent >= 80) {
      return {
        label: "AT RISK",
        color: "#d29922",
        message: `Need ${formatNum(Math.ceil(requiredDailyRate))}/day to hit target`,
        icon: "!"
      };
    }
    return {
      label: "BEHIND",
      color: "#f85149",
      message: `Need ${formatNum(Math.ceil(requiredDailyRate))}/day to hit target`,
      icon: "↓"
    };
  };

  const status = getStatus();

  // Confidence messaging
  const getConfidenceLabel = () => {
    if (confidenceLevel < 20) return "Early in month";
    if (confidenceLevel < 50) return "Building confidence";
    if (confidenceLevel < 75) return "Reliable projection";
    return "High confidence";
  };

  return (
    <div className="bg-gradient-to-br from-[#161b22] to-[#0d1117] border border-[#30363d] rounded-lg p-6">
      {/* Main Stats Row */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {/* Target - THE MISSION */}
        <div className="col-span-2">
          <div className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Production Target</div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-mono font-bold text-[#e6edf3] tabular-nums">
              {formatNum(target)}
            </span>
            <span className="text-lg text-[#8b949e]">units</span>
          </div>
          <div className="text-sm text-[#8b949e] mt-1">
            {period.monthName} {period.year}
          </div>
        </div>

        {/* Produced - THE PROGRESS */}
        <div>
          <div className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Produced</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-[#e6edf3] tabular-nums">
              {formatNum(produced)}
            </span>
          </div>
          <div className="text-sm text-[#8b949e] mt-1">
            {targetProgress.toFixed(0)}% complete
          </div>
        </div>

        {/* Projected - THE FORECAST */}
        <div>
          <div className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Projected</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold tabular-nums" style={{ color: status.color }}>
              {formatNum(Math.round(projectedTotal))}
            </span>
          </div>
          <div className="text-sm text-[#8b949e] mt-1">
            {projectedPercent.toFixed(0)}% of target
          </div>
        </div>

        {/* Remaining - THE GAP */}
        <div>
          <div className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Remaining</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-[#e6edf3] tabular-nums">
              {formatNum(remaining)}
            </span>
          </div>
          <div className="text-sm text-[#8b949e] mt-1">
            {daysRemaining}d left
          </div>
        </div>
      </div>

      {/* Visual Progress Bar with Projection Marker */}
      <div className="relative mb-4">
        <div className="h-12 bg-[#21262d] rounded-lg overflow-hidden relative">
          {/* Production progress fill (actual) */}
          <div
            className="absolute top-0 bottom-0 left-0 transition-all duration-500"
            style={{
              width: `${Math.min(100, targetProgress)}%`,
              background: `linear-gradient(90deg, ${status.color}30 0%, ${status.color}50 100%)`
            }}
          />

          {/* Projection zone (dashed line from current to projected) */}
          {!produced || produced < target ? (
            <div
              className="absolute top-0 bottom-0 transition-all duration-500 opacity-30"
              style={{
                left: `${Math.min(100, targetProgress)}%`,
                width: `${Math.max(0, Math.min(100, projectedPercent) - Math.min(100, targetProgress))}%`,
                background: `repeating-linear-gradient(90deg, ${status.color}40 0px, ${status.color}40 4px, transparent 4px, transparent 8px)`
              }}
            />
          ) : null}

          {/* Production marker (current position - solid) */}
          <div
            className="absolute top-0 bottom-0 w-1.5 transition-all duration-500 rounded"
            style={{
              left: `${Math.min(100, targetProgress)}%`,
              backgroundColor: status.color,
              transform: "translateX(-50%)"
            }}
          />

          {/* Projection marker (where we're heading - hollow) */}
          {produced < target && projectedPercent < 150 && (
            <div
              className="absolute top-1 bottom-1 w-1.5 transition-all duration-500 rounded border-2"
              style={{
                left: `${Math.min(100, projectedPercent)}%`,
                borderColor: status.color,
                backgroundColor: "transparent",
                transform: "translateX(-50%)"
              }}
            />
          )}

          {/* Time marker (where we are in the month - white line) */}
          <div
            className="absolute top-0 bottom-0 w-px bg-white/60 z-10"
            style={{ left: `${timeProgress}%` }}
          >
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-[#8b949e] whitespace-nowrap">
              Day {daysElapsedInMonth}
            </div>
          </div>

          {/* Labels on the bar */}
          <div className="absolute inset-0 flex items-center px-4">
            <div className="flex-1">
              <span className="text-sm font-bold text-white/90">
                {targetProgress.toFixed(0)}%
              </span>
              <span className="text-xs text-white/50 ml-2">actual</span>
            </div>
            {produced < target && (
              <div className="text-right">
                <span className="text-xs text-white/50">projecting </span>
                <span className="text-sm font-bold" style={{ color: status.color }}>
                  {projectedPercent.toFixed(0)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Scale markers and legend */}
        <div className="flex justify-between mt-1.5 text-[10px] text-[#484f58] px-1">
          <span>0</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Status Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="text-sm font-bold uppercase tracking-wider px-3 py-1.5 rounded flex items-center gap-2"
            style={{
              backgroundColor: `${status.color}20`,
              color: status.color
            }}
          >
            <span>{status.icon}</span>
            {status.label}
          </span>
          <span className="text-sm text-[#8b949e]">{status.message}</span>
          {produced < target && (
            <span className="text-xs text-[#484f58] border-l border-[#30363d] pl-3">
              {getConfidenceLabel()} · Avg {formatNum(Math.round(avgDailyRate))}/day
            </span>
          )}
        </div>

        {constraintCount > 0 && (
          <div className="flex items-center gap-2 text-[#f85149]">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">{constraintCount} SKU{constraintCount > 1 ? "s" : ""} blocked</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Execute Tab - Monthly Production Tracking (Redesigned as Intelligence Dashboard)
// ============================================================================

interface ExecuteTabProps {
  data: ProductionPlanningResponse;
  onTargetChange: (sku: string, newTarget: number) => void;
  onSkuDrillDown: (sku: string) => void;
  selectedMonth: { year: number; month: number };
  onMonthChange: (year: number, month: number) => void;
}

function ExecuteTab({ data, onTargetChange, onSkuDrillDown, selectedMonth, onMonthChange }: ExecuteTabProps) {
  const { period, summary, skuData, constraintAlerts } = data;
  const [sortBy, setSortBy] = useState<"sku" | "percent" | "target">("percent");
  const [sortAsc, setSortAsc] = useState(true);
  const [showConstraintsExpanded, setShowConstraintsExpanded] = useState(false);

  // Dismissible alerts - stored in localStorage
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("dismissed-production-alerts");
      if (stored) {
        const parsed = JSON.parse(stored);
        // Include month/year in key so dismissals reset monthly
        const key = `${period.year}-${period.month}`;
        return new Set(parsed[key] || []);
      }
    } catch { /* ignore */ }
    return new Set();
  });
  const [showDismissed, setShowDismissed] = useState(false);

  // Save dismissed alerts to localStorage
  const dismissAlert = (componentSku: string) => {
    setDismissedAlerts(prev => {
      const next = new Set(prev);
      next.add(componentSku);
      // Save to localStorage with month key
      try {
        const stored = localStorage.getItem("dismissed-production-alerts");
        const parsed = stored ? JSON.parse(stored) : {};
        const key = `${period.year}-${period.month}`;
        parsed[key] = Array.from(next);
        localStorage.setItem("dismissed-production-alerts", JSON.stringify(parsed));
      } catch { /* ignore */ }
      return next;
    });
  };

  const restoreAlert = (componentSku: string) => {
    setDismissedAlerts(prev => {
      const next = new Set(prev);
      next.delete(componentSku);
      // Save to localStorage
      try {
        const stored = localStorage.getItem("dismissed-production-alerts");
        const parsed = stored ? JSON.parse(stored) : {};
        const key = `${period.year}-${period.month}`;
        parsed[key] = Array.from(next);
        localStorage.setItem("dismissed-production-alerts", JSON.stringify(parsed));
      } catch { /* ignore */ }
      return next;
    });
  };

  // Filter alerts - show active vs dismissed
  const activeAlerts = constraintAlerts.filter(a => !dismissedAlerts.has(a.constrainingComponent));
  const hiddenAlerts = constraintAlerts.filter(a => dismissedAlerts.has(a.constrainingComponent));

  // Filter to only SKUs with targets
  const activeSkus = useMemo(() => {
    return skuData
      .filter((s) => s.monthlyTarget > 0)
      .sort((a, b) => {
        let cmp = 0;
        if (sortBy === "percent") cmp = a.percentToMonthlyTarget - b.percentToMonthlyTarget;
        else if (sortBy === "target") cmp = a.monthlyTarget - b.monthlyTarget;
        else cmp = a.displayName.localeCompare(b.displayName);
        return sortAsc ? cmp : -cmp;
      });
  }, [skuData, sortBy, sortAsc]);

  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(column);
      setSortAsc(column === "sku");
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Month Selector - Planning Ahead */}
      <div className="flex items-center justify-between">
        <MonthSelector
          currentYear={period.year}
          currentMonth={period.month}
          selectedYear={selectedMonth.year}
          selectedMonth={selectedMonth.month}
          onMonthChange={onMonthChange}
        />
        <div className="text-xs text-[#8b949e]">
          {selectedMonth.year === period.year && selectedMonth.month === period.month
            ? "Viewing current month"
            : selectedMonth.year > period.year || (selectedMonth.year === period.year && selectedMonth.month > period.month)
              ? "Viewing future plan"
              : "Viewing past month"
          }
        </div>
      </div>

      {/* Hero Summary - THE MISSION */}
      <HeroSummary
        period={period}
        summary={summary}
        constraintCount={constraintAlerts.length}
      />

      {/* SKU Progress Chart - Visual at-a-glance for all SKUs */}
      {activeSkus.length > 0 && (
        <div className="border border-[#30363d] rounded-lg overflow-hidden">
          <div className="bg-[#161b22] px-4 py-2 border-b border-[#30363d]">
            <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Monthly Progress by SKU</span>
          </div>
          <div className="p-4 space-y-2 max-h-[300px] overflow-y-auto">
            {activeSkus.map((sku) => {
              const percent = sku.percentToMonthlyTarget;
              const status = sku.hasConstraint ? "bad" : getStatus(percent);
              const statusColor = status === "good" ? "#3fb950" : status === "warning" ? "#d29922" : "#f85149";

              return (
                <button
                  key={sku.sku}
                  onClick={() => onSkuDrillDown(sku.sku)}
                  className="w-full flex items-center gap-3 hover:bg-[#21262d] rounded p-1 -m-1 transition-colors group"
                >
                  {/* Product Name + Monthly Target together */}
                  <div className="w-40 flex items-baseline gap-1.5 flex-shrink-0">
                    <span className="text-xs text-[#e6edf3] truncate group-hover:text-[#58a6ff]">
                      {sku.displayName}
                    </span>
                    <span className="text-[10px] text-[#58a6ff] font-mono tabular-nums">
                      ({formatCompact(sku.monthlyTarget)})
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="flex-1 h-6 bg-[#21262d] rounded overflow-hidden relative">
                    <div
                      className="absolute top-0 bottom-0 left-0 rounded transition-all"
                      style={{
                        width: `${Math.min(100, percent)}%`,
                        backgroundColor: statusColor,
                        opacity: 0.6,
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white">
                      {percent.toFixed(0)}%
                    </span>
                  </div>
                  {/* MTD produced */}
                  <span className="w-16 text-right font-mono text-xs text-[#8b949e]">
                    {formatCompact(sku.producedMTD)}
                  </span>
                  {sku.hasConstraint && (
                    <AlertTriangle className="w-3 h-3 text-[#f85149] flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Constraints Alert (Collapsible + Dismissible) */}
      {activeAlerts.length > 0 && (
        <div className="bg-[#f85149]/5 border border-[#f85149]/30 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowConstraintsExpanded(!showConstraintsExpanded)}
            className="w-full flex items-center justify-between px-4 py-2 hover:bg-[#f85149]/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#f85149]" />
              <span className="text-sm font-medium text-[#f85149]">
                {activeAlerts.length} Production Constraint{activeAlerts.length > 1 ? "s" : ""}
              </span>
              <span className="text-xs text-[#8b949e]">
                — Component shortages limiting production
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 text-[#f85149] transition-transform ${showConstraintsExpanded ? "rotate-180" : ""}`} />
          </button>

          {showConstraintsExpanded && (
            <div className="border-t border-[#f85149]/20 divide-y divide-[#21262d]">
              {activeAlerts.map((alert) => (
                <div
                  key={alert.sku}
                  className="flex items-center gap-2 px-4 py-2 hover:bg-[#21262d] transition-colors text-sm"
                >
                  <button
                    onClick={() => onSkuDrillDown(alert.sku)}
                    className="flex-1 flex items-center gap-4 text-left group"
                  >
                    <span className="font-medium text-[#e6edf3] group-hover:text-[#58a6ff] flex-1">{alert.displayName}</span>
                    <span className="text-[#8b949e]">Target: <span className="font-mono text-[#e6edf3]">{formatNum(alert.monthlyTarget)}</span></span>
                    <span className="text-[#f85149]">Can make: <span className="font-mono font-bold">{formatNum(alert.maxProducible)}</span></span>
                    <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#f85149]">
                      {alert.constrainingComponent}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissAlert(alert.constrainingComponent);
                    }}
                    className="text-[10px] px-2 py-1 rounded bg-[#21262d] text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#30363d] transition-colors"
                    title="Dismiss this alert (e.g., if component is arriving soon)"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Show dismissed alerts count if any */}
      {hiddenAlerts.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-[#21262d] rounded-lg text-xs">
          <span className="text-[#8b949e]">
            {hiddenAlerts.length} alert{hiddenAlerts.length > 1 ? "s" : ""} dismissed
          </span>
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className="text-[#58a6ff] hover:underline"
          >
            {showDismissed ? "Hide" : "Show"}
          </button>
        </div>
      )}

      {/* Dismissed alerts list */}
      {showDismissed && hiddenAlerts.length > 0 && (
        <div className="border border-[#30363d] rounded-lg overflow-hidden">
          <div className="bg-[#161b22] px-4 py-2 border-b border-[#30363d]">
            <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Dismissed Alerts</span>
          </div>
          <div className="divide-y divide-[#21262d]">
            {hiddenAlerts.map((alert) => (
              <div
                key={alert.sku}
                className="flex items-center justify-between px-4 py-2 text-sm text-[#8b949e]"
              >
                <span>{alert.displayName} — {alert.constrainingComponent}</span>
                <button
                  onClick={() => restoreAlert(alert.constrainingComponent)}
                  className="text-[10px] px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] transition-colors"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SKU Table - Excel-like with inline pace visualization */}
      <div className="border border-[#30363d] rounded-lg overflow-hidden">
        <div className="bg-[#161b22] px-4 py-2 border-b border-[#30363d] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">SKU Breakdown</span>
          <span className="text-xs text-[#484f58]">{activeSkus.length} products with targets</span>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#0d1117] text-[10px] text-[#8b949e] uppercase tracking-wider">
              <th
                className="text-left p-3 border-b border-[#30363d] cursor-pointer hover:text-[#e6edf3]"
                onClick={() => handleSort("sku")}
              >
                SKU {sortBy === "sku" && (sortAsc ? "↑" : "↓")}
              </th>
              <th
                className="text-right p-3 border-b border-[#30363d] cursor-pointer hover:text-[#e6edf3] w-24"
                onClick={() => handleSort("target")}
              >
                <span className="text-[#58a6ff]">Target</span> {sortBy === "target" && (sortAsc ? "↑" : "↓")}
              </th>
              <th className="text-right p-3 border-b border-[#30363d] w-24">Produced</th>
              <th className="text-right p-3 border-b border-[#30363d] w-24">Remaining</th>
              <th
                className="text-center p-3 border-b border-[#30363d] w-40 cursor-pointer hover:text-[#e6edf3]"
                onClick={() => handleSort("percent")}
              >
                Progress {sortBy === "percent" && (sortAsc ? "↑" : "↓")}
              </th>
              <th className="text-right p-3 border-b border-[#30363d] w-24">Can Make</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {activeSkus.map((sku, idx) => {
              const remaining = Math.max(0, sku.monthlyTarget - sku.producedMTD);
              const percent = sku.percentToMonthlyTarget;
              const status = sku.hasConstraint ? "bad" : getStatus(percent);
              const statusColor = status === "good" ? "#3fb950" : status === "warning" ? "#d29922" : "#f85149";

              return (
                <tr
                  key={sku.sku}
                  className={`border-b border-[#21262d] hover:bg-[#1f2428] transition-colors ${idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#161b22]"}`}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSkuDrillDown(sku.sku)}
                        className="text-[#e6edf3] font-medium hover:text-[#58a6ff] hover:underline transition-colors text-left"
                      >
                        {sku.displayName}
                      </button>
                      {sku.hasConstraint && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f85149]/20 text-[#f85149]">
                          BLOCKED
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    <EditableCell
                      value={sku.monthlyTarget}
                      onChange={(val) => onTargetChange(sku.sku, val)}
                    />
                  </td>
                  <td className="p-3 text-right text-[#e6edf3]">{formatNum(sku.producedMTD)}</td>
                  <td className="p-3 text-right text-[#8b949e]">{formatNum(remaining)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {/* Visual progress bar */}
                      <div className="flex-1 h-5 bg-[#21262d] rounded overflow-hidden relative">
                        <div
                          className="absolute top-0 bottom-0 left-0 rounded transition-all"
                          style={{
                            width: `${Math.min(100, percent)}%`,
                            backgroundColor: `${statusColor}50`
                          }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-0.5 rounded"
                          style={{
                            left: `${Math.min(100, percent)}%`,
                            backgroundColor: statusColor
                          }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/80">
                          {percent.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={`p-3 text-right ${sku.maxProducible >= 0 && sku.maxProducible < remaining ? "text-[#f85149]" : "text-[#8b949e]"}`}>
                    {sku.maxProducible < 0 ? "∞" : formatNum(sku.maxProducible)}
                    {sku.maxProducible >= 0 && sku.maxProducible < remaining && (
                      <AlertTriangle className="w-3 h-3 inline ml-1 text-[#f85149]" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend - Subtle */}
      <div className="flex items-center justify-center gap-8 text-[10px] text-[#484f58]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#1e3a5f] border border-[#30363d]" />
          <span>Editable</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#3fb950]" />
          <span>≥90%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#d29922]" />
          <span>70-89%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#f85149]" />
          <span>&lt;70%</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Order Book Tab - Intelligence: What to Order, How Much, When, Why
// ============================================================================

interface OrderBookTabProps {
  data: ProductionPlanningResponse;
  orderBook: OrderBookItem[];
  onBufferChange: (sku: string, buffer: number) => void;
  onMarkOrdered: (sku: string) => void;
}

function OrderBookTab({ data, orderBook, onBufferChange }: OrderBookTabProps) {
  const activeItems = orderBook.filter((item) => item.shortfall > 0);

  // Sort by urgency: items with lead time that need ordering soonest first
  const sortedItems = useMemo(() => {
    return [...activeItems].sort((a, b) => {
      // Components (production blockers) first, then accessories
      if (a.type === "component" && b.type !== "component") return -1;
      if (a.type !== "component" && b.type === "component") return 1;
      // Then by shortfall (biggest impact first)
      return b.shortfall - a.shortfall;
    });
  }, [activeItems]);

  // Get which SKUs are blocked by each component
  const componentBlocksMap = useMemo(() => {
    const map = new Map<string, string[]>();
    data.constraintAlerts.forEach((alert) => {
      const existing = map.get(alert.constrainingComponent) || [];
      existing.push(alert.displayName);
      map.set(alert.constrainingComponent, existing);
    });
    return map;
  }, [data.constraintAlerts]);

  const handleExportCSV = () => {
    const headers = ["Item", "Type", "On Hand", "Need", "Order Qty", "Lead Time", "Order By", "Blocks Production"];
    const rows = sortedItems.map((item) => [
      item.displayName,
      item.type,
      item.available,
      item.shortfall,
      item.orderQty,
      item.leadTimeDays || "",
      item.orderByDate || "",
      componentBlocksMap.get(item.sku)?.join("; ") || "",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `order-recommendations-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  const componentItems = sortedItems.filter((i) => i.type === "component");
  const accessoryItems = sortedItems.filter((i) => i.type === "accessory");

  return (
    <div className="p-4 space-y-6">
      {/* Header with Export */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#e6edf3]">Order Recommendations</h2>
          <p className="text-xs text-[#8b949e]">
            {sortedItems.length} items need ordering • Based on current production targets and inventory
          </p>
        </div>
        <button
          onClick={handleExportCSV}
          disabled={sortedItems.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[#238636] hover:bg-[#2ea043] text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {sortedItems.length === 0 ? (
        <div className="bg-[#161b22] border border-[#30363d] rounded p-8 text-center">
          <Check className="w-8 h-8 text-[#3fb950] mx-auto mb-2" />
          <div className="text-sm text-[#e6edf3]">No orders needed</div>
          <div className="text-xs text-[#8b949e]">Inventory is sufficient for current production targets</div>
        </div>
      ) : (
        <>
          {/* COMPONENTS - Production Blockers */}
          {componentItems.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#f85149] uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                Components Blocking Production ({componentItems.length})
              </h3>
              <div className="border border-[#30363d] rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#161b22] text-[10px] text-[#8b949e] uppercase tracking-wider">
                      <th className="text-left p-2 border-b border-[#30363d]">Component</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-20">On Hand</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-20">Need</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-20 font-bold text-[#58a6ff]">Order</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-20">Lead</th>
                      <th className="text-left p-2 border-b border-[#30363d]">Blocks</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {componentItems.map((item, idx) => {
                      const blockedSkus = componentBlocksMap.get(item.sku) || [];

                      return (
                        <tr
                          key={item.sku}
                          className={`border-b border-[#21262d] ${idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#161b22]"}`}
                        >
                          <td className="p-2">
                            <span className="text-[#e6edf3] font-medium">{item.displayName}</span>
                          </td>
                          <td className="p-2 text-right text-[#8b949e]">{formatNum(item.available)}</td>
                          <td className="p-2 text-right text-[#f85149]">{formatNum(item.shortfall)}</td>
                          <td className="p-2 text-right">
                            <span className="font-bold text-[#58a6ff] bg-[#1e3a5f] px-2 py-0.5 rounded">
                              {formatNum(item.orderQty)}
                            </span>
                          </td>
                          <td className="p-2 text-right text-[#8b949e]">
                            {item.leadTimeDays ? `${item.leadTimeDays}d` : "—"}
                          </td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-1">
                              {blockedSkus.map((sku) => (
                                <span key={sku} className="text-[10px] px-1.5 py-0.5 bg-[#f85149]/10 text-[#f85149] rounded">
                                  {sku}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ACCESSORIES - Reorder Recommendations */}
          {accessoryItems.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#d29922] uppercase tracking-wider flex items-center gap-2">
                <Package className="w-3.5 h-3.5" />
                Accessories Below Reorder Point ({accessoryItems.length})
              </h3>
              <div className="border border-[#30363d] rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#161b22] text-[10px] text-[#8b949e] uppercase tracking-wider">
                      <th className="text-left p-2 border-b border-[#30363d]">Accessory</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-20">On Hand</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-24">Reorder Pt</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-20 font-bold text-[#58a6ff]">Order</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-20">Lead</th>
                      <th className="text-right p-2 border-b border-[#30363d] w-24">Order By</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {accessoryItems.map((item, idx) => {
                      const isUrgent = item.orderByDate && new Date(item.orderByDate) < new Date();

                      return (
                        <tr
                          key={item.sku}
                          className={`border-b border-[#21262d] ${idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#161b22]"}`}
                        >
                          <td className="p-2">
                            <span className="text-[#e6edf3] font-medium">{item.displayName}</span>
                          </td>
                          <td className="p-2 text-right text-[#8b949e]">{formatNum(item.available)}</td>
                          <td className="p-2 text-right text-[#8b949e]">{formatNum(item.required)}</td>
                          <td className="p-2 text-right">
                            <span className="font-bold text-[#58a6ff] bg-[#1e3a5f] px-2 py-0.5 rounded">
                              {formatNum(item.orderQty)}
                            </span>
                          </td>
                          <td className="p-2 text-right text-[#8b949e]">
                            {item.leadTimeDays ? `${item.leadTimeDays}d` : "—"}
                          </td>
                          <td className={`p-2 text-right ${isUrgent ? "text-[#f85149] font-bold" : "text-[#8b949e]"}`}>
                            {item.orderByDate ? formatDate(item.orderByDate) : "—"}
                            {isUrgent && " ⚠️"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Components Tab - BOM View
// ============================================================================

interface ComponentsTabProps {
  data: ProductionPlanningResponse;
  initialExpandedSku?: string | null;
}

function ComponentsTab({ data, initialExpandedSku = null }: ComponentsTabProps) {
  const { skuData, accessories } = data;
  const [expandedSku, setExpandedSku] = useState<string | null>(initialExpandedSku);
  const [filter, setFilter] = useState<"all" | "constrained" | "healthy">("all");

  // Update expanded SKU when drilled down from another tab
  useEffect(() => {
    if (initialExpandedSku) {
      setExpandedSku(initialExpandedSku);
    }
  }, [initialExpandedSku]);

  // Get SKUs with BOM data
  const skusWithBom = useMemo(() => {
    return skuData
      .filter((s) => s.bomComponents && s.bomComponents.length > 0)
      .filter((s) => {
        if (filter === "all") return true;
        if (filter === "constrained") return s.hasConstraint;
        return !s.hasConstraint;
      })
      .sort((a, b) => {
        // Constrained first, then by can make (ascending)
        if (a.hasConstraint && !b.hasConstraint) return -1;
        if (!a.hasConstraint && b.hasConstraint) return 1;
        return (a.maxProducible < 0 ? Infinity : a.maxProducible) - (b.maxProducible < 0 ? Infinity : b.maxProducible);
      });
  }, [skuData, filter]);

  return (
    <div className="p-4 space-y-4">
      {/* Filter Buttons */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#8b949e]">Show:</span>
        {(["all", "constrained", "healthy"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              filter === f
                ? "bg-[#30363d] text-[#e6edf3]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            }`}
          >
            {f === "all" ? "All" : f === "constrained" ? "Constrained" : "Healthy"}
            {f === "constrained" && (
              <span className="ml-1 text-[#f85149]">({skuData.filter((s) => s.hasConstraint).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* SKU/BOM Accordion */}
      <div className="border border-[#30363d] rounded overflow-hidden divide-y divide-[#21262d]">
        {skusWithBom.map((sku, idx) => {
          const isExpanded = expandedSku === sku.sku;
          const bom = sku.bomComponents || [];

          return (
            <div key={sku.sku} className={idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#161b22]"}>
              {/* Parent Row */}
              <button
                onClick={() => setExpandedSku(isExpanded ? null : sku.sku)}
                className="w-full text-left p-3 hover:bg-[#1f2428] transition-colors flex items-center gap-3"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-[#8b949e]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[#8b949e]" />
                )}
                <span className="font-medium text-[#e6edf3] flex-1">{sku.displayName}</span>
                <span className="text-xs text-[#8b949e]">{bom.length} components</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  sku.hasConstraint
                    ? "bg-[#f85149]/20 text-[#f85149]"
                    : "bg-[#3fb950]/20 text-[#3fb950]"
                }`}>
                  {sku.hasConstraint ? "CONSTRAINED" : "OK"}
                </span>
                <span className="font-mono text-sm text-[#e6edf3] w-20 text-right">
                  {sku.maxProducible < 0 ? "∞" : formatCompact(sku.maxProducible)}
                </span>
                <span className="text-[10px] text-[#8b949e] w-16">can make</span>
              </button>

              {/* Expanded BOM Table */}
              {isExpanded && (
                <div className="bg-[#0d1117] border-t border-[#21262d]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] text-[#8b949e] uppercase tracking-wider">
                        <th className="text-left p-2 pl-10">Component</th>
                        <th className="text-right p-2 w-16">Qty/Unit</th>
                        <th className="text-right p-2 w-20">Available</th>
                        <th className="text-right p-2 w-20">Lead Time</th>
                        <th className="text-right p-2 w-20">Can Make</th>
                        <th className="text-center p-2 w-20">Status</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {bom.map((comp, compIdx) => {
                        const isLimiting = comp.isConstraining;
                        const isLow = comp.canMake >= 0 && comp.canMake < sku.monthlyTarget;

                        return (
                          <tr
                            key={comp.component}
                            className={`border-t border-[#21262d]/50 ${isLimiting ? "bg-[#f85149]/5" : ""}`}
                          >
                            <td className="p-2 pl-10">
                              <span className={isLimiting ? "text-[#f85149] font-medium" : "text-[#e6edf3]"}>
                                {isLimiting && <AlertTriangle className="w-3 h-3 inline mr-1.5" />}
                                {comp.component}
                              </span>
                            </td>
                            <td className="p-2 text-right text-[#8b949e]">{comp.qtyRequired}</td>
                            <td className="p-2 text-right text-[#e6edf3]">{formatCompact(comp.available)}</td>
                            <td className="p-2 text-right text-[#8b949e]">
                              {comp.leadTimeDays != null ? `${comp.leadTimeDays}d` : "—"}
                            </td>
                            <td className={`p-2 text-right font-medium ${
                              isLimiting ? "text-[#f85149]" : isLow ? "text-[#d29922]" : "text-[#e6edf3]"
                            }`}>
                              {comp.canMake < 0 ? "∞" : formatCompact(comp.canMake)}
                            </td>
                            <td className="p-2 text-center">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                isLimiting
                                  ? "bg-[#f85149]/20 text-[#f85149]"
                                  : isLow
                                    ? "bg-[#d29922]/20 text-[#d29922]"
                                    : "bg-[#3fb950]/20 text-[#3fb950]"
                              }`}>
                                {isLimiting ? "LIMITING" : isLow ? "LOW" : "OK"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {sku.hasConstraint && (
                    <div className="p-3 pl-10 border-t border-[#21262d] text-xs text-[#f85149]">
                      <AlertTriangle className="w-3 h-3 inline mr-1.5" />
                      <strong>{sku.constrainingComponent}</strong> limits production to {formatCompact(sku.maxProducible)} units.
                      Need {formatCompact(sku.shortfall)} more to hit target.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Accessories Section */}
      {accessories && accessories.length > 0 && (
        <div className="space-y-2 mt-6">
          <h3 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider flex items-center gap-2">
            <Package className="w-3.5 h-3.5" />
            Purchased Accessories (90-day lead time from China)
          </h3>

          <div className="border border-[#30363d] rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#161b22] text-[10px] text-[#8b949e] uppercase tracking-wider">
                  <th className="text-left p-2">Item</th>
                  <th className="text-right p-2 w-20">Available</th>
                  <th className="text-right p-2 w-20">On Order</th>
                  <th className="text-right p-2 w-20">Mo Demand</th>
                  <th className="text-right p-2 w-20">Runway</th>
                  <th className="text-right p-2 w-24">Reorder Pt</th>
                  <th className="text-center p-2 w-24">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {accessories.map((acc, idx) => (
                  <tr
                    key={acc.sku}
                    className={`border-t border-[#21262d] hover:bg-[#1f2428] ${idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#161b22]"}`}
                  >
                    <td className="p-2 text-[#e6edf3] font-medium">{acc.displayName}</td>
                    <td className="p-2 text-right text-[#e6edf3]">{formatCompact(acc.available)}</td>
                    <td className="p-2 text-right text-[#8b949e]">
                      {acc.onOrder > 0 ? formatCompact(acc.onOrder) : "—"}
                    </td>
                    <td className="p-2 text-right text-[#8b949e]">{formatCompact(acc.salesForecastThisMonth)}</td>
                    <td className={`p-2 text-right ${
                      acc.runwayDays != null && acc.runwayDays < 60 ? "text-[#d29922]" : "text-[#e6edf3]"
                    }`}>
                      {acc.runwayDays != null ? `${acc.runwayDays}d` : "—"}
                    </td>
                    <td className="p-2 text-right text-[#8b949e]">{formatCompact(acc.reorderPoint)}</td>
                    <td className="p-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        acc.belowReorderPoint
                          ? "bg-[#f85149]/20 text-[#f85149]"
                          : "bg-[#3fb950]/20 text-[#3fb950]"
                      }`}>
                        {acc.belowReorderPoint ? "REORDER" : "OK"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// History Tab
// ============================================================================

interface HistoryTabProps {
  data: ProductionPlanningResponse;
}

function HistoryTab({ data }: HistoryTabProps) {
  const { history, aggregateCurve, inventoryCurves, period } = data;

  return (
    <div className="p-4 space-y-6">
      {/* Inventory Build Analysis - Year-long view for planning */}
      {aggregateCurve && (
        <div className="space-y-4">
          <InventoryCurveChart
            curve={aggregateCurve}
            currentMonth={period.month}
            label="Year Inventory Build vs Budget"
          />

          {/* SKU Status Grid */}
          {inventoryCurves && inventoryCurves.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
                  SKU Inventory Position (Year-end Projection)
                </span>
                <span className="text-[10px] text-[#484f58]">
                  {inventoryCurves.filter(c => c.status === "critical" || c.status === "behind").length} need attention
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {inventoryCurves.slice(0, 18).map((curve) => (
                  <SKUInventoryCard key={curve.sku} curve={curve} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Historical Monthly Data */}
      {history && history.length > 0 ? (
        <div className="border border-[#30363d] rounded overflow-hidden">
          <div className="bg-[#161b22] px-4 py-2 border-b border-[#30363d]">
            <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Monthly History</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0d1117] text-[10px] text-[#8b949e] uppercase tracking-wider">
                <th className="text-left p-2 border-b border-[#30363d]">Month</th>
                <th className="text-right p-2 border-b border-[#30363d] w-24">Target</th>
                <th className="text-right p-2 border-b border-[#30363d] w-24">Produced</th>
                <th className="text-center p-2 border-b border-[#30363d] w-32">Achievement</th>
                <th className="text-right p-2 border-b border-[#30363d] w-24">Variance</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {history.map((month, idx) => {
                const variance = month.totalProduced - month.totalTarget;
                const status = getStatus(month.percentAchieved);

                return (
                  <tr
                    key={`${month.year}-${month.month}`}
                    className={`border-b border-[#21262d] hover:bg-[#1f2428] ${idx % 2 === 0 ? "bg-[#0d1117]" : "bg-[#161b22]"}`}
                  >
                    <td className="p-2 text-[#e6edf3] font-medium">{month.monthName} {month.year}</td>
                    <td className="p-2 text-right text-[#8b949e]">{formatNum(month.totalTarget)}</td>
                    <td className="p-2 text-right text-[#e6edf3]">{formatNum(month.totalProduced)}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <ProgressBar percent={month.percentAchieved} size="sm" />
                        <span className={`text-xs w-10 text-right ${STATUS[status]}`}>
                          {month.percentAchieved.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className={`p-2 text-right ${variance >= 0 ? "text-[#3fb950]" : "text-[#f85149]"}`}>
                      {variance >= 0 ? "+" : ""}{formatNum(variance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center border border-[#30363d] rounded-lg">
          <Clock className="w-8 h-8 text-[#8b949e] mx-auto mb-2" />
          <div className="text-sm text-[#e6edf3]">No historical data available</div>
          <div className="text-xs text-[#8b949e]">Production history will appear here</div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

export default function ProductionPlanningDashboard({ data, loading, onRefresh, onPeriodChange }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>("execute");
  const [orderBookItems, setOrderBookItems] = useState<OrderBookItem[]>([]);
  const [targetOverrides, setTargetOverrides] = useState<Record<string, number>>({});
  const [drillDownSku, setDrillDownSku] = useState<string | null>(null);
  const [selectedSkuForPanel, setSelectedSkuForPanel] = useState<string | null>(null);

  // Month selection for planning ahead (default to January 2026 for production planning)
  const [selectedMonth, setSelectedMonth] = useState<{ year: number; month: number }>(() => {
    // Default to January 2026 - the start of the new production year
    return { year: 2026, month: 1 };
  });

  // No auto-update needed - we want January 2026 as the default

  const handleMonthChange = useCallback((year: number, month: number) => {
    setSelectedMonth({ year, month });
    // Fetch data for the selected month
    if (onPeriodChange) {
      onPeriodChange(year, month);
    }
  }, [onPeriodChange]);

  // Handle drill-down from constraint alerts or anywhere else
  const handleSkuDrillDown = useCallback((sku: string) => {
    setSelectedSkuForPanel(sku);
  }, []);

  // Close the drill-down panel
  const handleCloseDrillDown = useCallback(() => {
    setSelectedSkuForPanel(null);
  }, []);

  // Build order book from data
  const orderBook = useMemo(() => {
    if (!data) return [];

    const items: OrderBookItem[] = [];

    // Add constrained components
    data.constraintAlerts.forEach((alert) => {
      const existingItem = orderBookItems.find((i) => i.sku === alert.constrainingComponent);
      items.push({
        sku: alert.constrainingComponent,
        displayName: alert.constrainingComponent,
        type: "component",
        available: alert.componentAvailable,
        required: alert.monthlyTarget,
        shortfall: alert.shortfall,
        leadTimeDays: null, // Would come from component_lead_times
        orderByDate: null,
        buffer: existingItem?.buffer ?? 10,
        orderQty: Math.ceil(alert.shortfall * (1 + (existingItem?.buffer ?? 10) / 100)),
        isOrdered: existingItem?.isOrdered ?? false,
      });
    });

    // Add accessories below reorder point
    data.accessories?.forEach((acc) => {
      if (acc.belowReorderPoint && acc.orderRecommendation) {
        const existingItem = orderBookItems.find((i) => i.sku === acc.sku);
        items.push({
          sku: acc.sku,
          displayName: acc.displayName,
          type: "accessory",
          available: acc.available,
          required: acc.reorderPoint,
          shortfall: acc.orderRecommendation.quantity,
          leadTimeDays: acc.leadTimeDays,
          orderByDate: acc.orderRecommendation.orderByDate,
          buffer: existingItem?.buffer ?? 10,
          orderQty: Math.ceil(acc.orderRecommendation.quantity * (1 + (existingItem?.buffer ?? 10) / 100)),
          isOrdered: existingItem?.isOrdered ?? false,
        });
      }
    });

    return items;
  }, [data, orderBookItems]);

  const handleBufferChange = useCallback((sku: string, buffer: number) => {
    setOrderBookItems((prev) => {
      const existing = prev.find((i) => i.sku === sku);
      if (existing) {
        return prev.map((i) =>
          i.sku === sku
            ? { ...i, buffer, orderQty: Math.ceil(i.shortfall * (1 + buffer / 100)) }
            : i
        );
      }
      // Create new entry with buffer
      const fromOrderBook = orderBook.find((i) => i.sku === sku);
      if (fromOrderBook) {
        return [...prev, { ...fromOrderBook, buffer, orderQty: Math.ceil(fromOrderBook.shortfall * (1 + buffer / 100)) }];
      }
      return prev;
    });
  }, [orderBook]);

  const handleMarkOrdered = useCallback((sku: string) => {
    setOrderBookItems((prev) => {
      const existing = prev.find((i) => i.sku === sku);
      if (existing) {
        return prev.map((i) => i.sku === sku ? { ...i, isOrdered: true } : i);
      }
      const fromOrderBook = orderBook.find((i) => i.sku === sku);
      if (fromOrderBook) {
        return [...prev, { ...fromOrderBook, isOrdered: true }];
      }
      return prev;
    });
  }, [orderBook]);

  const handleTargetChange = useCallback((sku: string, target: number) => {
    setTargetOverrides((prev) => ({ ...prev, [sku]: target }));
    // In a real app, this would persist to the database
    console.log(`Target changed: ${sku} -> ${target}`);
  }, []);

  // Apply target overrides to data
  const dataWithOverrides = useMemo(() => {
    if (!data) return null;
    return {
      ...data,
      skuData: data.skuData.map((s) => ({
        ...s,
        monthlyTarget: targetOverrides[s.sku] ?? s.monthlyTarget,
      })),
    };
  }, [data, targetOverrides]);

  const orderBookCount = orderBook.filter((i) => !i.isOrdered && i.shortfall > 0).length;

  if (loading) {
    return (
      <div className="bg-[#0d1117] min-h-screen p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[#161b22] rounded w-1/3" />
          <div className="h-64 bg-[#161b22] rounded" />
        </div>
      </div>
    );
  }

  if (!dataWithOverrides) {
    return (
      <div className="bg-[#0d1117] min-h-screen p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="text-[#8b949e]">No data available</div>
          <button onClick={onRefresh} className="mt-2 text-[#58a6ff] hover:underline text-sm">
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const mainDashboard = (
    <div className="bg-[#0d1117] min-h-screen">
      {/* Header */}
      <div className="border-b border-[#30363d] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[#e6edf3]">Production Planning</h1>
            <p className="text-xs text-[#8b949e]">
              {dataWithOverrides.period.monthName} {dataWithOverrides.period.year} · Day {dataWithOverrides.period.daysElapsedInMonth} of {dataWithOverrides.period.daysInMonth}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#8b949e] hover:text-[#e6edf3] border border-[#30363d] rounded hover:border-[#8b949e] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} orderBookCount={orderBookCount} />

      {/* Tab Content */}
      <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
        {activeTab === "execute" && (
          <ExecuteTab
            data={dataWithOverrides}
            onTargetChange={handleTargetChange}
            onSkuDrillDown={handleSkuDrillDown}
            selectedMonth={selectedMonth}
            onMonthChange={handleMonthChange}
          />
        )}
        {activeTab === "orderbook" && (
          <OrderBookTab
            data={dataWithOverrides}
            orderBook={orderBook}
            onBufferChange={handleBufferChange}
            onMarkOrdered={handleMarkOrdered}
          />
        )}
        {activeTab === "components" && <ComponentsTab data={dataWithOverrides} initialExpandedSku={drillDownSku} />}
        {activeTab === "history" && <HistoryTab data={dataWithOverrides} />}
      </div>

      {/* Footer */}
      <div className="border-t border-[#30363d] p-2 text-center">
        <span className="text-[10px] text-[#484f58]">
          Data as of {dataWithOverrides.asOfDate}
        </span>
      </div>

    </div>
  );

  // Full-page SKU detail view
  const skuDetailView = selectedSkuForPanel && (() => {
    const selectedSku = dataWithOverrides.skuData.find(s => s.sku === selectedSkuForPanel);
    if (!selectedSku) return null;
    return (
      <SKUDetailPage
        sku={selectedSku}
        period={dataWithOverrides.period}
        forecast={dataWithOverrides.forecast || []}
        components={dataWithOverrides.components || []}
        onBack={handleCloseDrillDown}
      />
    );
  })();

  // If SKU is selected, show full-page detail. Otherwise show main dashboard.
  return skuDetailView || mainDashboard;
}
