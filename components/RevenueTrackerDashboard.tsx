"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import {
  RefreshCw,
  Calendar,
  TrendingUp,
  Package,
  ChevronDown,
  ChevronLeft,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { StaleTimestamp } from "@/components/StaleTimestamp";
import type { RevenueTrackerResponse, QuarterSummary, DaySalesData, RevenueTrackerChannel } from "@/lib/types";

// ============================================================================
// TYPES
// ============================================================================

type PeriodMode = "calendar" | "trailing";
type TrailingPeriod = 7 | 30 | 90 | 365;

interface RevenueTrackerDashboardProps {
  data: RevenueTrackerResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onYearChange: (year: number) => void;
  onPeriodChange?: (mode: PeriodMode, trailingDays?: TrailingPeriod) => void;
  availableYears: number[];
  channel?: RevenueTrackerChannel;
  onChannelChange?: (channel: RevenueTrackerChannel) => void;
}

const channelOptions: { value: RevenueTrackerChannel; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "retail", label: "Web" },
  { value: "b2b", label: "Wholesale" },
];

// ============================================================================
// DESIGN TOKENS
// ============================================================================

const colors = {
  current: "#10B981", // Emerald - current period
  comparison: "#F59E0B", // Amber - comparison period
  accent: "#0EA5E9", // Blue - active states
  q1: "#3B82F6",
  q2: "#8B5CF6",
  q3: "#F97316",
  q4: "#EF4444",
};

const trailingOptions: { days: TrailingPeriod; label: string }[] = [
  { days: 7, label: "T7" },
  { days: 30, label: "T30" },
  { days: 90, label: "T90" },
  { days: 365, label: "T365" },
];

// Quarter boundaries (approximate day of year)
const quarterBoundaries = [
  { q: 1, start: 1, end: 90, label: "Q1", months: "Jan–Mar" },
  { q: 2, start: 91, end: 181, label: "Q2", months: "Apr–Jun" },
  { q: 3, start: 182, end: 273, label: "Q3", months: "Jul–Sep" },
  { q: 4, start: 274, end: 366, label: "Q4", months: "Oct–Dec" },
];

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

const fmt = {
  currency: (n: number | null) => {
    if (n === null) return "—";
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  },
  currencyFull: (n: number | null) => (n === null ? "—" : `$${n.toLocaleString()}`),
  number: (n: number | null) => (n === null ? "—" : n.toLocaleString()),
  delta: (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`),
  dayToMonth: (day: number): string => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // Approximate month from day of year
    const monthIndex = Math.min(11, Math.floor((day - 1) / 30.44));
    return months[monthIndex];
  },
};

// ============================================================================
// CHART DATA TYPE
// ============================================================================

interface ChartDataPoint {
  day: number;
  ordersCurrent: number;
  ordersComparison: number;
  revenueCurrent: number;
  revenueComparison: number;
  cumOrdersCurrent: number | null;
  cumOrdersComparison: number;
  cumRevenueCurrent: number | null;
  cumRevenueComparison: number;
}

// ============================================================================
// CHART TOOLTIP
// ============================================================================

function ChartTooltip({
  active,
  payload,
  label,
  prefix = "",
  currentLabel,
  comparisonLabel,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: number;
  prefix?: string;
  currentLabel: string;
  comparisonLabel: string;
}) {
  if (!active || !payload?.length) return null;

  const valCurrent = payload.find((p) => p.dataKey.includes("Current"))?.value || 0;
  const valComparison = payload.find((p) => p.dataKey.includes("Comparison"))?.value || 0;
  const delta = valComparison > 0 ? ((valCurrent - valComparison) / valComparison) * 100 : null;

  return (
    <div className="bg-bg-primary/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl p-4 min-w-[200px]">
      <div className="text-xs text-text-tertiary uppercase tracking-wider mb-3 font-medium">
        Day {label} · {fmt.dayToMonth(label || 1)}
      </div>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.current }} />
            <span className="text-text-secondary text-sm">{currentLabel}</span>
          </div>
          <span className="font-semibold text-text-primary tabular-nums">
            {prefix}{fmt.number(Math.round(valCurrent))}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.comparison }} />
            <span className="text-text-secondary text-sm">{comparisonLabel}</span>
          </div>
          <span className="font-medium text-text-tertiary tabular-nums">
            {prefix}{fmt.number(Math.round(valComparison))}
          </span>
        </div>
        {delta !== null && valCurrent > 0 && (
          <div className="pt-2.5 mt-2.5 border-t border-border/50 flex items-center justify-end gap-1.5">
            {delta >= 0 ? (
              <ArrowUpRight className="w-4 h-4 text-status-good" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-status-bad" />
            )}
            <span className={`text-sm font-bold ${delta >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(delta)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// QUARTER CARD (Interactive)
// ============================================================================

function QuarterCard({
  quarter,
  currentYear,
  isSelected,
  onClick,
}: {
  quarter: QuarterSummary;
  currentYear: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isActive = quarter.isCurrent || quarter.isComplete;
  const quarterColor = colors[`q${quarter.quarter}` as keyof typeof colors] || colors.accent;

  return (
    <button
      onClick={onClick}
      disabled={!isActive}
      className={`
        relative text-left w-full bg-bg-secondary rounded-xl p-5 border transition-all duration-200
        ${isSelected
          ? "border-accent-blue ring-1 ring-accent-blue/30 scale-[1.02]"
          : isActive
            ? "border-border hover:border-border-hover hover:bg-bg-tertiary cursor-pointer"
            : "border-border/50 opacity-40 cursor-not-allowed"
        }
      `}
    >
      {/* Quarter indicator bar */}
      <div
        className="absolute top-0 left-4 right-4 h-0.5 rounded-full"
        style={{ backgroundColor: isActive ? quarterColor : "var(--color-border)" }}
      />

      <div className="flex items-center justify-between mb-4 mt-1">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-text-primary">{quarter.label}</span>
          {quarter.isCurrent && (
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-accent-blue/15 text-accent-blue rounded">
              Now
            </span>
          )}
        </div>
        <span className="text-xs text-text-muted font-medium">{quarter.months}</span>
      </div>

      {isActive ? (
        <div className="space-y-4">
          {/* Revenue */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-muted uppercase tracking-wider">Revenue</span>
              {quarter.revenueGrowth !== null && (
                <span className={`text-xs font-bold ${quarter.revenueGrowth >= 0 ? "text-status-good" : "text-status-bad"}`}>
                  {fmt.delta(quarter.revenueGrowth)}
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-text-primary tabular-nums tracking-tight">
              {fmt.currency(quarter.revenueCurrent)}
            </div>
          </div>

          {/* Orders */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-muted uppercase tracking-wider">Orders</span>
              {quarter.ordersGrowth !== null && (
                <span className={`text-xs font-bold ${quarter.ordersGrowth >= 0 ? "text-status-good" : "text-status-bad"}`}>
                  {fmt.delta(quarter.ordersGrowth)}
                </span>
              )}
            </div>
            <div className="text-lg font-semibold text-text-secondary tabular-nums">
              {fmt.number(quarter.ordersCurrent)}
            </div>
          </div>

          {/* Progress bar */}
          <div className="pt-2">
            <div className="flex items-center justify-between text-xs text-text-muted mb-1.5">
              <span>{quarter.daysComplete} of {quarter.daysTotal} days</span>
              <span>vs {currentYear - 1}</span>
            </div>
            <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(quarter.daysComplete / quarter.daysTotal) * 100}%`,
                  backgroundColor: quarterColor,
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="py-6 text-center">
          <span className="text-text-muted text-sm font-medium">Upcoming</span>
        </div>
      )}

      {/* Hover hint for active cards */}
      {isActive && !isSelected && (
        <div className="absolute inset-x-0 bottom-2 text-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] text-text-muted uppercase tracking-wider">Click to drill down</span>
        </div>
      )}
    </button>
  );
}

// ============================================================================
// PERIOD SELECTOR
// ============================================================================

function PeriodSelector({
  mode,
  onModeChange,
  selectedYear,
  onYearChange,
  availableYears,
  trailingDays,
  onTrailingChange,
}: {
  mode: PeriodMode;
  onModeChange: (mode: PeriodMode) => void;
  selectedYear: number;
  onYearChange: (year: number) => void;
  availableYears: number[];
  trailingDays: TrailingPeriod;
  onTrailingChange: (days: TrailingPeriod) => void;
}) {
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!yearDropdownOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setYearDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [yearDropdownOpen]);

  return (
    <div className="flex items-center gap-3">
      {/* Mode Toggle */}
      <div className="flex items-center bg-bg-tertiary rounded-lg p-0.5">
        <button
          onClick={() => onModeChange("calendar")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            mode === "calendar"
              ? "bg-bg-secondary text-text-primary shadow-sm"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Year</span>
        </button>
        <button
          onClick={() => onModeChange("trailing")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            mode === "trailing"
              ? "bg-bg-secondary text-text-primary shadow-sm"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Trailing</span>
        </button>
      </div>

      {/* Conditional: Year Dropdown or Trailing Buttons */}
      {mode === "calendar" ? (
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setYearDropdownOpen(!yearDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg transition-colors"
          >
            <span className="text-sm font-semibold text-text-primary tabular-nums">{selectedYear}</span>
            <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${yearDropdownOpen ? "rotate-180" : ""}`} />
          </button>
          {yearDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-xl z-20 min-w-[100px] overflow-hidden">
              {availableYears.map((year) => (
                <button
                  key={year}
                  onClick={() => {
                    onYearChange(year);
                    setYearDropdownOpen(false);
                  }}
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-bg-secondary transition-colors ${
                    year === selectedYear ? "text-accent-blue font-semibold bg-bg-secondary" : "text-text-primary"
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {trailingOptions.map(({ days, label }) => (
            <button
              key={days}
              onClick={() => onTrailingChange(days)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold tabular-nums transition-all ${
                trailingDays === days
                  ? "bg-accent-blue text-white"
                  : "bg-bg-secondary text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CHANNEL SELECTOR
// ============================================================================

function ChannelSelector({
  channel,
  onChannelChange,
}: {
  channel: RevenueTrackerChannel;
  onChannelChange: (channel: RevenueTrackerChannel) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-0.5">
      {channelOptions.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChannelChange(value)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            channel === value
              ? "bg-bg-secondary text-text-primary shadow-sm"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// FULL-WIDTH CHART COMPONENT
// ============================================================================

function FullWidthChart({
  data,
  dataKeyPrefix,
  title,
  subtitle,
  currentLabel,
  comparisonLabel,
  valueFormatter,
  yAxisFormatter,
  gradientId,
  currentDayOfYear,
  selectedQuarter,
}: {
  data: ChartDataPoint[];
  dataKeyPrefix: "orders" | "revenue" | "cumOrders" | "cumRevenue";
  title: string;
  subtitle: string;
  currentLabel: string;
  comparisonLabel: string;
  valueFormatter: (n: number | null) => string;
  yAxisFormatter: (n: number) => string;
  gradientId: string;
  currentDayOfYear: number;
  selectedQuarter: number | null;
}) {
  const currentKey = dataKeyPrefix === "orders" ? "ordersCurrent" :
                     dataKeyPrefix === "revenue" ? "revenueCurrent" :
                     dataKeyPrefix === "cumOrders" ? "cumOrdersCurrent" : "cumRevenueCurrent";
  const comparisonKey = dataKeyPrefix === "orders" ? "ordersComparison" :
                        dataKeyPrefix === "revenue" ? "revenueComparison" :
                        dataKeyPrefix === "cumOrders" ? "cumOrdersComparison" : "cumRevenueComparison";
  const isCumulative = dataKeyPrefix.startsWith("cum");

  // Filter data if quarter is selected
  const chartData = useMemo(() => {
    if (!selectedQuarter) return data;
    const qBounds = quarterBoundaries.find((q) => q.q === selectedQuarter);
    if (!qBounds) return data;
    return data.filter((d) => d.day >= qBounds.start && d.day <= qBounds.end);
  }, [data, selectedQuarter]);

  // Calculate latest values for header (current + comparison for % change)
  const { latestValue, comparisonValue, percentChange } = useMemo(() => {
    // For cumulative charts: find last day with non-null value
    // For daily charts: find last day with value > 0 (excluding today's partial)
    const validData = chartData.filter((d) => {
      const val = d[currentKey];
      if (isCumulative) return val !== null;
      // For daily: exclude today's partial data by checking if comparison also has data
      return val !== null && val > 0 && d[comparisonKey] > 0;
    });
    if (validData.length === 0) return { latestValue: 0, comparisonValue: 0, percentChange: null };

    const lastDay = validData[validData.length - 1];
    const current = lastDay[currentKey] ?? 0;
    const comparison = lastDay[comparisonKey] ?? 0;
    const pctChange = comparison > 0 ? ((current - comparison) / comparison) * 100 : null;

    return { latestValue: current, comparisonValue: comparison, percentChange: pctChange };
  }, [chartData, currentKey, comparisonKey, isCumulative]);

  return (
    <div className="bg-bg-secondary rounded-2xl border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between p-5 pb-0">
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-0.5">{title}</h3>
          <p className="text-xs text-text-muted">{subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-text-primary tabular-nums">
            {valueFormatter(latestValue)}
          </div>
          <div className="flex items-center justify-end gap-2">
            {percentChange !== null && (
              <span className={`text-xs font-medium ${percentChange >= 0 ? "text-status-good" : "text-status-bad"}`}>
                {percentChange >= 0 ? "+" : ""}{percentChange.toFixed(1)}%
              </span>
            )}
            <span className="text-xs text-text-muted">
              {isCumulative ? "YTD" : "Last Complete"}
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64 px-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
            <defs>
              <linearGradient id={`${gradientId}Current`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.current} stopOpacity={isCumulative ? 0.25 : 0.2} />
                <stop offset="100%" stopColor={colors.current} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`${gradientId}Comparison`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.comparison} stopOpacity={0.1} />
                <stop offset="100%" stopColor={colors.comparison} stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Quarter reference areas (only in full year view) */}
            {!selectedQuarter && quarterBoundaries.map((q, i) => (
              <ReferenceArea
                key={q.q}
                x1={q.start}
                x2={q.end}
                fill={i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent"}
                strokeOpacity={0}
              />
            ))}

            <XAxis
              dataKey="day"
              tick={{ fill: "#64748B", fontSize: 10 }}
              axisLine={{ stroke: "#1E293B" }}
              tickLine={false}
              interval={selectedQuarter ? 10 : 60}
              tickFormatter={(day) => {
                if (selectedQuarter) return `${day}`;
                return fmt.dayToMonth(day);
              }}
            />
            <YAxis
              tick={{ fill: "#64748B", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={yAxisFormatter}
              width={50}
            />
            <Tooltip
              content={
                <ChartTooltip
                  prefix={dataKeyPrefix.includes("revenue") || dataKeyPrefix.includes("Revenue") ? "$" : ""}
                  currentLabel={currentLabel}
                  comparisonLabel={comparisonLabel}
                />
              }
            />

            {/* Current day marker */}
            {!selectedQuarter && (
              <ReferenceLine x={currentDayOfYear} stroke="#475569" strokeDasharray="4 4" strokeWidth={1} />
            )}

            {/* Comparison area/line */}
            {isCumulative ? (
              <Area
                type="monotone"
                dataKey={comparisonKey}
                stroke={colors.comparison}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                fill={`url(#${gradientId}Comparison)`}
              />
            ) : (
              <Line
                type="monotone"
                dataKey={comparisonKey}
                stroke={colors.comparison}
                strokeWidth={1}
                strokeDasharray="4 4"
                dot={false}
              />
            )}

            {/* Current area */}
            <Area
              type="monotone"
              dataKey={currentKey}
              stroke={colors.current}
              strokeWidth={isCumulative ? 2 : 1.5}
              fill={`url(#${gradientId}Current)`}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-8 py-3 border-t border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
          <span className="text-xs text-text-tertiary font-medium">{currentLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 rounded-full border-t-2 border-dashed" style={{ borderColor: colors.comparison }} />
          <span className="text-xs text-text-tertiary font-medium">{comparisonLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================

export function RevenueTrackerDashboard({
  data,
  loading,
  onRefresh,
  onYearChange,
  onPeriodChange,
  availableYears,
  channel = "total",
  onChannelChange,
}: RevenueTrackerDashboardProps) {
  const [periodMode, setPeriodMode] = useState<PeriodMode>("calendar");
  const [trailingDays, setTrailingDays] = useState<TrailingPeriod>(365);
  const [selectedQuarter, setSelectedQuarter] = useState<number | null>(null);

  // Handle period mode changes
  const handleModeChange = useCallback((mode: PeriodMode) => {
    setPeriodMode(mode);
    setSelectedQuarter(null);
    onPeriodChange?.(mode, mode === "trailing" ? trailingDays : undefined);
  }, [trailingDays, onPeriodChange]);

  const handleTrailingChange = useCallback((days: TrailingPeriod) => {
    setTrailingDays(days);
    setSelectedQuarter(null);
    onPeriodChange?.("trailing", days);
  }, [onPeriodChange]);

  const handleYearChange = useCallback((year: number) => {
    setSelectedQuarter(null);
    onYearChange(year);
  }, [onYearChange]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
          <span className="text-sm text-text-tertiary tracking-wide">Loading revenue data...</span>
        </div>
      </div>
    );
  }

  // Empty state
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Calendar className="w-12 h-12 text-text-muted" />
        <span className="text-text-tertiary">No revenue data available</span>
        <button
          onClick={onRefresh}
          className="px-4 py-2 text-sm bg-bg-secondary hover:bg-bg-tertiary rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>
    );
  }

  const { currentYear, comparisonYear, dailyData, quarterSummaries, ytdSummary } = data;

  // Transform for charts
  const chartData = dailyData.map((d) => ({
    day: d.dayOfYear,
    ordersCurrent: d.ordersCurrent,
    ordersComparison: d.ordersComparison,
    revenueCurrent: d.revenueCurrent,
    revenueComparison: d.revenueComparison,
    cumOrdersCurrent: d.cumulativeOrdersCurrent,
    cumOrdersComparison: d.cumulativeOrdersComparison,
    cumRevenueCurrent: d.cumulativeRevenueCurrent,
    cumRevenueComparison: d.cumulativeRevenueComparison,
  }));

  // Current day of year
  const currentDayOfYear = currentYear === new Date().getFullYear()
    ? dailyData.filter((d) => d.ordersCurrent > 0 || d.revenueCurrent > 0).length
    : 365;

  // Labels based on mode
  const currentLabel = periodMode === "calendar" ? `${currentYear}` : `Last ${trailingDays}d`;
  const comparisonLabel = periodMode === "calendar" ? `${comparisonYear}` : `Prior ${trailingDays}d`;

  // Selected quarter data
  const selectedQuarterData = selectedQuarter
    ? quarterSummaries.find((q) => q.quarter === selectedQuarter)
    : null;

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Back button when in quarter drill-down */}
          {selectedQuarter && (
            <button
              onClick={() => setSelectedQuarter(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-secondary rounded-lg transition-colors text-sm text-text-secondary"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>All Quarters</span>
            </button>
          )}

          {/* Period Selector */}
          <PeriodSelector
            mode={periodMode}
            onModeChange={handleModeChange}
            selectedYear={currentYear}
            onYearChange={handleYearChange}
            availableYears={availableYears}
            trailingDays={trailingDays}
            onTrailingChange={handleTrailingChange}
          />

          {/* Channel Selector */}
          {onChannelChange && (
            <ChannelSelector
              channel={channel ?? "total"}
              onChannelChange={onChannelChange}
            />
          )}

          {/* Growth badges */}
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-md text-xs font-bold tabular-nums ${
              (ytdSummary.revenueGrowth ?? 0) >= 0
                ? "bg-status-good/10 text-status-good"
                : "bg-status-bad/10 text-status-bad"
            }`}>
              {fmt.delta(ytdSummary.revenueGrowth)} Rev
            </span>
            <span className={`px-2.5 py-1 rounded-md text-xs font-bold tabular-nums ${
              (ytdSummary.ordersGrowth ?? 0) >= 0
                ? "bg-status-good/10 text-status-good"
                : "bg-status-bad/10 text-status-bad"
            }`}>
              {fmt.delta(ytdSummary.ordersGrowth)} Orders
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <StaleTimestamp date={data.lastSynced} />
          <span className="text-xs font-semibold text-text-muted tabular-nums uppercase tracking-wider">
            {ytdSummary.daysComplete} Days
          </span>
        </div>
      </div>

      {/* Quarter Cards (hide in quarter drill-down) */}
      {!selectedQuarter && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          {quarterSummaries.map((q) => (
            <QuarterCard
              key={q.quarter}
              quarter={q}
              currentYear={currentYear}
              isSelected={selectedQuarter === q.quarter}
              onClick={() => setSelectedQuarter(q.quarter)}
            />
          ))}
        </div>
      )}

      {/* Quarter Drill-Down Header */}
      {selectedQuarterData && (
        <div className="bg-bg-secondary rounded-2xl p-6 border border-accent-blue/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: colors[`q${selectedQuarter}` as keyof typeof colors] }}
              />
              <h2 className="text-xl font-bold text-text-primary">{selectedQuarterData.label}</h2>
              <span className="text-sm text-text-muted font-medium">{selectedQuarterData.months}</span>
            </div>
            <div className="text-right">
              <div className="text-sm text-text-muted mb-1">vs {comparisonYear}</div>
              <div className={`text-2xl font-bold ${(selectedQuarterData.revenueGrowth ?? 0) >= 0 ? "text-status-good" : "text-status-bad"}`}>
                {fmt.delta(selectedQuarterData.revenueGrowth)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wider mb-1">Revenue</div>
              <div className="text-lg font-bold text-text-primary tabular-nums">{fmt.currency(selectedQuarterData.revenueCurrent)}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wider mb-1">Orders</div>
              <div className="text-lg font-bold text-text-primary tabular-nums">{fmt.number(selectedQuarterData.ordersCurrent)}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wider mb-1">Days Complete</div>
              <div className="text-lg font-bold text-text-primary tabular-nums">{selectedQuarterData.daysComplete}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wider mb-1">Avg Daily Rev</div>
              <div className="text-lg font-bold text-text-primary tabular-nums">
                {fmt.currency(selectedQuarterData.daysComplete > 0 ? selectedQuarterData.revenueCurrent / selectedQuarterData.daysComplete : 0)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero Metrics (only in full year view) */}
      {!selectedQuarter && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative overflow-hidden bg-bg-secondary rounded-2xl p-6 border border-border">
            <div className="absolute top-0 right-0 w-40 h-40 bg-status-good/5 rounded-full blur-3xl -mr-16 -mt-16" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-status-good" />
                <span className="text-xs font-bold text-text-tertiary uppercase tracking-wider">YTD Revenue</span>
              </div>
              <div className={`text-4xl font-bold tracking-tight leading-none mb-3 ${
                (ytdSummary.revenueGrowth ?? 0) >= 0 ? "text-status-good" : "text-status-bad"
              }`}>
                {fmt.delta(ytdSummary.revenueGrowth)}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-text-primary font-semibold">{fmt.currency(ytdSummary.revenueCurrent)}</span>
                <span className="text-text-muted">vs {fmt.currency(ytdSummary.revenueComparison)}</span>
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden bg-bg-secondary rounded-2xl p-6 border border-border">
            <div className="absolute top-0 right-0 w-40 h-40 bg-accent-blue/5 rounded-full blur-3xl -mr-16 -mt-16" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-4">
                <Package className="w-4 h-4 text-accent-blue" />
                <span className="text-xs font-bold text-text-tertiary uppercase tracking-wider">YTD Orders</span>
              </div>
              <div className={`text-4xl font-bold tracking-tight leading-none mb-3 ${
                (ytdSummary.ordersGrowth ?? 0) >= 0 ? "text-status-good" : "text-status-bad"
              }`}>
                {fmt.delta(ytdSummary.ordersGrowth)}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-text-primary font-semibold">{fmt.number(ytdSummary.ordersCurrent)}</span>
                <span className="text-text-muted">vs {fmt.number(ytdSummary.ordersComparison)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full-Width Charts */}
      <div className="space-y-4">
        {/* Daily Revenue Chart */}
        <FullWidthChart
          data={chartData}
          dataKeyPrefix="revenue"
          title="Daily Revenue"
          subtitle={selectedQuarter ? `${selectedQuarterData?.months} performance` : "Revenue by day of year"}
          currentLabel={currentLabel}
          comparisonLabel={comparisonLabel}
          valueFormatter={fmt.currency}
          yAxisFormatter={(v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`}
          gradientId="dailyRevenue"
          currentDayOfYear={currentDayOfYear}
          selectedQuarter={selectedQuarter}
        />

        {/* Cumulative Revenue Chart */}
        <FullWidthChart
          data={chartData}
          dataKeyPrefix="cumRevenue"
          title="Cumulative Revenue"
          subtitle={selectedQuarter ? "Running total within quarter" : "Running total through the year"}
          currentLabel={currentLabel}
          comparisonLabel={comparisonLabel}
          valueFormatter={(n) => n === null ? "—" : `$${(n / 1000000).toFixed(2)}M`}
          yAxisFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
          gradientId="cumRevenue"
          currentDayOfYear={currentDayOfYear}
          selectedQuarter={selectedQuarter}
        />

        {/* Daily Orders Chart */}
        <FullWidthChart
          data={chartData}
          dataKeyPrefix="orders"
          title="Daily Orders"
          subtitle={selectedQuarter ? `${selectedQuarterData?.months} order volume` : "Order volume by day of year"}
          currentLabel={currentLabel}
          comparisonLabel={comparisonLabel}
          valueFormatter={fmt.number}
          yAxisFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`}
          gradientId="dailyOrders"
          currentDayOfYear={currentDayOfYear}
          selectedQuarter={selectedQuarter}
        />

        {/* Cumulative Orders Chart */}
        <FullWidthChart
          data={chartData}
          dataKeyPrefix="cumOrders"
          title="Cumulative Orders"
          subtitle={selectedQuarter ? "Running total within quarter" : "Running total through the year"}
          currentLabel={currentLabel}
          comparisonLabel={comparisonLabel}
          valueFormatter={fmt.number}
          yAxisFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
          gradientId="cumOrders"
          currentDayOfYear={currentDayOfYear}
          selectedQuarter={selectedQuarter}
        />
      </div>

      {/* Quick Stats Row (only in full year view) */}
      {!selectedQuarter && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
            <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Avg Daily Orders</div>
            <div className="text-xl font-bold text-text-primary tabular-nums">
              {ytdSummary.avgDailyOrders.toLocaleString()}
            </div>
          </div>
          <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
            <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Avg Daily Revenue</div>
            <div className="text-xl font-bold text-text-primary tabular-nums">
              {fmt.currency(ytdSummary.avgDailyRevenue)}
            </div>
          </div>
          <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
            <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Avg Order Value</div>
            <div className="text-xl font-bold text-text-primary tabular-nums">
              ${ytdSummary.avgOrderValue}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
