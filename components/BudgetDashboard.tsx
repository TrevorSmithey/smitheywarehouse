"use client";

import { Target, Download } from "lucide-react";
import { format } from "date-fns";
import { formatNumber } from "@/lib/dashboard-utils";
import type {
  BudgetResponse,
  BudgetDateRange,
  BudgetChannel,
} from "@/lib/types";

interface BudgetDashboardProps {
  data: BudgetResponse | null;
  loading: boolean;
  dateRange: BudgetDateRange;
  onDateRangeChange: (range: BudgetDateRange) => void;
  channel: BudgetChannel;
  onChannelChange: (channel: BudgetChannel) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
  onRefresh: () => void;
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
}

export function BudgetDashboard({
  data,
  loading,
  dateRange,
  onDateRangeChange,
  channel,
  onChannelChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  onRefresh,
  expandedCategories,
  onToggleCategory,
}: BudgetDashboardProps) {
  // Design system colors (matches globals.css)
  const colors = {
    emerald: "#10B981",      // status-good
    emeraldDark: "#059669",  // status-good-dim
    amber: "#F59E0B",        // status-warning
    amberDark: "#D97706",    // status-warning-dim
    rose: "#DC2626",         // status-bad (was rose, now consistent)
    roseDark: "#B91C1C",     // status-bad-dim
    slate: "#64748B",        // text-tertiary
    accent: "#0EA5E9",       // accent-blue
  };

  // Date range options
  const dateRangeOptions: { value: BudgetDateRange; label: string; short: string }[] = [
    { value: "mtd", label: "Month to Date", short: "MTD" },
    { value: "last_month", label: "Last Month", short: "LM" },
    { value: "qtd", label: "Quarter to Date", short: "QTD" },
    { value: "ytd", label: "Year to Date", short: "YTD" },
    { value: "6months", label: "6 Months", short: "6Mo" },
    { value: "custom", label: "Custom", short: "Custom" },
  ];

  // Channel options
  const channelOptions: { value: BudgetChannel; label: string }[] = [
    { value: "combined", label: "Total" },
    { value: "retail", label: "Retail" },
    { value: "wholesale", label: "Wholesale" },
  ];


  // Get delta color (green for positive, red for negative)
  const getDeltaColor = (delta: number) => {
    if (delta > 0) return colors.emerald;
    if (delta < 0) return colors.rose;
    return colors.slate;
  };

  // Format delta as string with +/- sign
  const formatDelta = (delta: number, isPct: boolean = false) => {
    const sign = delta > 0 ? "+" : "";
    if (isPct) {
      return `${sign}${delta.toFixed(1)}%`;
    }
    return `${sign}${formatNumber(delta)}`;
  };

  // Get color based on PACE and BUDGET ACHIEVEMENT
  // Coloring logic:
  // - Bright green (#22C55E): 90%+ of budget achieved (goal nearly hit)
  // - Emerald: 90%+ pace (on track or ahead)
  // - Amber: 80-89% pace (slightly behind)
  // - Rose: <80% pace (needs attention)
  // - Slate: No budget set (N/A - not a failure)
  const getPaceColor = (pace: number, pctOfBudget?: number, budget?: number) => {
    // No budget = not applicable (gray, not red)
    if (budget !== undefined && budget === 0) return colors.slate;
    // Hit 90%+ of budget = bright green (celebrate!)
    if (pctOfBudget !== undefined && pctOfBudget >= 90) return "#22C55E";
    // On pace (90%+) = emerald
    if (pace >= 90) return colors.emerald;
    // Slightly behind (80-89%) = amber
    if (pace >= 80) return colors.amber;
    // Significantly behind (<80%) = rose
    return colors.rose;
  };

  const getPaceColorDark = (pace: number, pctOfBudget?: number, budget?: number) => {
    if (budget !== undefined && budget === 0) return colors.slate;
    if (pctOfBudget !== undefined && pctOfBudget >= 90) return "#16A34A";
    if (pace >= 90) return colors.emeraldDark;
    if (pace >= 80) return colors.amberDark;
    return colors.roseDark;
  };

  // Export to CSV function - respects current channel selection
  const exportToCSV = () => {
    if (!data) return;

    // Helper to get channel-specific values
    const getSkuBudget = (sku: typeof data.categories[0]["skus"][0]) =>
      channel === "combined" ? sku.budget
        : channel === "retail" ? sku.channelBudgets?.retail || 0
        : sku.channelBudgets?.wholesale || 0;
    const getSkuActual = (sku: typeof data.categories[0]["skus"][0]) =>
      channel === "combined" ? sku.actual
        : channel === "retail" ? sku.channelActuals?.retail || 0
        : sku.channelActuals?.wholesale || 0;
    const getCatBudget = (cat: typeof data.categories[0]) =>
      channel === "combined" ? cat.totals.budget
        : channel === "retail" ? cat.channelBudgets?.retail || 0
        : cat.channelBudgets?.wholesale || 0;
    const getCatActual = (cat: typeof data.categories[0]) =>
      channel === "combined" ? cat.totals.actual
        : channel === "retail" ? cat.channelActuals?.retail || 0
        : cat.channelActuals?.wholesale || 0;

    const channelLabel = channel === "combined" ? "Total" : channel === "retail" ? "Retail" : "Wholesale";
    const rows: string[] = [];
    rows.push("Category,Product,SKU,Budget,Actual,Variance,Variance %");

    for (const cat of data.categories) {
      for (const sku of cat.skus) {
        const budget = getSkuBudget(sku);
        const actual = getSkuActual(sku);
        const variance = actual - budget;
        const variancePct = budget > 0 ? (variance / budget) * 100 : 0;
        rows.push(
          `"${cat.displayName}","${sku.displayName}","${sku.sku}",${budget},${actual},${variance},${variancePct.toFixed(1)}%`
        );
      }
      const catBudget = getCatBudget(cat);
      const catActual = getCatActual(cat);
      const catVariance = catActual - catBudget;
      const catVariancePct = catBudget > 0 ? (catVariance / catBudget) * 100 : 0;
      rows.push(
        `"${cat.displayName} Total","","",${catBudget},${catActual},${catVariance},${catVariancePct.toFixed(1)}%`
      );
    }

    // Cookware total (channel-specific)
    const cwBudget = channel === "combined" ? data.cookwareTotal.budget
      : channel === "retail" ? data.cookwareTotal.channelBudgets?.retail || 0
      : data.cookwareTotal.channelBudgets?.wholesale || 0;
    const cwActual = channel === "combined" ? data.cookwareTotal.actual
      : channel === "retail" ? data.cookwareTotal.channelActuals?.retail || 0
      : data.cookwareTotal.channelActuals?.wholesale || 0;
    const cwVariance = cwActual - cwBudget;
    const cwVariancePct = cwBudget > 0 ? (cwVariance / cwBudget) * 100 : 0;
    rows.push(`"Cookware Total","","",${cwBudget},${cwActual},${cwVariance},${cwVariancePct.toFixed(1)}%`);

    // Grand total (channel-specific)
    const gtBudget = channel === "combined" ? data.grandTotal.budget
      : channel === "retail" ? data.grandTotal.channelBudgets?.retail || 0
      : data.grandTotal.channelBudgets?.wholesale || 0;
    const gtActual = channel === "combined" ? data.grandTotal.actual
      : channel === "retail" ? data.grandTotal.channelActuals?.retail || 0
      : data.grandTotal.channelActuals?.wholesale || 0;
    const gtVariance = gtActual - gtBudget;
    const gtVariancePct = gtBudget > 0 ? (gtVariance / gtBudget) * 100 : 0;
    rows.push(`"Grand Total","","",${gtBudget},${gtActual},${gtVariance},${gtVariancePct.toFixed(1)}%`);

    const csvContent = rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Include channel in filename for clarity
    a.download = `budget-vs-actual-${channelLabel.toLowerCase()}-${dateRange}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-bg-tertiary" />
            <div
              className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent animate-spin"
              style={{ borderTopColor: colors.accent, borderRightColor: colors.emerald }}
            />
          </div>
          <span className="text-sm text-text-tertiary tracking-widest uppercase">Analyzing sales...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Target className="w-16 h-16 text-text-muted" />
        <span className="text-text-tertiary tracking-wide">No budget data available</span>
        <button
          onClick={onRefresh}
          className="px-6 py-2.5 text-sm font-medium tracking-wider uppercase transition-all border-2 rounded hover:bg-accent-blue/10"
          style={{ borderColor: colors.accent, color: colors.accent }}
        >
          Refresh
        </button>
      </div>
    );
  }

  const pctThroughPeriod = Math.round((data.daysElapsed / data.daysInPeriod) * 100);

  return (
    <div className="space-y-6">
      {/* Header Row with Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left side: Channel Toggle + Period Label */}
        <div className="flex items-center gap-6">
          {/* Channel Toggle - Refined pill design */}
          <div className="flex items-center gap-1 bg-bg-tertiary/50 rounded-full p-0.5 border border-border/40">
            {channelOptions.map((opt) => {
              const isActive = channel === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => onChannelChange(opt.value)}
                  className={`relative px-4 py-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase rounded-full transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                    isActive
                      ? "bg-gradient-to-b from-forge-copper/90 to-forge-ember/80 text-white shadow-[0_2px_8px_-2px] shadow-forge-copper/60"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  <span className={`relative z-10 transition-transform duration-300 ${isActive ? "scale-[1.02]" : "scale-100"}`}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Period Label - Understated */}
          <div className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-forge-copper/60" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-text-muted font-medium">
              {data.periodLabel}
            </span>
          </div>
        </div>
        {/* Right side: Date Range + Export */}
        <div className="flex items-center gap-2">
          {/* Date Range Buttons */}
          <div className="flex bg-bg-tertiary rounded-lg p-1">
            {dateRangeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onDateRangeChange(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                  dateRange === opt.value
                    ? "bg-accent-blue text-white"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {opt.short}
              </button>
            ))}
          </div>
          {/* Custom Date Inputs */}
          {dateRange === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => onCustomStartChange(e.target.value)}
                className="px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:border-accent-blue focus:outline-none"
              />
              <span className="text-text-muted text-xs">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => onCustomEndChange(e.target.value)}
                className="px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:border-accent-blue focus:outline-none"
              />
            </div>
          )}
          {/* Export Button */}
          <button
            onClick={exportToCSV}
            className="p-2 text-text-tertiary hover:text-text-secondary transition-colors"
            title="Export to CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary Cards - Cookware Total and Grand Total */}
      {(() => {
        // Get channel-specific actuals
        const cookwareActual = channel === "combined"
          ? data.cookwareTotal.actual
          : channel === "retail"
            ? data.cookwareTotal.channelActuals?.retail || 0
            : data.cookwareTotal.channelActuals?.wholesale || 0;
        const grandActual = channel === "combined"
          ? data.grandTotal.actual
          : channel === "retail"
            ? data.grandTotal.channelActuals?.retail || 0
            : data.grandTotal.channelActuals?.wholesale || 0;

        // Get channel-specific budgets
        const cookwareBudget = channel === "combined"
          ? data.cookwareTotal.budget
          : channel === "retail"
            ? data.cookwareTotal.channelBudgets?.retail || 0
            : data.cookwareTotal.channelBudgets?.wholesale || 0;
        const grandBudget = channel === "combined"
          ? data.grandTotal.budget
          : channel === "retail"
            ? data.grandTotal.channelBudgets?.retail || 0
            : data.grandTotal.channelBudgets?.wholesale || 0;

        // Calculate % using channel-specific budget for channel views
        const cookwarePct = cookwareBudget > 0
          ? Math.round((cookwareActual / cookwareBudget) * 100)
          : 0;
        const grandPct = grandBudget > 0
          ? Math.round((grandActual / grandBudget) * 100)
          : 0;

        // Get channel-specific pace values (now available for all channels)
        const cookwarePace = channel === "combined"
          ? data.cookwareTotal.pace
          : channel === "retail"
            ? data.cookwareTotal.channelPace?.retail || 0
            : data.cookwareTotal.channelPace?.wholesale || 0;
        const grandPace = channel === "combined"
          ? data.grandTotal.pace
          : channel === "retail"
            ? data.grandTotal.channelPace?.retail || 0
            : data.grandTotal.channelPace?.wholesale || 0;
        const channelLabel = channel === "retail" ? "Retail" : channel === "wholesale" ? "Wholesale" : "";

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cookware Total */}
            <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">
                  COOKWARE{channelLabel ? ` · ${channelLabel}` : ""}
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-1">
                <span
                  className="text-3xl sm:text-4xl font-bold tabular-nums transition-colors duration-500"
                  style={{ color: getPaceColor(cookwarePace, cookwarePct, cookwareBudget) }}
                >
                  {cookwarePct}%
                </span>
                <span className="text-xs text-text-muted">of budget</span>
              </div>
              <div className="text-sm text-text-muted mb-2 tabular-nums">
                {formatNumber(cookwareActual)}
                <span className="text-text-tertiary"> / {formatNumber(cookwareBudget)}</span>
              </div>
              {/* Channel breakdown when viewing Total */}
              {channel === "combined" && data.cookwareTotal.channelActuals && (
                <div className="text-xs text-text-tertiary mb-2">
                  <span className="text-text-muted">Retail:</span> {formatNumber(data.cookwareTotal.channelActuals.retail)}
                  <span className="mx-2">·</span>
                  <span className="text-text-muted">Wholesale:</span> {formatNumber(data.cookwareTotal.channelActuals.wholesale)}
                </div>
              )}
              {/* Delta indicator when comparison is active */}
              {data.comparison && channel === "combined" && (
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="text-sm font-medium tabular-nums"
                    style={{ color: getDeltaColor(data.comparison.cookwareTotal.delta) }}
                  >
                    {formatDelta(data.comparison.cookwareTotal.deltaPct, true)}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    vs {data.comparison.periodLabel.split("(")[0].trim()}
                  </span>
                </div>
              )}
              {/* Progress Bar */}
              <div className="relative h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, cookwarePct)}%`,
                    background: `linear-gradient(90deg, ${getPaceColor(cookwarePace, cookwarePct, cookwareBudget)}, ${getPaceColorDark(cookwarePace, cookwarePct, cookwareBudget)})`,
                  }}
                />
                {data.daysElapsed < data.daysInPeriod && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/50"
                    style={{ left: `${pctThroughPeriod}%` }}
                    title={`${pctThroughPeriod}% through period`}
                  />
                )}
              </div>
              <div className="text-xs text-text-tertiary mt-2">
                Cast Iron + Carbon Steel
                {data.daysElapsed < data.daysInPeriod && cookwarePace < 100 && (
                  <> • Pace: <span className="tabular-nums" style={{ color: getPaceColor(cookwarePace, cookwarePct, cookwareBudget) }}>{cookwarePace}%</span></>
                )}
              </div>
            </div>

            {/* Grand Total */}
            <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">
                  GRAND TOTAL{channelLabel ? ` · ${channelLabel}` : ""}
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-1">
                <span
                  className="text-3xl sm:text-4xl font-bold tabular-nums transition-colors duration-500"
                  style={{ color: getPaceColor(grandPace, grandPct, grandBudget) }}
                >
                  {grandPct}%
                </span>
                <span className="text-xs text-text-muted">of budget</span>
              </div>
              <div className="text-sm text-text-muted mb-2 tabular-nums">
                {formatNumber(grandActual)}
                <span className="text-text-tertiary"> / {formatNumber(grandBudget)}</span>
              </div>
              {/* Channel breakdown when viewing Total */}
              {channel === "combined" && data.grandTotal.channelActuals && (
                <div className="text-xs text-text-tertiary mb-2">
                  <span className="text-text-muted">Retail:</span> {formatNumber(data.grandTotal.channelActuals.retail)}
                  <span className="mx-2">·</span>
                  <span className="text-text-muted">Wholesale:</span> {formatNumber(data.grandTotal.channelActuals.wholesale)}
                </div>
              )}
              {/* Delta indicator when comparison is active */}
              {data.comparison && channel === "combined" && (
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="text-sm font-medium tabular-nums"
                    style={{ color: getDeltaColor(data.comparison.grandTotal.delta) }}
                  >
                    {formatDelta(data.comparison.grandTotal.deltaPct, true)}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    vs {data.comparison.periodLabel.split("(")[0].trim()}
                  </span>
                </div>
              )}
              {/* Progress Bar */}
              <div className="relative h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, grandPct)}%`,
                    background: `linear-gradient(90deg, ${getPaceColor(grandPace, grandPct, grandBudget)}, ${getPaceColorDark(grandPace, grandPct, grandBudget)})`,
                  }}
                />
                {data.daysElapsed < data.daysInPeriod && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/50"
                    style={{ left: `${pctThroughPeriod}%` }}
                    title={`${pctThroughPeriod}% through period`}
                  />
                )}
              </div>
              <div className="text-xs text-text-tertiary mt-2">
                All Categories
                {data.daysElapsed < data.daysInPeriod && grandPace < 100 && (
                  <> • Pace: <span className="tabular-nums" style={{ color: getPaceColor(grandPace, grandPct, grandBudget) }}>{grandPace}%</span></>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Category Details - Unified Cards with Progress + Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.categories.map((cat) => {
          // Get channel-specific actual for category
          const catActual = channel === "combined"
            ? cat.totals.actual
            : channel === "retail"
              ? cat.channelActuals?.retail || 0
              : cat.channelActuals?.wholesale || 0;

          // Get channel-specific budget for category
          const catBudget = channel === "combined"
            ? cat.totals.budget
            : channel === "retail"
              ? cat.channelBudgets?.retail || 0
              : cat.channelBudgets?.wholesale || 0;

          const pctOfBudget = catBudget > 0
            ? Math.round((catActual / catBudget) * 100)
            : 0;
          const periodPct = Math.round((data.daysElapsed / data.daysInPeriod) * 100);
          const isExpanded = expandedCategories.has(cat.category);
          // Get channel-specific pace
          const catPace = channel === "combined"
            ? cat.totals.pace
            : channel === "retail"
              ? cat.channelPace?.retail || 0
              : cat.channelPace?.wholesale || 0;
          const statusColor = getPaceColor(catPace, pctOfBudget, catBudget);
          const statusColorDark = getPaceColorDark(catPace, pctOfBudget, catBudget);

          return (
            <div key={cat.category} className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden transition-all duration-300">
              {/* Rich Header with Progress */}
              <button
                onClick={() => onToggleCategory(cat.category)}
                className="w-full text-left hover:bg-bg-tertiary/30 transition-colors"
              >
                <div className="p-4 pb-3">
                  {/* Top row: Category name + pace badge */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        style={{ color: statusColor }}
                      >
                        ▶
                      </span>
                      <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                        {cat.displayName}
                      </span>
                      <span className="text-[10px] text-text-tertiary">({cat.skus.length})</span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-2xl font-bold tabular-nums transition-colors duration-300"
                        style={{ color: statusColor }}
                      >
                        {pctOfBudget}%
                      </span>
                      <span className="text-xs text-text-muted">of budget</span>
                    </div>
                    <div className="text-right tabular-nums">
                      <span className="text-sm text-text-primary font-medium transition-all duration-300">
                        {formatNumber(catActual)}
                      </span>
                      <span className="text-sm text-text-muted transition-all duration-300"> / </span>
                      <span className="text-sm text-text-tertiary transition-all duration-300">
                        {formatNumber(catBudget)}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="relative h-1.5 bg-bg-tertiary rounded-full overflow-hidden mt-3">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, pctOfBudget)}%`,
                        background: `linear-gradient(90deg, ${statusColor}, ${statusColorDark})`,
                      }}
                    />
                    {data.daysElapsed < data.daysInPeriod && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-white/60"
                        style={{ left: `${periodPct}%` }}
                        title={`${periodPct}% through period`}
                      />
                    )}
                  </div>
                </div>
              </button>

              {/* SKU Table - Expanded by default, no scroll */}
              {isExpanded && (
                <div className="border-t border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 text-text-muted text-xs uppercase tracking-wider bg-bg-tertiary/30">
                        <th className="text-left py-2 px-3 font-medium">Product</th>
                        <th className="text-right py-2 px-2 font-medium">Budget</th>
                        <th className="text-right py-2 px-2 font-medium">Actual</th>
                        <th className="text-right py-2 px-3 font-medium">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.skus.map((sku, idx) => {
                        // Get channel-specific actual for this SKU
                        const skuActual = channel === "combined"
                          ? sku.actual
                          : channel === "retail"
                            ? sku.channelActuals?.retail || 0
                            : sku.channelActuals?.wholesale || 0;

                        // Get channel-specific budget for this SKU
                        const skuBudget = channel === "combined"
                          ? sku.budget
                          : channel === "retail"
                            ? sku.channelBudgets?.retail || 0
                            : sku.channelBudgets?.wholesale || 0;

                        // Display: raw % to channel budget
                        // Color: based on pace for all channel views
                        const skuPctOfBudget = skuBudget > 0
                          ? Math.round((skuActual / skuBudget) * 100)
                          : 0;
                        // Get channel-specific pace for this SKU
                        const skuPace = channel === "combined"
                          ? sku.pace
                          : channel === "retail"
                            ? sku.channelPace?.retail || 0
                            : sku.channelPace?.wholesale || 0;
                        const skuColor = getPaceColor(skuPace, skuPctOfBudget, skuBudget);
                        // Pulse green only when actual exceeds budget (hit the goal early)
                        const shouldPulse = skuActual > skuBudget;

                        return (
                          <tr
                            key={sku.sku}
                            className={`border-b border-border/20 hover:bg-bg-tertiary/40 transition-colors ${
                              idx % 2 === 1 ? "bg-bg-tertiary/10" : ""
                            }`}
                          >
                            <td className="py-1.5 px-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-300 ${shouldPulse ? "animate-soft-pulse" : ""}`}
                                  style={{ backgroundColor: skuColor }}
                                />
                                <div>
                                  <div className="text-text-primary text-xs font-medium">{sku.displayName}</div>
                                  <div className="text-text-muted text-[10px]">{sku.sku}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-1.5 px-2 text-right text-text-muted tabular-nums text-xs transition-opacity duration-300">
                              {formatNumber(skuBudget)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-text-primary tabular-nums text-xs font-medium transition-all duration-300">
                              {formatNumber(skuActual)}
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              <span
                                className="inline-block text-xs font-semibold tabular-nums px-2 py-0.5 rounded transition-all duration-300"
                                style={{
                                  backgroundColor: `${skuColor}20`,
                                  color: skuColor
                                }}
                              >
                                {skuPctOfBudget}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
