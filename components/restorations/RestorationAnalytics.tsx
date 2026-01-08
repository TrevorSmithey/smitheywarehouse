"use client";

import { useMemo, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  RefreshCw,
  Activity,
  Timer,
  Target,
  TrendingUp,
  TrendingDown,
  Award,
  AlertTriangle,
  ExternalLink,
  Clock,
  Download,
  ChevronDown,
  Calendar,
} from "lucide-react";
import type { RestorationResponse, RestorationRecord } from "@/app/api/restorations/route";
import { StaleTimestamp } from "@/components/StaleTimestamp";
import { useDashboard } from "@/app/(dashboard)/layout";

interface RestorationAnalyticsProps {
  data: RestorationResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onItemClick?: (restoration: RestorationRecord) => void;
}

// Pipeline stages
const PIPELINE_STAGES = [
  "delivered_warehouse",
  "received",
  "at_restoration",
  "ready_to_ship",
] as const;

type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Thresholds for CS callouts
const CS_THRESHOLDS = {
  delivered_warehouse: 2, // Contact if > 2 days
  at_restoration: 14, // Contact if > 14 days
  timeout_warning: 49, // 7 weeks (1 week before 8-week timeout)
};

// ============================================================================
// INTERNAL CYCLE TREND CHART (Recharts)
// ============================================================================

interface InternalCycleTrendChartProps {
  data: Array<{ month: string; medianDays: number; count: number }>;
}

function InternalCycleTrendChart({ data }: InternalCycleTrendChartProps) {
  if (!data || data.length < 2) return null;

  // Format month for display
  const formatMonth = (monthStr: string) => {
    const [, month] = monthStr.split("-");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return monthNames[parseInt(month) - 1] || monthStr;
  };

  const chartData = data.map((d) => ({
    month: formatMonth(d.month),
    days: d.medianDays,
    count: d.count,
  }));

  const maxValue = Math.max(...data.map((d) => d.medianDays), 25);

  return (
    <div
      role="img"
      aria-label={`Internal cycle time trend chart showing ${data.length} months of data. Latest month: ${data[data.length - 1]?.medianDays || 0} days median cycle time.`}
    >
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cycleGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="month"
          stroke="#94A3B8"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#94A3B8"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={35}
          domain={[0, maxValue]}
          tickFormatter={(value) => `${value}d`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1E293B",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#E2E8F0" }}
          formatter={(value: number) => [
            <span key="v" style={{ color: "#f59e0b", fontWeight: 600 }}>{value}d</span>,
            "Median Cycle",
          ]}
        />
        <ReferenceLine
          y={21}
          stroke="#10b981"
          strokeDasharray="4 2"
          strokeOpacity={0.6}
          label={{ value: "21d target", position: "right", fontSize: 10, fill: "#10b981", opacity: 0.8 }}
        />
        <Area
          type="monotone"
          dataKey="days"
          stroke="#f59e0b"
          strokeWidth={2}
          fill="url(#cycleGradient)"
          dot={{ fill: "#f59e0b", strokeWidth: 0, r: 4 }}
          activeDot={{ fill: "#f59e0b", strokeWidth: 2, stroke: "#fff", r: 6 }}
        />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}

// ============================================================================
// STAGE BREAKDOWN BAR
// ============================================================================

interface StageBreakdownProps {
  internalCycle: {
    receivedToRestoration: number;
    atRestoration: number;
    restorationToShipped: number;
    totalInternal: number;
  };
}

function StageBreakdown({ internalCycle }: StageBreakdownProps) {
  const stages = [
    { label: "Check-in → Send Out", days: internalCycle.receivedToRestoration, color: "bg-emerald-500" },
    { label: "At Restoration", days: internalCycle.atRestoration, color: "bg-purple-500" },
    { label: "Back → Shipped", days: internalCycle.restorationToShipped, color: "bg-blue-500" },
  ];

  const maxStage = Math.max(...stages.map((s) => s.days || 0));

  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const width = maxStage > 0 ? ((stage.days || 0) / maxStage) * 100 : 0;
        return (
          <div key={stage.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-secondary">{stage.label}</span>
              <span className="text-sm font-semibold text-text-primary">{stage.days || 0}d</span>
            </div>
            <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className={`h-full ${stage.color} rounded-full transition-all`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
      <div className="pt-3 border-t border-border/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Your Total Time
          </span>
          <span
            className={`text-xl font-bold ${
              internalCycle.totalInternal <= 14
                ? "text-emerald-400"
                : internalCycle.totalInternal <= 21
                ? "text-amber-400"
                : "text-red-400"
            }`}
          >
            {internalCycle.totalInternal || 0}d
          </span>
        </div>
        <p className="text-[10px] text-text-muted mt-1">
          Median time from received to shipped (what you control)
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// CS ACTION ITEMS
// ============================================================================

interface CSActionItemsProps {
  restorations: RestorationRecord[];
  onItemClick?: (restoration: RestorationRecord) => void;
}

function CSActionItems({ restorations, onItemClick }: CSActionItemsProps) {
  // Group items by CS action type
  const deliveredTooLong = restorations.filter(
    (r) => r.status === "delivered_warehouse" && r.days_in_status > CS_THRESHOLDS.delivered_warehouse
  );

  const atRestorationTooLong = restorations.filter(
    (r) => r.status === "at_restoration" && r.days_in_status > CS_THRESHOLDS.at_restoration
  );

  const timeoutApproaching = restorations.filter(
    (r) =>
      PIPELINE_STAGES.includes(r.status as PipelineStage) &&
      r.total_days > CS_THRESHOLDS.timeout_warning
  );

  const hasItems = deliveredTooLong.length > 0 || atRestorationTooLong.length > 0 || timeoutApproaching.length > 0;

  if (!hasItems) {
    return (
      <div className="bg-bg-secondary border border-border rounded-lg p-4 text-center">
        <div className="text-text-secondary text-sm">No customers need proactive outreach right now</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Delivered > 2 days */}
      {deliveredTooLong.length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            <span className="text-sm font-semibold text-orange-400 uppercase tracking-wider">
              Delivered &gt; 2 Days ({deliveredTooLong.length})
            </span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Customer may be asking &quot;where&apos;s my stuff?&quot; - item delivered but not checked in
          </p>
          <div className="space-y-2">
            {deliveredTooLong.slice(0, 5).map((item) => (
              <CSItem key={item.id} item={item} onItemClick={onItemClick} />
            ))}
            {deliveredTooLong.length > 5 && (
              <div className="text-xs text-text-muted">+{deliveredTooLong.length - 5} more</div>
            )}
          </div>
        </div>
      )}

      {/* At Restoration > 14 days */}
      {atRestorationTooLong.length > 0 && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-sm font-semibold text-purple-400 uppercase tracking-wider">
              At Restoration &gt; 14 Days ({atRestorationTooLong.length})
            </span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Consider proactive status update - customer hasn&apos;t heard from us in a while
          </p>
          <div className="space-y-2">
            {atRestorationTooLong.slice(0, 5).map((item) => (
              <CSItem key={item.id} item={item} onItemClick={onItemClick} />
            ))}
            {atRestorationTooLong.length > 5 && (
              <div className="text-xs text-text-muted">+{atRestorationTooLong.length - 5} more</div>
            )}
          </div>
        </div>
      )}

      {/* 8-week timeout approaching */}
      {timeoutApproaching.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400 uppercase tracking-wider">
              8-Week Timeout Approaching ({timeoutApproaching.length})
            </span>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Contact before auto-cancel - these orders are approaching the 8-week deadline
          </p>
          <div className="space-y-2">
            {timeoutApproaching.slice(0, 5).map((item) => (
              <CSItem key={item.id} item={item} showTotalDays onItemClick={onItemClick} />
            ))}
            {timeoutApproaching.length > 5 && (
              <div className="text-xs text-text-muted">+{timeoutApproaching.length - 5} more</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CSItemProps {
  item: RestorationRecord;
  showTotalDays?: boolean;
  onItemClick?: (restoration: RestorationRecord) => void;
}

function CSItem({ item, showTotalDays, onItemClick }: CSItemProps) {
  return (
    <button
      onClick={() => onItemClick?.(item)}
      className="w-full flex items-center justify-between py-2 px-3 bg-bg-secondary/50 rounded hover:bg-bg-secondary transition-colors cursor-pointer text-left"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-primary font-medium">
          {item.order_name || `#${item.id}`}
        </span>
        {item.shopify_order_id && (
          <a
            href={`https://admin.shopify.com/store/smithey-iron-ware/orders/${item.shopify_order_id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-accent-blue hover:underline flex items-center gap-0.5"
          >
            Shopify
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        <Clock className="w-3 h-3" />
        <span className="tabular-nums font-medium">
          {showTotalDays ? `${item.total_days}d total` : `${item.days_in_status}d`}
        </span>
      </div>
    </button>
  );
}

// ============================================================================
// MINI TREND CHART
// ============================================================================

interface TrendChartProps {
  data: Array<{ month: string; created: number; completed: number }>;
  height?: number;
}

function TrendChart({ data, height = 48 }: TrendChartProps) {
  if (!data || data.length < 2) return null;

  // Data is already ordered oldest-to-newest from API, no need to reverse
  const chartData = [...data].slice(-6);
  const maxValue = Math.max(...chartData.flatMap((d) => [d.created, d.completed]));
  const width = 180;
  const padding = 4;

  const getY = (value: number) => height - padding - ((value / maxValue) * (height - padding * 2));
  const getX = (index: number) => padding + (index / (chartData.length - 1)) * (width - padding * 2);

  const createdPath = chartData.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.created)}`).join(" ");
  const completedPath = chartData.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.completed)}`).join(" ");

  const latestMonth = chartData[chartData.length - 1];

  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible"
      role="img"
      aria-label={`Trend chart showing ${chartData.length} months. Latest: ${latestMonth?.created || 0} created, ${latestMonth?.completed || 0} completed.`}
    >
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
      <path d={createdPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
      <path d={completedPath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
      {chartData.map((d, i) => (
        <g key={d.month}>
          <circle cx={getX(i)} cy={getY(d.created)} r="3" fill="#f59e0b" />
          <circle cx={getX(i)} cy={getY(d.completed)} r="3" fill="#10b981" />
        </g>
      ))}
    </svg>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// Date range options
type DateRange = "30" | "60" | "90" | "all";
const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export function RestorationAnalytics({ data, loading, onRefresh, onItemClick }: RestorationAnalyticsProps) {
  const { lastRefresh } = useDashboard();
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  const stats = data?.stats;
  const restorations = data?.restorations || [];

  // Filter restorations by date range
  const filteredRestorations = useMemo(() => {
    if (dateRange === "all") return restorations;
    const days = parseInt(dateRange);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return restorations.filter((r) => new Date(r.order_created_at) >= cutoff);
  }, [restorations, dateRange]);

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    if (!restorations.length) return;

    const headers = ["Order", "RMA", "Status", "Days in Status", "Total Days", "Created", "Is POS"];
    const rows = filteredRestorations.map((r) => [
      r.order_name || "",
      r.rma_number || "",
      r.status,
      r.days_in_status,
      r.total_days,
      r.created_at,
      r.is_pos ? "Yes" : "No",
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `restorations-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRestorations, restorations.length]);

  // Pre-warehouse count
  const preWarehouseCount = useMemo(() => {
    if (!restorations) return 0;
    return restorations.filter((r) =>
      ["pending_label", "label_sent", "in_transit_inbound"].includes(r.status)
    ).length;
  }, [restorations]);

  // Overdue count (memoized to avoid recalculating on every render)
  const overdueCount = useMemo(() => {
    return restorations.filter(
      (r) => PIPELINE_STAGES.includes(r.status as PipelineStage) && r.total_days > 21
    ).length;
  }, [restorations]);

  // Throughput trend
  // monthlyVolume is ordered: [5mo ago, 4mo ago, 3mo ago, 2mo ago, 1mo ago, current]
  // So slice(3,6) = recent 3 months, slice(0,3) = older 3 months
  const monthlyData = stats?.monthlyVolume || [];
  const olderMonths = monthlyData.slice(0, 3);   // indices 0,1,2 = 5,4,3 months ago
  const recentMonths = monthlyData.slice(3, 6);  // indices 3,4,5 = 2,1,current months
  const recentCompleted = recentMonths.reduce((sum, m) => sum + m.completed, 0);
  const olderCompleted = olderMonths.reduce((sum, m) => sum + m.completed, 0);
  const throughputTrend = recentCompleted > olderCompleted ? "up" : recentCompleted < olderCompleted ? "down" : "flat";

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-12 bg-bg-secondary rounded-lg" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-bg-secondary rounded-lg" />
          ))}
        </div>
        <div className="h-64 bg-bg-secondary rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ============================================================ */}
      {/* HEADER */}
      {/* ============================================================ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary uppercase tracking-wider">
            Restoration Analytics
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <StaleTimestamp date={lastRefresh} prefix="Updated" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Export with Date Range Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDateDropdown(!showDateDropdown)}
              disabled={!restorations.length}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text-secondary hover:text-accent-blue transition-colors disabled:opacity-50"
              title="Export to CSV"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
              <span className="text-text-muted hidden sm:inline">
                ({DATE_RANGE_OPTIONS.find((o) => o.value === dateRange)?.label})
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showDateDropdown ? "rotate-180" : ""}`} />
            </button>
            {showDateDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDateDropdown(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-bg-primary border border-border rounded-lg shadow-xl py-1 min-w-[180px]">
                  <div className="px-3 py-2 text-[10px] text-text-muted uppercase tracking-wider border-b border-border">
                    Export Range
                  </div>
                  {DATE_RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setDateRange(option.value); }}
                      className={`w-full px-4 py-2 text-sm text-left transition-colors ${
                        dateRange === option.value
                          ? "bg-accent-blue/10 text-accent-blue"
                          : "text-text-secondary hover:bg-bg-secondary"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                  <div className="border-t border-border mt-1 pt-1">
                    <button
                      onClick={() => { handleExportCSV(); setShowDateDropdown(false); }}
                      className="w-full px-4 py-2 text-sm text-left text-accent-blue hover:bg-accent-blue/10 transition-colors font-medium"
                    >
                      Download CSV
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-text-secondary hover:text-accent-blue transition-colors disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* KPI CARDS - Hero metrics + Secondary metrics */}
      {/* ============================================================ */}
      {stats && (
        <div className="space-y-4">
          {/* Hero Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Active Queue - Hero */}
            <div
              className="bg-gradient-to-br from-sky-500/10 to-sky-600/5 rounded-xl p-5 border border-sky-500/20"
              aria-label={`Active queue: ${stats.active} items. ${preWarehouseCount} pre-warehouse, ${stats.active - preWarehouseCount} in-house.`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 bg-sky-500/20 rounded-lg">
                  <Activity className="w-5 h-5 text-sky-400" />
                </div>
                <span className="text-xs text-sky-400/80 uppercase tracking-wider font-medium">Active Queue</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold text-text-primary">{stats.active}</span>
                <span className="text-lg text-text-tertiary">items</span>
              </div>
              <div className="mt-3 flex items-center gap-3 text-sm text-text-secondary">
                <span className="px-2 py-0.5 bg-bg-tertiary/50 rounded">{preWarehouseCount} pre-warehouse</span>
                <span className="px-2 py-0.5 bg-bg-tertiary/50 rounded">{stats.active - preWarehouseCount} in-house</span>
              </div>
            </div>

            {/* Cycle Time - Hero */}
            <div
              className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl p-5 border border-amber-500/20"
              aria-label={`Median cycle time: ${stats.cycleTime?.medianDays || 0} days. D2C: ${stats.cycleTime?.d2cMedian || 0} days. POS: ${stats.cycleTime?.posMedian || 0} days.`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 bg-amber-500/20 rounded-lg">
                  <Timer className="w-5 h-5 text-amber-400" />
                </div>
                <span className="text-xs text-amber-400/80 uppercase tracking-wider font-medium">Median Cycle</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold text-text-primary">{stats.cycleTime?.medianDays || "—"}</span>
                <span className="text-lg text-text-tertiary">days</span>
                {stats.cycleTime?.medianDays && stats.cycleTime.medianDays <= 21 ? (
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full font-medium">On target</span>
                ) : (
                  <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded-full font-medium">Above 21d goal</span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3 text-sm text-text-secondary">
                <span className="px-2 py-0.5 bg-bg-tertiary/50 rounded">D2C: {stats.cycleTime?.d2cMedian || "—"}d</span>
                <span className="px-2 py-0.5 bg-bg-tertiary/50 rounded">POS: {stats.cycleTime?.posMedian || "—"}d</span>
              </div>
            </div>
          </div>

          {/* Secondary Metrics Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* SLA Performance */}
            <div
              className="bg-bg-secondary rounded-lg p-3 border border-border"
              aria-label={`SLA rate: ${stats.cycleTime?.slaRate || 0}%. ${stats.cycleTime?.meetingSLA || 0} of ${stats.cycleTime?.completed || 0} completed within 21 days.`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 bg-emerald-500/10 rounded">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">SLA Rate</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`text-2xl font-bold ${
                    (stats.cycleTime?.slaRate || 0) >= 80
                      ? "text-emerald-400"
                      : (stats.cycleTime?.slaRate || 0) >= 60
                      ? "text-amber-400"
                      : "text-red-400"
                  }`}
                >
                  {stats.cycleTime?.slaRate || 0}%
                </span>
                <span className="text-xs text-text-tertiary">≤21d</span>
              </div>
              <div className="mt-1.5 text-[10px] text-text-muted">
                {stats.cycleTime?.meetingSLA || 0}/{stats.cycleTime?.completed || 0} meet goal
              </div>
            </div>

            {/* Throughput */}
            <div
              className="bg-bg-secondary rounded-lg p-3 border border-border"
              aria-label={`Throughput: ${stats.cycleTime?.completed || 0} items shipped. Trend is ${throughputTrend}.`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded ${throughputTrend === "up" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                  {throughputTrend === "up" ? (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                  )}
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Throughput</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-text-primary">{stats.cycleTime?.completed || 0}</span>
                <span className="text-xs text-text-tertiary">shipped</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  <span className="text-text-muted">In</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span className="text-text-muted">Out</span>
                </span>
              </div>
            </div>

            {/* Pre-Warehouse */}
            <div
              className="bg-bg-secondary rounded-lg p-3 border border-border"
              aria-label={`Pre-warehouse: ${preWarehouseCount} items awaiting arrival.`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 bg-purple-500/10 rounded">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Pre-Warehouse</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-text-primary">{preWarehouseCount}</span>
                <span className="text-xs text-text-tertiary">awaiting</span>
              </div>
              <div className="mt-1.5 text-[10px] text-text-muted">
                Labels sent, in transit
              </div>
            </div>

            {/* Overdue Count */}
            <div
              className="bg-bg-secondary rounded-lg p-3 border border-border"
              aria-label={`${overdueCount} items overdue, past 21-day SLA target.`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 bg-red-500/10 rounded">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                </div>
                <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Overdue</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold ${overdueCount > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  {overdueCount}
                </span>
                <span className="text-xs text-text-tertiary">&gt;21d</span>
              </div>
              <div className="mt-1.5 text-[10px] text-text-muted">
                Past SLA target
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* INTERNAL CYCLE TREND */}
      {/* ============================================================ */}
      {stats?.internalCycle?.monthlyTrend && (
        <div className="bg-bg-secondary rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
            Internal Cycle Trend (Received → Shipped)
          </h2>
          <InternalCycleTrendChart data={stats.internalCycle.monthlyTrend.filter((m) => m.count > 0)} />
        </div>
      )}

      {/* ============================================================ */}
      {/* CS ACTION ITEMS + STAGE BREAKDOWN */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* CS Action Items - 2 cols */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            CS Action Items
          </h2>
          <CSActionItems restorations={restorations} onItemClick={onItemClick} />
        </div>

        {/* Stage Breakdown - 1 col */}
        {stats?.internalCycle && (
          <div className="bg-bg-secondary rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
              Stage Breakdown
            </h2>
            <StageBreakdown internalCycle={stats.internalCycle} />
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* ALL-TIME STATS */}
      {/* ============================================================ */}
      {stats?.allTime && (
        <div className="bg-bg-secondary rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-4 h-4 text-text-tertiary" />
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
              All-Time Performance
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Total Processed */}
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Total Processed</div>
              <div className="text-2xl font-bold text-text-primary">{stats.allTime.totalEver?.toLocaleString() || 0}</div>
              <div className="text-xs text-text-secondary mt-1">
                {stats.allTime.completedEver?.toLocaleString() || 0} completed
              </div>
            </div>

            {/* Completion Rate */}
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Completion Rate</div>
              <div
                className={`text-2xl font-bold ${
                  (stats.allTime.completionRate || 0) >= 90
                    ? "text-emerald-400"
                    : (stats.allTime.completionRate || 0) >= 70
                    ? "text-amber-400"
                    : "text-red-400"
                }`}
              >
                {stats.allTime.completionRate || 0}%
              </div>
              <div className="mt-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden max-w-[120px]">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${stats.allTime.completionRate || 0}%` }} />
              </div>
            </div>

            {/* Avg Cycle Time */}
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Avg Cycle Time</div>
              <div className="text-2xl font-bold text-text-primary">
                {stats.allTime.avgCycleTime || "—"}
                <span className="text-sm font-normal text-text-tertiary ml-1">days</span>
              </div>
              <div className="text-xs text-text-secondary mt-1">
                {(stats.allTime.avgCycleTime || 0) <= 21 ? (
                  <span className="text-emerald-400">✓ Within target</span>
                ) : (
                  <span className="text-amber-400">Above 21d target</span>
                )}
              </div>
            </div>

            {/* Oldest Active */}
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Oldest Active</div>
              {stats.allTime.oldestActiveDate ? (
                <>
                  <div className="text-2xl font-bold text-text-primary flex items-center gap-1.5">
                    <Calendar className="w-5 h-5 text-text-tertiary" />
                    {new Date(stats.allTime.oldestActiveDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    {Math.floor(
                      (Date.now() - new Date(stats.allTime.oldestActiveDate).getTime()) / (1000 * 60 * 60 * 24)
                    )}{" "}
                    days ago
                  </div>
                </>
              ) : (
                <div className="text-2xl font-bold text-text-muted">—</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
