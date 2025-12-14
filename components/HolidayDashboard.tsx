"use client";

import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { RefreshCw, Calendar, TrendingUp, Package } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { HolidayResponse } from "@/lib/types";

interface HolidayDashboardProps {
  data: HolidayResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

// Holiday Dashboard Constants
const holidayColors = {
  current: "#10B981",    // Emerald - 2025
  baseline: "#F59E0B",   // Amber - 2024
};

const holidayFmt = {
  currency: (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  },
  number: (n: number) => n.toLocaleString(),
  delta: (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`,
};

function HolidayChartTooltip({ active, payload, label, prefix = "" }: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; stroke: string }>;
  label?: number;
  prefix?: string;
}) {
  if (!active || !payload?.length) return null;

  const val2025 = payload.find(p => p.dataKey.includes("2025"))?.value || 0;
  const val2024 = payload.find(p => p.dataKey.includes("2024"))?.value || 0;
  const delta = val2024 > 0 ? ((val2025 - val2024) / val2024) * 100 : 0;

  return (
    <div className="bg-bg-primary/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl p-4 min-w-[180px]">
      <div className="text-xs text-text-tertiary uppercase tracking-wider mb-3">Day {label}</div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: holidayColors.current }} />
            <span className="text-text-secondary text-sm">2025</span>
          </div>
          <span className="font-semibold text-text-primary tabular-nums">
            {prefix}{holidayFmt.number(Math.round(val2025))}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: holidayColors.baseline }} />
            <span className="text-text-secondary text-sm">2024</span>
          </div>
          <span className="font-medium text-text-tertiary tabular-nums">
            {prefix}{holidayFmt.number(Math.round(val2024))}
          </span>
        </div>
        {val2024 > 0 && val2025 > 0 && (
          <div className="pt-2 mt-2 border-t border-border/50">
            <div className={`text-sm font-semibold text-right ${delta >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {holidayFmt.delta(delta)} YoY
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function HolidayDashboard({ data, loading, onRefresh }: HolidayDashboardProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
          <span className="text-sm text-text-tertiary tracking-wide">Loading holiday data...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Calendar className="w-12 h-12 text-text-muted" />
        <span className="text-text-tertiary">No holiday data available</span>
        <button
          onClick={onRefresh}
          className="px-4 py-2 text-sm bg-bg-secondary hover:bg-bg-tertiary rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>
    );
  }

  const { summary } = data;
  const fmt = holidayFmt;
  const colors = holidayColors;

  // Transform ALL data for charts
  const chartData = data.data.map((d) => ({
    day: d.day_number,
    orders2024: d.orders_2024 || 0,
    orders2025: d.orders_2025,
    sales2024: d.sales_2024 || 0,
    sales2025: d.sales_2025,
    cumOrders2024: d.cumulative_orders_2024 || 0,
    cumOrders2025: d.cumulative_orders_2025,
    cumSales2024: d.cumulative_sales_2024 || 0,
    cumSales2025: d.cumulative_sales_2025,
  }));

  // Find current day
  const currentDay = data.data.filter(d => d.orders_2025 !== null).length;
  const progressPct = Math.round((currentDay / 92) * 100);

  // Determine current month
  const getMonthFromDay = (day: number) => {
    if (day <= 31) return "october";
    if (day <= 61) return "november";
    return "december";
  };
  const currentMonth = getMonthFromDay(currentDay);
  const monthStartDay = currentMonth === "october" ? 1 : currentMonth === "november" ? 32 : 62;
  const monthLabel = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);

  // Filter data for current month
  const monthData2025 = data.data.filter(d =>
    d.day_number >= monthStartDay && d.orders_2025 !== null
  );
  const monthData2024 = data.data.filter(d =>
    d.day_number >= monthStartDay && d.day_number < monthStartDay + monthData2025.length
  );

  // Calculate current month stats
  const monthStats = {
    orders2025: monthData2025.reduce((sum, d) => sum + (d.orders_2025 || 0), 0),
    orders2024: monthData2024.reduce((sum, d) => sum + (d.orders_2024 || 0), 0),
    revenue2025: monthData2025.reduce((sum, d) => sum + (d.sales_2025 || 0), 0),
    revenue2024: monthData2024.reduce((sum, d) => sum + (d.sales_2024 || 0), 0),
    daysTracked: monthData2025.length,
  };

  const monthMetrics = {
    avgDailyOrders2025: monthStats.daysTracked > 0 ? Math.round(monthStats.orders2025 / monthStats.daysTracked) : 0,
    avgDailyOrders2024: monthStats.daysTracked > 0 ? Math.round(monthStats.orders2024 / monthStats.daysTracked) : 0,
    avgDailyRevenue2025: monthStats.daysTracked > 0 ? monthStats.revenue2025 / monthStats.daysTracked : 0,
    avgDailyRevenue2024: monthStats.daysTracked > 0 ? monthStats.revenue2024 / monthStats.daysTracked : 0,
    aov2025: monthStats.orders2025 > 0 ? monthStats.revenue2025 / monthStats.orders2025 : 0,
    aov2024: monthStats.orders2024 > 0 ? monthStats.revenue2024 / monthStats.orders2024 : 0,
  };

  const monthDeltas = {
    avgDailyOrders: monthMetrics.avgDailyOrders2024 > 0
      ? ((monthMetrics.avgDailyOrders2025 - monthMetrics.avgDailyOrders2024) / monthMetrics.avgDailyOrders2024) * 100 : 0,
    avgDailyRevenue: monthMetrics.avgDailyRevenue2024 > 0
      ? ((monthMetrics.avgDailyRevenue2025 - monthMetrics.avgDailyRevenue2024) / monthMetrics.avgDailyRevenue2024) * 100 : 0,
    aov: monthMetrics.aov2024 > 0
      ? ((monthMetrics.aov2025 - monthMetrics.aov2024) / monthMetrics.aov2024) * 100 : 0,
  };

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <h2 className="text-label font-medium text-text-tertiary uppercase tracking-wider">Q4 2025</h2>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${
              summary.ordersGrowth >= 0 ? "bg-status-good/10 text-status-good" : "bg-status-bad/10 text-status-bad"
            }`}>
              {fmt.delta(summary.ordersGrowth)} Orders
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${
              summary.revenueGrowth >= 0 ? "bg-status-good/10 text-status-good" : "bg-status-bad/10 text-status-bad"
            }`}>
              {fmt.delta(summary.revenueGrowth)} Revenue
            </span>
          </div>
          {data.lastSynced && (
            <span className="text-[10px] text-text-muted">
              Synced {formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true })}
            </span>
          )}
        </div>
        <span className="text-xs font-semibold text-text-secondary tabular-nums">
          {92 - currentDay} DAYS LEFT
        </span>
      </div>

      {/* Timeline Progress */}
      <div className="relative mb-6">
        <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
          <div className="h-full bg-accent-blue rounded-full" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-text-muted">OCT 1</span>
          <span className="text-[10px] text-text-muted">DEC 31</span>
        </div>
      </div>

      {/* Hero Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <div className="relative overflow-hidden bg-bg-secondary rounded-2xl p-6 border border-border">
          <div className="absolute top-0 right-0 w-32 h-32 bg-status-good/5 rounded-full blur-3xl -mr-10 -mt-10" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-status-good" />
              <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Revenue Growth</span>
            </div>
            <div className={`text-metric font-bold tracking-tight leading-none mb-2 ${summary.revenueGrowth >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(summary.revenueGrowth)}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-text-primary font-semibold">{fmt.currency(summary.totalRevenue2025)}</span>
              <span className="text-text-muted">vs {fmt.currency(summary.totalRevenue2024)}</span>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden bg-bg-secondary rounded-2xl p-6 border border-border">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent-blue/5 rounded-full blur-3xl -mr-10 -mt-10" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <Package className="w-4 h-4 text-accent-blue" />
              <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Orders Growth</span>
            </div>
            <div className={`text-metric font-bold tracking-tight leading-none mb-2 ${summary.ordersGrowth >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(summary.ordersGrowth)}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-text-primary font-semibold">{fmt.number(summary.totalOrders2025)}</span>
              <span className="text-text-muted">vs {fmt.number(summary.totalOrders2024)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted uppercase tracking-wider">{monthLabel} Daily Orders</span>
            <span className={`text-xs font-semibold ${monthDeltas.avgDailyOrders >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(monthDeltas.avgDailyOrders)}
            </span>
          </div>
          <div className="text-xl font-bold text-text-primary tabular-nums">{monthMetrics.avgDailyOrders2025.toLocaleString()}</div>
          <div className="text-xs text-text-muted mt-1">vs {monthMetrics.avgDailyOrders2024.toLocaleString()} in 2024</div>
        </div>
        <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted uppercase tracking-wider">{monthLabel} Daily Rev</span>
            <span className={`text-xs font-semibold ${monthDeltas.avgDailyRevenue >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(monthDeltas.avgDailyRevenue)}
            </span>
          </div>
          <div className="text-xl font-bold text-text-primary tabular-nums">{fmt.currency(monthMetrics.avgDailyRevenue2025)}</div>
          <div className="text-xs text-text-muted mt-1">vs {fmt.currency(monthMetrics.avgDailyRevenue2024)} in 2024</div>
        </div>
        <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted uppercase tracking-wider">{monthLabel} AOV</span>
            <span className={`text-xs font-semibold ${monthDeltas.aov >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(monthDeltas.aov)}
            </span>
          </div>
          <div className="text-xl font-bold text-text-primary tabular-nums">${monthMetrics.aov2025.toFixed(0)}</div>
          <div className="text-xs text-text-muted mt-1">vs ${monthMetrics.aov2024.toFixed(0)} in 2024</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Daily Orders */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Daily Orders</h3>
              <p className="text-xs text-text-muted">Order volume by day of Q4</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary tabular-nums">
                {chartData[currentDay - 1]?.orders2025?.toLocaleString() || "—"}
              </div>
              <div className="text-xs text-text-muted">Day {currentDay}</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="dailyOrders2025" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.current} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={colors.current} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fill: "#64748B", fontSize: 10 }} axisLine={{ stroke: "#1E293B" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} width={35} />
                <Tooltip content={<HolidayChartTooltip />} />
                <ReferenceLine x={currentDay} stroke="#475569" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="orders2025" stroke={colors.current} strokeWidth={2} fill="url(#dailyOrders2025)" />
                <Line type="monotone" dataKey="orders2024" stroke={colors.baseline} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-xs text-text-tertiary">2025</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full border-t border-dashed" style={{ borderColor: colors.baseline }} />
              <span className="text-xs text-text-tertiary">2024</span>
            </div>
          </div>
        </div>

        {/* Daily Revenue */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Daily Revenue</h3>
              <p className="text-xs text-text-muted">Revenue by day of Q4</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary tabular-nums">
                {chartData[currentDay - 1]?.sales2025 != null ? fmt.currency(chartData[currentDay - 1].sales2025 ?? 0) : "—"}
              </div>
              <div className="text-xs text-text-muted">Day {currentDay}</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="dailySales2025" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.current} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={colors.current} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fill: "#64748B", fontSize: 10 }} axisLine={{ stroke: "#1E293B" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}K`} width={45} />
                <Tooltip content={<HolidayChartTooltip prefix="$" />} />
                <ReferenceLine x={currentDay} stroke="#475569" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="sales2025" stroke={colors.current} strokeWidth={2} fill="url(#dailySales2025)" />
                <Line type="monotone" dataKey="sales2024" stroke={colors.baseline} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-xs text-text-tertiary">2025</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full border-t border-dashed" style={{ borderColor: colors.baseline }} />
              <span className="text-xs text-text-tertiary">2024</span>
            </div>
          </div>
        </div>

        {/* Cumulative Orders */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Cumulative Orders</h3>
              <p className="text-xs text-text-muted">Running total through Q4</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary tabular-nums">{summary.totalOrders2025.toLocaleString()}</div>
              <div className="text-xs text-text-muted">Total</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="cumOrders2025" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.current} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={colors.current} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cumOrders2024" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.baseline} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={colors.baseline} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fill: "#64748B", fontSize: 10 }} axisLine={{ stroke: "#1E293B" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}K`} width={35} />
                <Tooltip content={<HolidayChartTooltip />} />
                <ReferenceLine x={currentDay} stroke="#475569" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="cumOrders2024" stroke={colors.baseline} strokeWidth={1.5} strokeDasharray="4 4" fill="url(#cumOrders2024)" />
                <Area type="monotone" dataKey="cumOrders2025" stroke={colors.current} strokeWidth={2} fill="url(#cumOrders2025)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-xs text-text-tertiary">2025</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full border-t border-dashed" style={{ borderColor: colors.baseline }} />
              <span className="text-xs text-text-tertiary">2024</span>
            </div>
          </div>
        </div>

        {/* Cumulative Revenue */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Cumulative Revenue</h3>
              <p className="text-xs text-text-muted">Running total through Q4</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary tabular-nums">${(summary.totalRevenue2025 / 1000000).toFixed(2)}M</div>
              <div className="text-xs text-text-muted">Total</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="cumSales2025" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.current} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={colors.current} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cumSales2024" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.baseline} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={colors.baseline} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fill: "#64748B", fontSize: 10 }} axisLine={{ stroke: "#1E293B" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000000).toFixed(1)}M`} width={45} />
                <Tooltip content={<HolidayChartTooltip prefix="$" />} />
                <ReferenceLine x={currentDay} stroke="#475569" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="cumSales2024" stroke={colors.baseline} strokeWidth={1.5} strokeDasharray="4 4" fill="url(#cumSales2024)" />
                <Area type="monotone" dataKey="cumSales2025" stroke={colors.current} strokeWidth={2} fill="url(#cumSales2025)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-xs text-text-tertiary">2025</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full border-t border-dashed" style={{ borderColor: colors.baseline }} />
              <span className="text-xs text-text-tertiary">2024</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
