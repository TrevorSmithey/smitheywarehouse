"use client";

import { useState, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  RefreshCw,
  Mail,
  Zap,
  ChevronDown,
  ChevronUp,
  Users,
  MousePointerClick,
  Eye,
  ShoppingCart,
  ArrowUpRight,
  BarChart3,
  Sparkles,
} from "lucide-react";
import {
  AreaChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Line,
} from "recharts";
import type {
  KlaviyoResponse,
  KlaviyoCampaignSummary,
  KlaviyoMonthlySummary,
} from "@/lib/types";

type KlaviyoPeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d";
type SortField = "date" | "revenue" | "recipients" | "open_rate" | "click_rate" | "conversions";
type SortDirection = "asc" | "desc";

interface KlaviyoDashboardProps {
  data: KlaviyoResponse | null;
  loading: boolean;
  period: KlaviyoPeriod;
  onPeriodChange: (period: KlaviyoPeriod) => void;
  onRefresh: () => void;
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatCurrencyFull(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toLocaleString();
}

function formatNumberFull(n: number): string {
  return n.toLocaleString();
}

function formatPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(0)}%`;
}

function formatRate(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function formatRatePct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

// ============================================================================
// PERIOD LABELS
// ============================================================================

function getPeriodLabel(period: KlaviyoPeriod): string {
  switch (period) {
    case "mtd": return "Month to Date";
    case "last_month": return "Last Month";
    case "qtd": return "Quarter to Date";
    case "ytd": return "Year to Date";
    case "30d": return "Last 30 Days";
    case "90d": return "Last 90 Days";
  }
}

// ============================================================================
// BREAKDOWN CARD
// ============================================================================

function BreakdownCard({
  label,
  value,
  subValue,
  icon: Icon,
  color = "blue",
  percentage,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: "blue" | "green" | "amber" | "purple";
  percentage?: number;
}) {
  const colorMap = {
    blue: { text: "text-accent-blue", bg: "bg-accent-blue", bgFaint: "bg-accent-blue/10" },
    green: { text: "text-status-good", bg: "bg-status-good", bgFaint: "bg-status-good/10" },
    amber: { text: "text-status-warning", bg: "bg-status-warning", bgFaint: "bg-status-warning/10" },
    purple: { text: "text-purple-400", bg: "bg-purple-400", bgFaint: "bg-purple-400/10" },
  };
  const colors = colorMap[color];

  return (
    <div className="relative overflow-hidden bg-bg-secondary rounded-xl border border-border/30 p-5">
      {/* Subtle percentage bar at bottom */}
      {percentage !== undefined && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border/20">
          <div
            className={`h-full ${colors.bg} transition-all duration-500`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}

      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2">
            {label}
          </div>
          <div className="text-2xl font-semibold tracking-tight text-text-primary tabular-nums">
            {value}
          </div>
          {subValue && (
            <div className="text-xs text-text-tertiary mt-1">
              {subValue}
            </div>
          )}
        </div>
        <div className={`p-2.5 rounded-lg ${colors.bgFaint}`}>
          <Icon className={`w-4 h-4 ${colors.text}`} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// INLINE METRIC
// ============================================================================

function InlineMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-tertiary/40 rounded-lg border border-border/10">
      <Icon className="w-4 h-4 text-text-tertiary" />
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-text-primary tabular-nums">{value}</span>
        <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      </div>
    </div>
  );
}

// ============================================================================
// CAMPAIGN TABLE ROW
// ============================================================================

function CampaignRow({ campaign, rank }: { campaign: KlaviyoCampaignSummary; rank: number }) {
  const revenuePerRecipient = campaign.recipients > 0
    ? campaign.conversion_value / campaign.recipients
    : 0;

  // Visual indicator for top performers
  const isTopPerformer = rank <= 3;
  const rankColors = {
    1: "bg-status-good text-bg-primary",
    2: "bg-status-good/60 text-bg-primary",
    3: "bg-status-good/30 text-status-good",
  };

  return (
    <tr className="group border-b border-border/10 hover:bg-white/[0.02] transition-colors">
      {/* Rank */}
      <td className="py-3.5 pl-4 pr-2 w-10">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold tabular-nums ${
          isTopPerformer
            ? rankColors[rank as 1 | 2 | 3]
            : "text-text-muted"
        }`}>
          {rank}
        </span>
      </td>

      {/* Campaign Name + Date */}
      <td className="py-3.5 px-3">
        <div className="max-w-[300px]">
          <div className="text-sm text-text-primary truncate group-hover:text-accent-blue transition-colors font-medium">
            {campaign.name}
          </div>
          <div className="text-[10px] text-text-muted mt-0.5 tracking-wide">
            {format(new Date(campaign.send_time), "MMM d, yyyy • h:mm a")}
          </div>
        </div>
      </td>

      {/* Revenue */}
      <td className="py-3.5 px-3 text-right">
        <div className="text-sm font-semibold text-status-good tabular-nums">
          {formatCurrencyFull(campaign.conversion_value)}
        </div>
        <div className="text-[10px] text-text-muted tabular-nums">
          ${revenuePerRecipient.toFixed(2)}/rcpt
        </div>
      </td>

      {/* Recipients */}
      <td className="py-3.5 px-3 text-right">
        <div className="text-sm text-text-primary tabular-nums">
          {formatNumberFull(campaign.recipients)}
        </div>
      </td>

      {/* Open Rate */}
      <td className="py-3.5 px-3 text-right">
        <div className={`text-sm tabular-nums font-medium ${
          (campaign.open_rate || 0) >= 0.5 ? "text-status-good" :
          (campaign.open_rate || 0) >= 0.35 ? "text-text-primary" :
          "text-status-warning"
        }`}>
          {formatRate(campaign.open_rate)}
        </div>
      </td>

      {/* Click Rate */}
      <td className="py-3.5 px-3 text-right">
        <div className={`text-sm tabular-nums font-medium ${
          (campaign.click_rate || 0) >= 0.02 ? "text-status-good" :
          (campaign.click_rate || 0) >= 0.01 ? "text-text-primary" :
          "text-status-warning"
        }`}>
          {formatRate(campaign.click_rate)}
        </div>
      </td>

      {/* Conversions */}
      <td className="py-3.5 pl-3 pr-4 text-right">
        <div className="text-sm text-text-primary tabular-nums font-semibold">
          {campaign.conversions}
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// SORTABLE TABLE HEADER
// ============================================================================

function SortableHeader({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  align = "right",
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
}) {
  const isActive = currentSort === field;

  return (
    <th
      className={`py-3 px-3 text-${align} cursor-pointer select-none group`}
      onClick={() => onSort(field)}
    >
      <div className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${
        isActive ? "text-accent-blue" : "text-text-muted group-hover:text-text-secondary"
      } transition-colors`}>
        {label}
        <span className={`transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}>
          {currentDirection === "desc" ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronUp className="w-3 h-3" />
          )}
        </span>
      </div>
    </th>
  );
}

// ============================================================================
// MONTHLY REVENUE TREND CHART
// ============================================================================

interface MonthlyChartData {
  month: string;
  displayMonth: string;
  shortMonth: string;
  campaignRevenue: number;
  flowRevenue: number;
  totalRevenue: number;
  yoyRevenue?: number;
  yoyChange?: number;
}

function MonthlyRevenueTrend({ monthly }: { monthly: KlaviyoMonthlySummary[] }) {
  const chartData: MonthlyChartData[] = useMemo(() => {
    if (!monthly || monthly.length === 0) return [];

    const sorted = [...monthly].sort((a, b) =>
      new Date(a.month_start).getTime() - new Date(b.month_start).getTime()
    );

    const recent = sorted.slice(-12);

    return recent.map(m => {
      const date = new Date(m.month_start);
      const campaignRev = m.email_revenue || 0;
      const flowRev = m.flow_revenue || 0;

      const lastYear = new Date(date);
      lastYear.setFullYear(lastYear.getFullYear() - 1);
      const yoyMonth = sorted.find(prev => {
        const prevDate = new Date(prev.month_start);
        return prevDate.getMonth() === lastYear.getMonth() &&
               prevDate.getFullYear() === lastYear.getFullYear();
      });

      const yoyRevenue = yoyMonth ? (yoyMonth.email_revenue || 0) + (yoyMonth.flow_revenue || 0) : undefined;
      const totalRev = campaignRev + flowRev;
      const yoyChange = yoyRevenue && yoyRevenue > 0
        ? ((totalRev - yoyRevenue) / yoyRevenue) * 100
        : undefined;

      return {
        month: m.month_start,
        displayMonth: format(date, "MMM ''yy"),
        shortMonth: format(date, "MMM"),
        campaignRevenue: campaignRev,
        flowRevenue: flowRev,
        totalRevenue: totalRev,
        yoyRevenue,
        yoyChange,
      };
    });
  }, [monthly]);

  if (chartData.length < 2) return null;

  // Calculate stats
  const avgRevenue = chartData.reduce((sum, d) => sum + d.totalRevenue, 0) / chartData.length;
  const maxRevenue = Math.max(...chartData.map(d => d.totalRevenue));
  const latestMonth = chartData[chartData.length - 1];
  const latestYoY = latestMonth?.yoyChange;

  // Custom tooltip with YoY prominently displayed
  const CustomTooltip = ({ active, payload }: {
    active?: boolean;
    payload?: Array<{ payload: MonthlyChartData }>
  }) => {
    if (!active || !payload || !payload.length) return null;
    const item = payload[0].payload;

    return (
      <div className="bg-bg-primary/95 backdrop-blur border border-border rounded-xl p-4 shadow-xl min-w-[200px]">
        <div className="flex items-center justify-between gap-4 mb-3 pb-2 border-b border-border/30">
          <span className="text-sm font-semibold text-text-primary">
            {format(new Date(item.month), "MMMM yyyy")}
          </span>
          {item.yoyChange !== undefined && (
            <span className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded ${
              item.yoyChange >= 0
                ? "bg-status-good/20 text-status-good"
                : "bg-status-bad/20 text-status-bad"
            }`}>
              {item.yoyChange >= 0 ? "+" : ""}{item.yoyChange.toFixed(0)}% YoY
            </span>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-status-good" />
              <span className="text-xs text-text-secondary">Campaigns</span>
            </div>
            <span className="text-sm font-semibold text-text-primary tabular-nums">
              {formatCurrency(item.campaignRevenue)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-status-warning" />
              <span className="text-xs text-text-secondary">Flows</span>
            </div>
            <span className="text-sm font-semibold text-text-primary tabular-nums">
              {formatCurrency(item.flowRevenue)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-6 pt-2 border-t border-border/20">
            <span className="text-xs font-medium text-text-secondary">Total</span>
            <span className="text-base font-bold text-text-primary tabular-nums">
              {formatCurrency(item.totalRevenue)}
            </span>
          </div>

          {item.yoyRevenue !== undefined && (
            <div className="flex items-center justify-between gap-6 text-text-muted">
              <span className="text-[10px]">Same month last year</span>
              <span className="text-[10px] tabular-nums">
                {formatCurrency(item.yoyRevenue)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
      {/* Header with current month's YoY prominently displayed */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="w-4 h-4 text-text-tertiary" />
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
              MONTHLY EMAIL REVENUE
            </h3>
          </div>
          <p className="text-xs text-text-muted">
            Campaign + Flow revenue trend
          </p>
        </div>

        <div className="flex items-center gap-6">
          {/* Current YoY Change - Make this prominent */}
          {latestYoY !== undefined && (
            <div className="text-right">
              <div className={`text-2xl font-bold tabular-nums ${
                latestYoY >= 0 ? "text-status-good" : "text-status-bad"
              }`}>
                {latestYoY >= 0 ? "+" : ""}{latestYoY.toFixed(0)}%
              </div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider">YoY Change</p>
            </div>
          )}

          {/* Average */}
          <div className="text-right border-l border-border/30 pl-6">
            <div className="text-xl font-semibold text-text-primary tabular-nums">
              {formatCurrency(avgRevenue)}
            </div>
            <p className="text-[10px] text-text-muted uppercase tracking-wider">Avg/Month</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="campaignGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0.3} />
              </linearGradient>
              <linearGradient id="flowGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.3} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="shortMonth"
              tick={{ fill: "#64748B", fontSize: 10, fontWeight: 500 }}
              axisLine={{ stroke: "#1E293B" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#64748B", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={55}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <ReferenceLine
              y={avgRevenue}
              stroke="#64748B"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
            />

            <Bar dataKey="campaignRevenue" stackId="revenue" fill="url(#campaignGradient)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="flowRevenue" stackId="revenue" fill="url(#flowGradient)" radius={[3, 3, 0, 0]} />

            {/* YoY comparison line (if available) */}
            <Line
              type="monotone"
              dataKey="yoyRevenue"
              stroke="#94A3B8"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-6 mt-4 pt-4 border-t border-border/20">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-status-good" />
          <span className="text-[10px] text-text-tertiary font-medium">Campaigns</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-status-warning" />
          <span className="text-[10px] text-text-tertiary font-medium">Flows</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0 border-t-2 border-dashed border-text-tertiary" />
          <span className="text-[10px] text-text-tertiary font-medium">Last Year</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0 border-t border-dashed border-text-tertiary opacity-50" />
          <span className="text-[10px] text-text-tertiary font-medium">Average</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SUBSCRIBER GROWTH CHART
// ============================================================================

interface SubscriberChartData {
  month: string;
  displayMonth: string;
  active120Day: number | null;
  engaged365Day: number | null;
}

function SubscriberGrowthChart({ monthly }: { monthly: KlaviyoMonthlySummary[] }) {
  const chartData: SubscriberChartData[] = useMemo(() => {
    if (!monthly || monthly.length === 0) return [];

    // Sort chronologically
    const sorted = [...monthly].sort((a, b) =>
      new Date(a.month_start).getTime() - new Date(b.month_start).getTime()
    );

    // Filter to only months with subscriber data and take last 12
    const withData = sorted.filter(m =>
      m.subscribers_120day !== null || m.subscribers_365day !== null
    ).slice(-12);

    return withData.map(m => ({
      month: m.month_start,
      displayMonth: format(new Date(m.month_start), "MMM ''yy"),
      active120Day: m.subscribers_120day,
      engaged365Day: m.subscribers_365day,
    }));
  }, [monthly]);

  // Need at least 1 data point to show anything useful
  if (chartData.length < 1) {
    return null;
  }

  // If only 1 data point, show a simple card instead of a chart
  if (chartData.length === 1) {
    const current = chartData[0];
    return (
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-text-tertiary" />
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            SUBSCRIBER COUNTS
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-2xl font-semibold text-purple-400 tabular-nums">
              {formatNumber(current.engaged365Day || 0)}
            </div>
            <div className="text-xs text-text-muted mt-1">365-day engaged</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-accent-blue tabular-nums">
              {formatNumber(current.active120Day || 0)}
            </div>
            <div className="text-xs text-text-muted mt-1">120-day active</div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border/20 text-center">
          <p className="text-[10px] text-text-muted">
            Growth chart will appear as data accumulates monthly
          </p>
        </div>
      </div>
    );
  }

  // Full chart with 2+ data points
  const latest = chartData[chartData.length - 1];
  const previous = chartData.length > 1 ? chartData[chartData.length - 2] : null;

  // Calculate growth
  const growth365 = previous && previous.engaged365Day && latest.engaged365Day
    ? ((latest.engaged365Day - previous.engaged365Day) / previous.engaged365Day) * 100
    : undefined;
  const growth120 = previous && previous.active120Day && latest.active120Day
    ? ((latest.active120Day - previous.active120Day) / previous.active120Day) * 100
    : undefined;

  const CustomTooltip = ({ active, payload }: {
    active?: boolean;
    payload?: Array<{ payload: SubscriberChartData }>
  }) => {
    if (!active || !payload || !payload.length) return null;
    const item = payload[0].payload;

    return (
      <div className="bg-bg-primary/95 backdrop-blur border border-border rounded-xl p-4 shadow-xl min-w-[180px]">
        <div className="text-sm font-semibold text-text-primary mb-3 pb-2 border-b border-border/30">
          {format(new Date(item.month), "MMMM yyyy")}
        </div>
        <div className="space-y-2">
          {item.engaged365Day !== null && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-purple-400" />
                <span className="text-xs text-text-secondary">365-day</span>
              </div>
              <span className="text-sm font-semibold text-text-primary tabular-nums">
                {formatNumberFull(item.engaged365Day)}
              </span>
            </div>
          )}
          {item.active120Day !== null && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm bg-accent-blue" />
                <span className="text-xs text-text-secondary">120-day</span>
              </div>
              <span className="text-sm font-semibold text-text-primary tabular-nums">
                {formatNumberFull(item.active120Day)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-text-tertiary" />
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
              SUBSCRIBER GROWTH
            </h3>
          </div>
          <p className="text-xs text-text-muted">
            List size over time
          </p>
        </div>

        {/* Growth indicators */}
        <div className="flex items-center gap-6">
          {growth365 !== undefined && (
            <div className="text-right">
              <div className={`text-lg font-bold tabular-nums ${
                growth365 >= 0 ? "text-status-good" : "text-status-bad"
              }`}>
                {growth365 >= 0 ? "+" : ""}{growth365.toFixed(1)}%
              </div>
              <p className="text-[10px] text-text-muted">365-day growth</p>
            </div>
          )}
          {growth120 !== undefined && (
            <div className="text-right border-l border-border/30 pl-6">
              <div className={`text-lg font-bold tabular-nums ${
                growth120 >= 0 ? "text-status-good" : "text-status-bad"
              }`}>
                {growth120 >= 0 ? "+" : ""}{growth120.toFixed(1)}%
              </div>
              <p className="text-[10px] text-text-muted">120-day growth</p>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="engaged365Gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A855F7" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#A855F7" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="active120Gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0EA5E9" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="displayMonth"
              tick={{ fill: "#64748B", fontSize: 10, fontWeight: 500 }}
              axisLine={{ stroke: "#1E293B" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#64748B", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={55}
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />

            <Area
              type="monotone"
              dataKey="engaged365Day"
              stroke="#A855F7"
              strokeWidth={2}
              fill="url(#engaged365Gradient)"
              dot={{ r: 3, fill: "#A855F7", strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "#A855F7", stroke: "#0B0E1A", strokeWidth: 2 }}
              connectNulls
            />
            <Area
              type="monotone"
              dataKey="active120Day"
              stroke="#0EA5E9"
              strokeWidth={2}
              fill="url(#active120Gradient)"
              dot={{ r: 3, fill: "#0EA5E9", strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "#0EA5E9", stroke: "#0B0E1A", strokeWidth: 2 }}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-6 mt-4 pt-4 border-t border-border/20">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-purple-400" />
          <span className="text-[10px] text-text-tertiary font-medium">365-day Engaged</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-accent-blue" />
          <span className="text-[10px] text-text-tertiary font-medium">120-day Active</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD
// ============================================================================

export function KlaviyoDashboard({
  data,
  loading,
  period,
  onPeriodChange,
  onRefresh,
}: KlaviyoDashboardProps) {
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const sortedCampaigns = useMemo(() => {
    const campaigns = [...(data?.campaigns || [])];

    campaigns.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "date":
          comparison = new Date(b.send_time).getTime() - new Date(a.send_time).getTime();
          break;
        case "revenue":
          comparison = b.conversion_value - a.conversion_value;
          break;
        case "recipients":
          comparison = b.recipients - a.recipients;
          break;
        case "open_rate":
          comparison = (b.open_rate || 0) - (a.open_rate || 0);
          break;
        case "click_rate":
          comparison = (b.click_rate || 0) - (a.click_rate || 0);
          break;
        case "conversions":
          comparison = b.conversions - a.conversions;
          break;
      }

      return sortDirection === "desc" ? comparison : -comparison;
    });

    return campaigns;
  }, [data?.campaigns, sortField, sortDirection]);

  const displayedCampaigns = showAllCampaigns ? sortedCampaigns : sortedCampaigns.slice(0, 10);

  const periodOptions = [
    { value: "mtd" as const, label: "MTD" },
    { value: "last_month" as const, label: "Last Month" },
    { value: "qtd" as const, label: "QTD" },
    { value: "ytd" as const, label: "YTD" },
    { value: "30d" as const, label: "30D" },
    { value: "90d" as const, label: "90D" },
  ];

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4 text-text-tertiary">
          <div className="relative">
            <Sparkles className="w-8 h-8 animate-pulse" />
          </div>
          <span className="text-sm">Loading email performance...</span>
        </div>
      </div>
    );
  }

  // No data state
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-6">
        <div className="p-6 rounded-full bg-bg-tertiary/50">
          <Mail className="w-12 h-12 text-text-muted" />
        </div>
        <div className="text-center">
          <p className="text-lg text-text-secondary mb-2">No email marketing data</p>
          <p className="text-xs text-text-muted">Data syncs daily at 1 AM EST</p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-all shadow-lg shadow-accent-blue/20"
        >
          <RefreshCw className="w-4 h-4" />
          Sync Now
        </button>
      </div>
    );
  }

  const { stats } = data;

  // Calculate totals
  const totalEmailRevenue = (stats.campaign_revenue || 0) + (stats.flow_revenue || 0);
  const campaignPct = totalEmailRevenue > 0
    ? ((stats.campaign_revenue || 0) / totalEmailRevenue) * 100
    : 0;
  const flowPct = totalEmailRevenue > 0
    ? ((stats.flow_revenue || 0) / totalEmailRevenue) * 100
    : 0;

  return (
    <div className="space-y-8">
      {/* ================================================================
          HEADER ROW
          ================================================================ */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-accent-blue" />
            <h2 className="text-[10px] uppercase tracking-[0.25em] text-text-muted font-semibold">
              EMAIL MARKETING
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-tertiary">{getPeriodLabel(period)}</span>
            {data.lastSynced && (
              <>
                <span className="text-text-muted">•</span>
                <span className="text-[10px] text-text-muted">
                  Updated {formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Period Toggle */}
          <div className="flex items-center bg-bg-tertiary rounded-lg p-0.5 border border-border/20">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => onPeriodChange(option.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  period === option.value
                    ? "bg-accent-blue text-white shadow-sm"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2.5 text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-50 rounded-lg hover:bg-white/5 border border-transparent hover:border-border/20"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ================================================================
          KPI CARDS (5 columns)
          ================================================================ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <BreakdownCard
          label="Total Email Revenue"
          value={formatCurrency(totalEmailRevenue)}
          subValue={`${stats.campaigns_sent || 0} campaigns`}
          icon={Mail}
          color="green"
        />

        <BreakdownCard
          label="Campaign Revenue"
          value={formatCurrency(stats.campaign_revenue || 0)}
          subValue={`${campaignPct.toFixed(0)}% of email`}
          icon={Mail}
          color="green"
          percentage={campaignPct}
        />

        <BreakdownCard
          label="Flow Revenue"
          value={formatCurrency(stats.flow_revenue || 0)}
          subValue={`${flowPct.toFixed(0)}% of email`}
          icon={Zap}
          color="amber"
          percentage={flowPct}
        />

        <BreakdownCard
          label="Email Subscribers"
          value={formatNumber(stats.subscribers_365day || 0)}
          subValue="365-day engaged"
          icon={Users}
          color="purple"
        />

        <BreakdownCard
          label="Email % of Revenue"
          value={(stats.email_pct_of_revenue || 0) > 0
            ? formatPct(stats.email_pct_of_revenue)
            : "—"
          }
          subValue={(stats.email_pct_of_revenue || 0) > 0
            ? "of total D2C revenue"
            : "Awaiting Shopify data"
          }
          icon={ArrowUpRight}
          color="blue"
        />
      </div>

      {/* ================================================================
          INLINE METRICS ROW
          ================================================================ */}
      <div className="flex flex-wrap items-center gap-3">
        <InlineMetric
          label="Avg Open Rate"
          value={formatRatePct(stats.avg_open_rate)}
          icon={Eye}
        />
        <InlineMetric
          label="Avg Click Rate"
          value={formatRate(stats.avg_click_rate)}
          icon={MousePointerClick}
        />
        <InlineMetric
          label="Total Orders"
          value={formatNumber(stats.total_conversions || 0)}
          icon={ShoppingCart}
        />
        <InlineMetric
          label="120-Day Active"
          value={formatNumber(stats.subscribers_120day || 0)}
          icon={Users}
        />
      </div>

      {/* ================================================================
          MONTHLY TREND CHART
          ================================================================ */}
      {data.monthly && data.monthly.length > 1 && (
        <MonthlyRevenueTrend monthly={data.monthly} />
      )}

      {/* ================================================================
          SUBSCRIBER GROWTH CHART
          ================================================================ */}
      {data.monthly && (
        <SubscriberGrowthChart monthly={data.monthly} />
      )}

      {/* ================================================================
          CAMPAIGN PERFORMANCE TABLE
          ================================================================ */}
      <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-text-tertiary" />
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-semibold">
                CAMPAIGN PERFORMANCE
              </h3>
            </div>
            <span className="text-[10px] text-text-muted">
              {sortedCampaigns.length} campaigns • sorted by {sortField.replace("_", " ")}
            </span>
          </div>

          {displayedCampaigns.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[750px]">
                  <thead>
                    <tr className="border-b border-border/20 bg-bg-tertiary/30">
                      <th className="py-3 pl-4 pr-2 w-10 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                        #
                      </th>
                      <SortableHeader
                        label="Campaign"
                        field="date"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                        align="left"
                      />
                      <SortableHeader
                        label="Revenue"
                        field="revenue"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Sent"
                        field="recipients"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Open"
                        field="open_rate"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Click"
                        field="click_rate"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Orders"
                        field="conversions"
                        currentSort={sortField}
                        currentDirection={sortDirection}
                        onSort={handleSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCampaigns.map((campaign, idx) => (
                      <CampaignRow
                        key={campaign.klaviyo_id}
                        campaign={campaign}
                        rank={idx + 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Show more/less button */}
              {sortedCampaigns.length > 10 && (
                <div className="px-4 py-3 border-t border-border/20 bg-bg-tertiary/20">
                  <button
                    onClick={() => setShowAllCampaigns(!showAllCampaigns)}
                    className="w-full py-2 text-sm text-accent-blue hover:text-accent-blue/80 flex items-center justify-center gap-1.5 transition-colors font-medium"
                  >
                    {showAllCampaigns ? (
                      <>
                        Show Top 10 <ChevronUp className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        Show All {sortedCampaigns.length} Campaigns <ChevronDown className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-56 text-text-muted">
              <Mail className="w-10 h-10 mb-3 opacity-40" />
              <span className="text-sm font-medium">No campaigns found</span>
              <span className="text-xs mt-1">Try a different time period</span>
            </div>
          )}
      </div>
    </div>
  );
}
