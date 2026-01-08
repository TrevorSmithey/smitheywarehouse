"use client";

import { useMemo } from "react";
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
  Calendar,
  AlertTriangle,
  ExternalLink,
  Clock,
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

  const chartData = [...data].slice(0, 6).reverse();
  const maxValue = Math.max(...chartData.flatMap((d) => [d.created, d.completed]));
  const width = 180;
  const padding = 4;

  const getY = (value: number) => height - padding - ((value / maxValue) * (height - padding * 2));
  const getX = (index: number) => padding + (index / (chartData.length - 1)) * (width - padding * 2);

  const createdPath = chartData.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.created)}`).join(" ");
  const completedPath = chartData.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.completed)}`).join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
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

export function RestorationAnalytics({ data, loading, onRefresh, onItemClick }: RestorationAnalyticsProps) {
  const { lastRefresh } = useDashboard();

  const stats = data?.stats;
  const restorations = data?.restorations || [];

  // Pre-warehouse count
  const preWarehouseCount = useMemo(() => {
    if (!restorations) return 0;
    return restorations.filter((r) =>
      ["pending_label", "label_sent", "in_transit_inbound"].includes(r.status)
    ).length;
  }, [restorations]);

  // Throughput trend
  const monthlyData = stats?.monthlyVolume || [];
  const recentMonths = monthlyData.slice(0, 3);
  const olderMonths = monthlyData.slice(3, 6);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary uppercase tracking-wider">
            Restoration Analytics
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <StaleTimestamp date={lastRefresh} prefix="Updated" />
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2 text-text-secondary hover:text-accent-blue transition-colors disabled:opacity-50"
          title="Refresh data"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ============================================================ */}
      {/* KPI CARDS */}
      {/* ============================================================ */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Active Queue */}
          <div className="bg-bg-secondary rounded-lg p-4 border border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-sky-500/10 rounded-lg">
                <Activity className="w-4 h-4 text-sky-400" />
              </div>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Active Queue</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-text-primary">{stats.active}</span>
              <span className="text-sm text-text-tertiary">items</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
              <span>{preWarehouseCount} pre-warehouse</span>
              <span className="text-text-tertiary">•</span>
              <span>{stats.active - preWarehouseCount} in-house</span>
            </div>
          </div>

          {/* Cycle Time */}
          <div className="bg-bg-secondary rounded-lg p-4 border border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Timer className="w-4 h-4 text-amber-400" />
              </div>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Median Cycle</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-text-primary">{stats.cycleTime?.medianDays || "—"}</span>
              <span className="text-sm text-text-tertiary">days</span>
              {stats.cycleTime?.medianDays && stats.cycleTime.medianDays <= 21 ? (
                <span className="text-emerald-400 text-xs ml-1">On target</span>
              ) : (
                <span className="text-amber-400 text-xs ml-1">Above 21d goal</span>
              )}
            </div>
            <div className="mt-2 text-xs text-text-secondary">
              D2C: {stats.cycleTime?.d2cMedian || "—"}d • POS: {stats.cycleTime?.posMedian || "—"}d
            </div>
          </div>

          {/* SLA Performance */}
          <div className="bg-bg-secondary rounded-lg p-4 border border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <Target className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider">SLA Rate</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-3xl font-bold ${
                  (stats.cycleTime?.slaRate || 0) >= 80
                    ? "text-emerald-400"
                    : (stats.cycleTime?.slaRate || 0) >= 60
                    ? "text-amber-400"
                    : "text-red-400"
                }`}
              >
                {stats.cycleTime?.slaRate || 0}%
              </span>
              <span className="text-sm text-text-tertiary">≤21 days</span>
            </div>
            <div className="mt-2 text-xs text-text-secondary">
              {stats.cycleTime?.meetingSLA || 0} of {stats.cycleTime?.completed || 0} meet goal
            </div>
          </div>

          {/* Throughput Trend */}
          <div className="bg-bg-secondary rounded-lg p-4 border border-border">
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2 rounded-lg ${throughputTrend === "up" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                {throughputTrend === "up" ? (
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-400" />
                )}
              </div>
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Throughput</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-3xl font-bold text-text-primary">{stats.cycleTime?.completed || 0}</span>
                <span className="text-sm text-text-tertiary ml-2">shipped</span>
              </div>
              <TrendChart data={stats.monthlyVolume} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                <span className="text-text-tertiary">Created</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="text-text-tertiary">Completed</span>
              </span>
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
