"use client";

import { useState, useMemo } from "react";
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
  Package,
  Truck,
  CheckCircle,
  AlertTriangle,
  Clock,
  Search,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Wrench,
  TrendingUp,
  TrendingDown,
  Target,
  Timer,
  Inbox,
  Send,
  Activity,
  AlertCircle,
  Calendar,
  Award,
} from "lucide-react";
import type { RestorationResponse, RestorationRecord } from "@/app/api/restorations/route";
import { RestorationCheckIn } from "./RestorationCheckIn";
import { RestorationHandoff } from "./RestorationHandoff";
import { StaleTimestamp } from "@/components/StaleTimestamp";
import { useDashboard } from "@/app/(dashboard)/layout";

interface RestorationPipelineProps {
  data: RestorationResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

// Pipeline stages - simplified 4-stage model
const PIPELINE_STAGES = [
  "inbound",
  "processing",
  "at_restoration",
  "outbound",
] as const;

type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Map visual stages to database statuses
const STAGE_STATUS_MAP: Record<PipelineStage, string[]> = {
  inbound: ["in_transit_inbound", "delivered_warehouse"],
  processing: ["received"],
  at_restoration: ["at_restoration"],
  outbound: ["ready_to_ship"],
};

// Stage display configuration
const STAGE_CONFIG: Record<PipelineStage, {
  label: string;
  icon: typeof Package;
  color: string;
  bgColor: string;
  alertThreshold: number;
  actionLabel?: string;
}> = {
  inbound: {
    label: "Inbound",
    icon: Truck,
    color: "text-sky-400",
    bgColor: "bg-sky-500/10 border-sky-500/30",
    alertThreshold: 2, // Delivered items sitting >2d
    actionLabel: "Check In",
  },
  processing: {
    label: "Processing",
    icon: Inbox,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/30",
    alertThreshold: 3,
    actionLabel: "Send to Restoration",
  },
  at_restoration: {
    label: "At Restoration",
    icon: Wrench,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10 border-purple-500/30",
    alertThreshold: 14,
  },
  outbound: {
    label: "Outbound",
    icon: Send,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/30",
    alertThreshold: 3,
    actionLabel: "Fulfill in Shopify",
  },
};

// ============================================================================
// MINI TREND CHART - Sparkline for monthly data (KPI card)
// ============================================================================

interface TrendChartProps {
  data: Array<{ month: string; created: number; completed: number }>;
  height?: number;
}

function TrendChart({ data, height = 48 }: TrendChartProps) {
  if (!data || data.length < 2) return null;

  // Take last 6 months, reverse for chronological order
  const chartData = [...data].slice(0, 6).reverse();
  const maxValue = Math.max(...chartData.flatMap(d => [d.created, d.completed]));
  const width = 180;
  const padding = 4;

  const getY = (value: number) => {
    return height - padding - ((value / maxValue) * (height - padding * 2));
  };

  const getX = (index: number) => {
    return padding + (index / (chartData.length - 1)) * (width - padding * 2);
  };

  // Create paths for created and completed lines
  const createdPath = chartData.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.created)}`
  ).join(' ');

  const completedPath = chartData.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.completed)}`
  ).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Grid lines */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding}
        stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />

      {/* Created line (amber) */}
      <path d={createdPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />

      {/* Completed line (emerald) */}
      <path d={completedPath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />

      {/* Data points */}
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
// INTERNAL CYCLE TREND LINE CHART (Recharts)
// ============================================================================

interface InternalCycleTrendChartProps {
  data: Array<{ month: string; medianDays: number; count: number }>;
  formatMonth: (month: string) => string;
}

function InternalCycleTrendChart({ data, formatMonth }: InternalCycleTrendChartProps) {
  if (!data || data.length < 2) return null;

  // Transform data for recharts
  const chartData = data.map(d => ({
    month: formatMonth(d.month),
    days: d.medianDays,
    count: d.count,
  }));

  const maxValue = Math.max(...data.map(d => d.medianDays), 25);

  return (
    <ResponsiveContainer width="100%" height={100}>
      <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cycleGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="month"
          stroke="#64748B"
          fontSize={10}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#64748B"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          width={28}
          domain={[0, maxValue]}
          tickFormatter={(value) => `${value}d`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#12151F",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "4px",
            fontSize: "11px",
          }}
          labelStyle={{ color: "#94A3B8" }}
          formatter={(value: number) => [
            <span key="v" style={{ color: "#f59e0b", fontWeight: 600 }}>{value}d</span>,
            "Median Cycle"
          ]}
        />
        <ReferenceLine
          y={21}
          stroke="#10b981"
          strokeDasharray="4 2"
          strokeOpacity={0.5}
          label={{ value: "21d target", position: "right", fontSize: 9, fill: "#10b981", opacity: 0.7 }}
        />
        <Area
          type="monotone"
          dataKey="days"
          stroke="#f59e0b"
          strokeWidth={2}
          fill="url(#cycleGradient)"
          dot={{ fill: "#f59e0b", strokeWidth: 0, r: 3 }}
          activeDot={{ fill: "#f59e0b", strokeWidth: 2, stroke: "#fff", r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ============================================================================
// INTERNAL CYCLE BREAKDOWN - The time YOU control (received → shipped)
// ============================================================================

interface InternalCycleBreakdownProps {
  internalCycle: {
    receivedToRestoration: number;
    atRestoration: number;
    restorationToShipped: number;
    totalInternal: number;
  };
  internalCycleTrend?: Array<{ month: string; medianDays: number; count: number }>;
}

function InternalCycleBreakdown({ internalCycle, internalCycleTrend }: InternalCycleBreakdownProps) {
  const stages = [
    { label: "Check-in → Send Out", days: internalCycle.receivedToRestoration, color: "bg-emerald-500" },
    { label: "At Restoration", days: internalCycle.atRestoration, color: "bg-purple-500" },
    { label: "Back → Shipped", days: internalCycle.restorationToShipped, color: "bg-blue-500" },
  ];

  const maxStage = Math.max(...stages.map(s => s.days || 0));

  // Format month for display
  const formatMonth = (monthStr: string) => {
    const [, month] = monthStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthNames[parseInt(month) - 1] || monthStr;
  };

  // Trend sparkline (optional)
  const trendData = internalCycleTrend?.filter(m => m.count > 0) || [];

  return (
    <div className="space-y-4">
      {/* Stage Breakdown */}
      <div className="space-y-3">
        {stages.map((stage) => {
          const width = maxStage > 0 ? ((stage.days || 0) / maxStage) * 100 : 0;
          return (
            <div key={stage.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-text-secondary">{stage.label}</span>
                <span className="text-sm font-semibold text-text-primary">
                  {stage.days || 0}d
                </span>
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
      </div>

      {/* Total */}
      <div className="pt-3 border-t border-border/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Your Total Time
          </span>
          <span className={`text-xl font-bold ${
            internalCycle.totalInternal <= 14 ? "text-emerald-400" :
            internalCycle.totalInternal <= 21 ? "text-amber-400" : "text-red-400"
          }`}>
            {internalCycle.totalInternal || 0}d
          </span>
        </div>
        <p className="text-[10px] text-text-muted mt-1">
          Median time from received to shipped (what you control)
        </p>
      </div>

      {/* Monthly Trend - Line Chart */}
      {trendData.length >= 3 && (
        <div className="pt-3 border-t border-border/30">
          <span className="text-[10px] text-text-tertiary uppercase tracking-wider">
            Internal Cycle Trend
          </span>
          <div className="mt-3">
            <InternalCycleTrendChart data={trendData} formatMonth={formatMonth} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function RestorationPipeline({ data, loading, onRefresh }: RestorationPipelineProps) {
  const { lastRefresh } = useDashboard();
  const [searchTerm, setSearchTerm] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedStage, setExpandedStage] = useState<PipelineStage | null>(null);

  // Modal states
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showToRestoration, setShowToRestoration] = useState(false);
  const [showFromRestoration, setShowFromRestoration] = useState(false);

  // Group restorations by visual pipeline stage
  const groupedRestorations = useMemo(() => {
    if (!data?.restorations) return {};

    // First, group by database status for non-pipeline statuses
    const byStatus: Record<string, RestorationRecord[]> = {};
    for (const r of data.restorations) {
      if (!byStatus[r.status]) {
        byStatus[r.status] = [];
      }
      byStatus[r.status].push(r);
    }

    // Then, create visual stage groups by combining statuses
    const groups: Record<string, RestorationRecord[]> = {};

    // Map pipeline stages
    for (const stage of PIPELINE_STAGES) {
      const statuses = STAGE_STATUS_MAP[stage];
      const items: RestorationRecord[] = [];
      for (const status of statuses) {
        if (byStatus[status]) {
          items.push(...byStatus[status]);
        }
      }
      // Sort by: delivered items first (need action), then by days_in_status
      items.sort((a, b) => {
        const aDelivered = a.status === "delivered_warehouse" || a.return_tracking_status === "Delivered";
        const bDelivered = b.status === "delivered_warehouse" || b.return_tracking_status === "Delivered";
        if (aDelivered && !bDelivered) return -1;
        if (!aDelivered && bDelivered) return 1;
        return b.days_in_status - a.days_in_status;
      });
      groups[stage] = items;
    }

    // Also keep non-pipeline statuses for other sections
    groups["pending_label"] = byStatus["pending_label"] || [];
    groups["label_sent"] = byStatus["label_sent"] || [];
    groups["shipped"] = byStatus["shipped"] || [];
    groups["delivered"] = byStatus["delivered"] || [];
    groups["cancelled"] = byStatus["cancelled"] || [];

    return groups;
  }, [data?.restorations]);

  // Filter by search term
  const filteredGroups = useMemo(() => {
    if (!searchTerm) return groupedRestorations;

    const term = searchTerm.toLowerCase();
    const filtered: Record<string, RestorationRecord[]> = {};

    for (const [status, items] of Object.entries(groupedRestorations)) {
      const matches = items.filter(
        (r) =>
          r.order_name?.toLowerCase().includes(term) ||
          r.rma_number?.toLowerCase().includes(term) ||
          r.magnet_number?.toLowerCase().includes(term) ||
          r.return_tracking_number?.toLowerCase().includes(term)
      );
      if (matches.length > 0) {
        filtered[status] = matches;
      }
    }

    return filtered;
  }, [groupedRestorations, searchTerm]);

  // Loading skeleton
  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-24 bg-bg-secondary rounded-lg" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-bg-secondary rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-64 bg-bg-secondary rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const stats = data?.stats;

  // Items awaiting customer action (not in our pipeline yet)
  const awaitingCustomer = (filteredGroups["pending_label"]?.length || 0) +
    (filteredGroups["label_sent"]?.length || 0);

  // Calculate what needs action - items that are delivered need check-in
  const inboundItems = filteredGroups["inbound"] || [];
  const needsCheckIn = inboundItems.filter(
    r => r.status === "delivered_warehouse" || r.return_tracking_status === "Delivered"
  ).length;
  const needsToRestoration = filteredGroups["processing"]?.length || 0;
  const needsShipping = filteredGroups["outbound"]?.length || 0;
  const totalActionable = needsCheckIn + needsToRestoration + needsShipping;

  // Compute alerts from restorations data
  const restorations = data?.restorations || [];
  const alerts = useMemo(() => ({
    deliveredNotReceived: restorations.filter(
      r => r.status === "delivered_warehouse" && r.days_in_status > 2
    ).length,
    atRestorationTooLong: restorations.filter(
      r => r.status === "at_restoration" && r.days_in_status > 14
    ).length,
    timeoutCandidates: restorations.filter(
      r => r.total_days > 56 && !["shipped", "delivered", "cancelled"].includes(r.status)
    ).length,
  }), [restorations]);

  // Get cycle time trend direction
  const monthlyData = stats?.monthlyVolume || [];
  const recentMonths = monthlyData.slice(0, 3);
  const olderMonths = monthlyData.slice(3, 6);
  const recentCompleted = recentMonths.reduce((sum, m) => sum + m.completed, 0);
  const olderCompleted = olderMonths.reduce((sum, m) => sum + m.completed, 0);
  const throughputTrend = recentCompleted > olderCompleted ? "up" : recentCompleted < olderCompleted ? "down" : "flat";

  return (
    <div className="space-y-6">
      {/* ============================================================ */}
      {/* HEADER - Title + Freshness + Actions */}
      {/* ============================================================ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-text-primary uppercase tracking-wider">
              Restoration Pipeline
            </h1>
            <StaleTimestamp date={lastRefresh} prefix="Updated" />
          </div>
          <p className="text-sm text-text-secondary mt-1">
            {stats?.current?.activeQueue || 0} active items • {totalActionable > 0 ? (
              <span className="text-amber-400 font-medium">{totalActionable} need action</span>
            ) : (
              <span className="text-emerald-400">All caught up</span>
            )}
            {awaitingCustomer > 0 && (
              <span className="text-text-tertiary ml-2">
                • {awaitingCustomer} awaiting customer
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search order, RMA..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 text-sm bg-bg-secondary border border-border rounded-lg
                text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-blue
                w-40 sm:w-56"
            />
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
      {/* ACTION BANNER - Most important thing to do */}
      {/* ============================================================ */}
      {totalActionable > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">
                  Actions Needed Today
                </h3>
                <p className="text-text-secondary text-sm mt-0.5">
                  {needsCheckIn > 0 && <span className="text-sky-400">{needsCheckIn} delivered, need check-in</span>}
                  {needsCheckIn > 0 && needsToRestoration > 0 && " • "}
                  {needsToRestoration > 0 && <span className="text-emerald-400">{needsToRestoration} processing, ready to send out</span>}
                  {(needsCheckIn > 0 || needsToRestoration > 0) && needsShipping > 0 && " • "}
                  {needsShipping > 0 && <span className="text-blue-400">{needsShipping} ready to ship</span>}
                </p>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2">
              {needsCheckIn > 0 && (
                <button
                  onClick={() => setShowCheckIn(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider
                    bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Check In
                </button>
              )}
              {needsToRestoration > 0 && (
                <button
                  onClick={() => setShowToRestoration(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider
                    bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  Send to Restoration
                </button>
              )}
              {needsShipping > 0 && (
                <button
                  onClick={() => setShowFromRestoration(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider
                    bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  Mark Ready
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* KPI CARDS - Key Metrics with Trends */}
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
              <span className="text-3xl font-bold text-text-primary">{stats.current?.activeQueue || 0}</span>
              <span className="text-sm text-text-tertiary">items</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
              <span>{stats.current?.preWarehouse || 0} pre-warehouse</span>
              <span className="text-text-tertiary">•</span>
              <span>{stats.current?.inHouse || 0} in-house</span>
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
              <span className="text-3xl font-bold text-text-primary">
                {stats.period?.medianCycleTime || "—"}
              </span>
              <span className="text-sm text-text-tertiary">days</span>
              {stats.period?.medianCycleTime && stats.period.medianCycleTime <= 21 ? (
                <span className="text-emerald-400 text-xs ml-1">On target</span>
              ) : (
                <span className="text-amber-400 text-xs ml-1">Above 21d goal</span>
              )}
            </div>
            <div className="mt-2 text-xs text-text-secondary">
              D2C: {stats.period?.d2cInternalMedian || "—"}d • POS: {stats.period?.posInternalMedian || "—"}d
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
              <span className={`text-3xl font-bold ${
                (stats.period?.slaRate || 0) >= 80 ? "text-emerald-400" :
                (stats.period?.slaRate || 0) >= 60 ? "text-amber-400" : "text-red-400"
              }`}>
                {stats.period?.slaRate || 0}%
              </span>
              <span className="text-sm text-text-tertiary">≤21 days</span>
            </div>
            <div className="mt-2 text-xs text-text-secondary">
              {stats.period?.meetingSLA || 0} of {stats.period?.completed || 0} meet goal
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
                <span className="text-3xl font-bold text-text-primary">
                  {stats.period?.completed || 0}
                </span>
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
      {/* YOUR CYCLE TIME - The part you control */}
      {/* ============================================================ */}
      {stats && stats.period?.internalCycle && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Internal Cycle Breakdown - 2 cols wide */}
          <div className="lg:col-span-2 bg-bg-secondary rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-4">
              <Timer className="w-4 h-4 text-text-tertiary" />
              <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                Your Cycle Time (Received → Shipped)
              </h3>
            </div>
            <InternalCycleBreakdown
              internalCycle={stats.period.internalCycle}
              internalCycleTrend={stats.internalCycleTrend}
            />
          </div>

          {/* All-Time Summary - 1 col */}
          <div className="bg-bg-secondary rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-4">
              <Award className="w-4 h-4 text-text-tertiary" />
              <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                All-Time Performance
              </h3>
            </div>
            <div className="space-y-4">
              {/* Total Processed */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary uppercase tracking-wider">Total Processed</span>
                  <span className="text-xl font-bold text-text-primary">
                    {stats.allTime?.totalProcessed?.toLocaleString() || 0}
                  </span>
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {stats.allTime?.completedCount?.toLocaleString() || 0} completed • {stats.allTime?.cancelledCount || 0} cancelled
                </div>
              </div>

              {/* Completion Rate */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary uppercase tracking-wider">Completion Rate</span>
                  <span className={`text-xl font-bold ${
                    (stats.allTime?.completionRate || 0) >= 90 ? "text-emerald-400" :
                    (stats.allTime?.completionRate || 0) >= 70 ? "text-amber-400" : "text-red-400"
                  }`}>
                    {stats.allTime?.completionRate || 0}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${stats.allTime?.completionRate || 0}%` }}
                  />
                </div>
              </div>

              {/* Avg Cycle Time */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary uppercase tracking-wider">Avg Cycle Time</span>
                  <span className="text-xl font-bold text-text-primary">
                    {stats.allTime?.avgCycleTime || "—"} <span className="text-sm font-normal text-text-tertiary">days</span>
                  </span>
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {(stats.allTime?.avgCycleTime || 0) <= 21 ? (
                    <span className="text-emerald-400">✓ Within 21-day target</span>
                  ) : (
                    <span className="text-amber-400">Above 21-day target</span>
                  )}
                </div>
              </div>

              {/* Oldest Active */}
              {stats.allTime?.oldestActiveDate && (
                <div className="pt-3 border-t border-border/50">
                  <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    <Calendar className="w-3 h-3" />
                    Oldest active: {new Date(stats.allTime.oldestActiveDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ALERT BADGES - Issues needing attention */}
      {/* ============================================================ */}
      {(alerts.deliveredNotReceived > 0 || alerts.atRestorationTooLong > 0 || alerts.timeoutCandidates > 0) && (
        <div className="flex flex-wrap gap-2">
          {alerts.deliveredNotReceived > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 border border-orange-500/30 rounded-full text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-orange-400">
                {alerts.deliveredNotReceived} delivered &gt;2d, not checked in
              </span>
            </div>
          )}
          {alerts.atRestorationTooLong > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded-full text-xs">
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-purple-400">
                {alerts.atRestorationTooLong} at restoration &gt;14d
              </span>
            </div>
          )}
          {alerts.timeoutCandidates > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-full text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-400">
                {alerts.timeoutCandidates} over 8 weeks
              </span>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* PIPELINE COLUMNS - Active Work */}
      {/* ============================================================ */}
      <div>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Pipeline
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PIPELINE_STAGES.map((stage) => {
            const config = STAGE_CONFIG[stage];
            const items = filteredGroups[stage] || [];
            const Icon = config.icon;
            const isExpanded = expandedStage === stage;
            // For inbound, check if any delivered items are sitting too long
            const hasAlert = stage === "inbound"
              ? items.some(item =>
                  (item.status === "delivered_warehouse" || item.return_tracking_status === "Delivered") &&
                  item.days_in_status > config.alertThreshold
                )
              : items.some(item => item.days_in_status > config.alertThreshold);

            return (
              <div
                key={stage}
                className={`rounded-lg border ${config.bgColor} overflow-hidden ${
                  items.length > 0 && stage === "processing" ? "ring-2 ring-emerald-500/50" : ""
                }`}
              >
                {/* Column Header */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5"
                  onClick={() => setExpandedStage(isExpanded ? null : stage)}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${config.color}`} />
                    <span className={`text-sm font-semibold uppercase tracking-wider ${config.color}`}>
                      {config.label}
                    </span>
                    {hasAlert && (
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-bold ${config.color}`}>
                      {items.length}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-tertiary" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-tertiary" />
                    )}
                  </div>
                </div>

                {/* Items List */}
                <div className={`${isExpanded ? "max-h-[500px]" : "max-h-48"} overflow-y-auto scrollbar-thin transition-all`}>
                  {items.length === 0 ? (
                    <div className="p-4 text-center">
                      <div className="text-text-tertiary text-sm">Empty</div>
                      <div className="text-text-muted text-xs mt-1">No items at this stage</div>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/20">
                      {items.map((item) => {
                        // For inbound stage, mark items that are delivered and need check-in
                        const needsAction = stage === "inbound" &&
                          (item.status === "delivered_warehouse" || item.return_tracking_status === "Delivered");
                        return (
                          <RestorationCard
                            key={item.id}
                            item={item}
                            alertThreshold={config.alertThreshold}
                            needsAction={needsAction}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Action hint for actionable stages */}
                {config.actionLabel && items.length > 0 && (
                  <div className="px-3 py-2 bg-white/5 border-t border-border/20">
                    <span className="text-[10px] text-text-tertiary uppercase tracking-wider">
                      {items.length} ready → {config.actionLabel}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ============================================================ */}
      {/* COMPLETED - Collapsible */}
      {/* ============================================================ */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setShowCompleted(!showCompleted)}
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors w-full"
        >
          {showCompleted ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          <span className="font-semibold uppercase tracking-wider">Completed</span>
          <span className="text-emerald-400">
            ({(filteredGroups["shipped"]?.length || 0) + (filteredGroups["delivered"]?.length || 0)} shipped/delivered)
          </span>
        </button>

        {showCompleted && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Shipped */}
            <div className="rounded-lg border bg-cyan-500/10 border-cyan-500/30 overflow-hidden">
              <div className="flex items-center justify-between p-3 bg-cyan-500/5">
                <span className="text-sm font-semibold uppercase tracking-wider text-cyan-400">
                  Shipped
                </span>
                <span className="text-lg font-bold text-cyan-400">
                  {filteredGroups["shipped"]?.length || 0}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto scrollbar-thin">
                {(filteredGroups["shipped"] || []).slice(0, 10).map((item) => (
                  <RestorationCard key={item.id} item={item} compact />
                ))}
              </div>
            </div>

            {/* Delivered */}
            <div className="rounded-lg border bg-green-500/10 border-green-500/30 overflow-hidden">
              <div className="flex items-center justify-between p-3 bg-green-500/5">
                <span className="text-sm font-semibold uppercase tracking-wider text-green-400">
                  Delivered to Customer
                </span>
                <span className="text-lg font-bold text-green-400">
                  {filteredGroups["delivered"]?.length || 0}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto scrollbar-thin">
                {(filteredGroups["delivered"] || []).slice(0, 10).map((item) => (
                  <RestorationCard key={item.id} item={item} compact />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* MODALS */}
      {/* ============================================================ */}
      <RestorationCheckIn
        isOpen={showCheckIn}
        onClose={() => setShowCheckIn(false)}
        onSuccess={() => {
          setShowCheckIn(false);
          onRefresh();
        }}
        restorations={data?.restorations || []}
      />

      <RestorationHandoff
        isOpen={showToRestoration}
        onClose={() => setShowToRestoration(false)}
        onSuccess={() => {
          setShowToRestoration(false);
          onRefresh();
        }}
        restorations={data?.restorations || []}
        handoffType="to_restoration"
      />

      <RestorationHandoff
        isOpen={showFromRestoration}
        onClose={() => setShowFromRestoration(false)}
        onSuccess={() => {
          setShowFromRestoration(false);
          onRefresh();
        }}
        restorations={data?.restorations || []}
        handoffType="from_restoration"
      />
    </div>
  );
}

// ============================================================================
// RESTORATION CARD COMPONENT
// ============================================================================

interface RestorationCardProps {
  item: RestorationRecord;
  alertThreshold?: number;
  compact?: boolean;
  needsAction?: boolean; // Pulsing indicator for delivered items needing check-in
}

function RestorationCard({ item, alertThreshold, compact, needsAction }: RestorationCardProps) {
  const isOverdue = alertThreshold && item.days_in_status > alertThreshold;

  if (compact) {
    return (
      <div className="px-3 py-2 hover:bg-white/5 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-primary font-medium truncate">
            {item.order_name || item.rma_number || `#${item.id}`}
          </span>
          <span className="text-xs text-text-tertiary ml-2 flex-shrink-0">
            {item.days_in_status}d
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`px-3 py-3 hover:bg-white/5 transition-colors relative ${
        needsAction
          ? "border-l-2 border-l-amber-500 bg-amber-500/5"
          : isOverdue
            ? "border-l-2 border-l-orange-500"
            : ""
      }`}
    >
      {/* Pulsing "needs action" badge */}
      {needsAction && (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/20 rounded text-[10px] text-amber-400 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
          Check In
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Order Name - Links to Shopify Admin */}
          <div className="flex items-center gap-2">
            {item.shopify_order_id ? (
              <a
                href={`https://admin.shopify.com/store/smithey-iron-ware/orders/${item.shopify_order_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-blue hover:underline font-medium truncate flex items-center gap-1"
              >
                {item.order_name || item.rma_number || `Restoration #${item.id}`}
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            ) : (
              <span className="text-sm text-text-primary font-medium truncate">
                {item.order_name || item.rma_number || `Restoration #${item.id}`}
              </span>
            )}
            {item.is_pos && (
              <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded flex-shrink-0">
                POS
              </span>
            )}
          </div>

          {/* Magnet / Tracking */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {item.magnet_number && (
              <span className="text-xs text-text-secondary">
                Magnet: {item.magnet_number}
              </span>
            )}
            {item.return_tracking_number && (
              <a
                href={`https://track.aftership.com/${item.return_tracking_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-blue hover:underline flex items-center gap-1"
              >
                {item.return_tracking_number.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Days Badge */}
        <div
          className={`flex-shrink-0 px-2 py-1 rounded text-xs font-medium ${
            isOverdue
              ? "bg-orange-500/20 text-orange-400"
              : "bg-bg-secondary text-text-secondary"
          }`}
        >
          {item.days_in_status}d
        </div>
      </div>

      {/* Total days if significantly different */}
      {item.total_days > item.days_in_status + 7 && (
        <div className="mt-1 text-[10px] text-text-tertiary">
          Total: {item.total_days}d since order
        </div>
      )}
    </div>
  );
}
