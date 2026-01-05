"use client";

import { format } from "date-fns";
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { Flame, TrendingDown, TrendingUp } from "lucide-react";
import { parseLocalDate } from "@/lib/dashboard-utils";
import type { AssemblyResponse } from "@/lib/types";
import { StaleTimestamp } from "@/components/StaleTimestamp";

interface AssemblyDashboardProps {
  data: AssemblyResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

// Forge palette - industrial heat colors
const FORGE = {
  molten: "#FCD34D",    // Glowing yellow - peak heat
  heat: "#F59E0B",      // Amber - hot
  ember: "#EA580C",     // Orange-red - cooling
  copper: "#D97706",    // Deep copper
  iron: "#78716C",      // Cool iron
  slag: "#44403C",      // Dark residue
  steel: "#A1A1AA",     // Polished steel
};

export function AssemblyDashboard({
  data,
  loading,
  onRefresh,
}: AssemblyDashboardProps) {
  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-2 border-border" />
            <div
              className="absolute inset-0 w-16 h-16 rounded-full border-2 border-transparent animate-spin"
              style={{ borderTopColor: '#0EA5E9', animationDuration: '1.2s' }}
            />
            <Flame className="absolute inset-0 m-auto w-6 h-6 animate-pulse text-amber-500" />
          </div>
          <div className="text-xs uppercase tracking-widest text-text-tertiary">
            Loading production data
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
        <Flame className="w-12 h-12 text-text-muted" />
        <div className="text-center">
          <div className="text-text-secondary mb-4">No production data available</div>
          <button
            onClick={onRefresh}
            className="px-5 py-2 text-xs uppercase tracking-widest border border-border hover:border-accent-blue hover:text-accent-blue transition-colors rounded-lg"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const { summary, daily, weeklyData, dayOfWeekAvg } = data;

  // === DATA CALCULATIONS ===
  const sortedDaily = [...daily].sort((a, b) => b.date.localeCompare(a.date));
  const recentDaily = sortedDaily.slice(0, 30).reverse();

  // T7 calculations
  const t7Days = sortedDaily.slice(0, 7);
  const t7Total = t7Days.reduce((sum, d) => sum + d.daily_total, 0);
  const priorT7Days = sortedDaily.slice(7, 14);
  const priorT7Total = priorT7Days.reduce((sum, d) => sum + d.daily_total, 0);
  const t7Delta = priorT7Total > 0 ? ((t7Total - priorT7Total) / priorT7Total) * 100 : 0;
  const t7DailyAvg = Math.round(t7Total / 7);

  // MoM calculations
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYearNum = now.getFullYear();
  const currentDay = now.getDate();
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthNamesFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const currentMonthName = monthNames[currentMonth];

  const thisMonthDays = daily.filter(d => {
    const date = new Date(d.date);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYearNum;
  });
  const thisMonthTotal = thisMonthDays.reduce((sum, d) => sum + d.daily_total, 0);
  const thisMonthAvg = thisMonthDays.length > 0 ? Math.round(thisMonthTotal / thisMonthDays.length) : 0;

  const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
  const lastMonthYear = currentMonth === 0 ? currentYearNum - 1 : currentYearNum;
  const lastMonthName = monthNames[lastMonth];

  const lastMonthDays = daily.filter(d => {
    const date = new Date(d.date);
    return date.getMonth() === lastMonth && date.getFullYear() === lastMonthYear && date.getDate() <= currentDay;
  });
  const lastMonthAvg = lastMonthDays.length > 0
    ? Math.round(lastMonthDays.reduce((sum, d) => sum + d.daily_total, 0) / lastMonthDays.length)
    : 0;

  const momDelta = lastMonthAvg > 0 ? ((thisMonthAvg - lastMonthAvg) / lastMonthAvg) * 100 : 0;

  // Chart data
  const dailyChartData = recentDaily.map((d, idx, arr) => {
    const windowStart = Math.max(0, idx - 6);
    const window = arr.slice(windowStart, idx + 1);
    const rollingAvg = window.reduce((sum, item) => sum + item.daily_total, 0) / window.length;
    return {
      date: format(parseLocalDate(d.date), "M/d"),
      value: d.daily_total,
      rollingAvg: Math.round(rollingAvg),
      aboveAvg: d.daily_total >= rollingAvg,
    };
  });

  const WEEKLY_TARGET = 5000;
  const weeklyChartData = weeklyData.map((w) => ({
    week: `W${w.week_num}`,
    total: w.total,
    meetsTarget: w.total >= WEEKLY_TARGET,
  }));

  const dowChartData = dayOfWeekAvg.map((d) => ({
    day: d.day.slice(0, 3),
    avg: d.avg,
  }));

  // Formatters
  const fmt = {
    num: (n: number) => n.toLocaleString(),
    delta: (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`,
    compact: (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n),
  };

  // Trend indicator component
  const Trend = ({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) => {
    const isPositive = value >= 0;
    const Icon = isPositive ? TrendingUp : TrendingDown;
    const sizeClasses = size === "lg" ? "text-base" : "text-xs";
    return (
      <span className={`inline-flex items-center gap-1 tabular-nums ${sizeClasses} ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
        <Icon className={size === "lg" ? "w-4 h-4" : "w-3 h-3"} />
        {fmt.delta(value)}
      </span>
    );
  };

  // Monthly summary calculation
  const monthlyData = new Map<string, { total: number; days: number }>();
  for (const d of daily) {
    if (d.month && d.year) {
      const key = `${d.year}-${String(d.month).padStart(2, "0")}`;
      const existing = monthlyData.get(key) || { total: 0, days: 0 };
      monthlyData.set(key, { total: existing.total + d.daily_total, days: existing.days + 1 });
    }
  }
  const monthlyArray = Array.from(monthlyData.entries())
    .map(([key, val]) => {
      const [year, month] = key.split("-");
      return {
        key,
        monthName: monthNamesFull[parseInt(month) - 1],
        total: val.total,
        days: val.days,
        dailyAvg: Math.round(val.total / val.days),
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));

  const monthlyWithMoM = monthlyArray.map((m, idx) => {
    const prev = monthlyArray[idx + 1];
    const momPct = prev ? ((m.dailyAvg - prev.dailyAvg) / prev.dailyAvg) * 100 : null;
    return { ...m, momPct };
  });

  // Performance-based gradient: green when up, red when down
  const heroGradient = t7Delta >= 0
    ? "from-emerald-950/40 via-bg-secondary to-bg-secondary"
    : "from-red-950/30 via-bg-secondary to-bg-secondary";

  return (
    <div className="space-y-6">
      {/* === HERO ROW === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Primary Metric: T7 Velocity */}
        <div className={`relative overflow-hidden rounded-xl border border-border bg-gradient-to-br ${heroGradient} p-5`}>
          {/* Label */}
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: t7Delta >= 0 ? '#10B981' : '#EF4444' }}
            />
            <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
              T7 Velocity
            </span>
          </div>

          {/* The Number */}
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-4xl font-semibold tabular-nums text-text-primary">
              {fmt.num(t7Total)}
            </span>
            <span className="text-sm text-text-tertiary">units</span>
          </div>

          {/* Trend and Context */}
          <div className="flex items-center gap-4 text-sm">
            <Trend value={t7Delta} />
            <span className="text-text-muted">
              vs {fmt.num(priorT7Total)} prior
            </span>
            <span className="text-text-tertiary font-mono text-xs">
              {fmt.num(t7DailyAvg)}/day
            </span>
          </div>
        </div>

        {/* Month vs Month */}
        <div className={`relative overflow-hidden rounded-xl border border-border bg-gradient-to-br ${momDelta >= 0 ? "from-emerald-950/30" : "from-red-950/20"} via-bg-secondary to-bg-secondary p-5`}>
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-3">
            {currentMonthName} vs {lastMonthName}
          </div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className={`text-4xl font-semibold tabular-nums ${momDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt.delta(momDelta)}
            </span>
          </div>
          <div className="text-sm text-text-muted">
            {fmt.num(thisMonthAvg)}/day vs {fmt.num(lastMonthAvg)}
          </div>
        </div>
      </div>

      {/* === SECONDARY STATS ROW === */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Latest Day */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
            {summary.latestDate ? format(parseLocalDate(summary.latestDate), "EEE, MMM d") : "Latest"}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-text-primary">
              {fmt.num(summary.yesterdayProduction)}
            </span>
            <Trend value={summary.yesterdayDelta} />
          </div>
        </div>

        {/* 7-Day Avg */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
            7-Day Avg
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-text-primary">
              {fmt.num(t7DailyAvg)}
            </span>
            <span className="text-xs text-text-muted">/day</span>
          </div>
        </div>

        {/* MTD Total */}
        <div className="rounded-xl border border-border bg-bg-secondary p-4 col-span-2 lg:col-span-1">
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-2">
            {currentMonthName} Total · {thisMonthDays.length} days
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-text-primary">
              {fmt.num(thisMonthTotal)}
            </span>
            <span className="text-xs text-text-muted">{fmt.num(thisMonthAvg)}/day</span>
          </div>
        </div>
      </div>

      {/* === DAILY PRODUCTION CHART === */}
      <div className="rounded-xl border border-border bg-bg-secondary p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary">
            Daily Output · Last 30 Days
          </h3>
          <div className="flex items-center gap-4 text-[10px] text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-accent-blue" />
              Above avg
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FORGE.ember }} />
              Below avg
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-amber-400" />
              7-day rolling
            </span>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dailyChartData} margin={{ top: 20, right: 10, left: -15, bottom: 5 }}>
              <defs>
                <linearGradient id="barHot" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0EA5E9" />
                  <stop offset="100%" stopColor="#0284C7" stopOpacity={0.8} />
                </linearGradient>
                <linearGradient id="barCool" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={FORGE.ember} />
                  <stop offset="100%" stopColor={FORGE.copper} stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748B', fontSize: 10 }}
                interval={2}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#64748B', fontSize: 10 }}
                width={40}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                contentStyle={{
                  backgroundColor: '#12151F',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
                labelStyle={{ color: '#94A3B8', marginBottom: 4 }}
                itemStyle={{ color: '#FFFFFF' }}
                formatter={(value: number, name: string) => [
                  <span key={name} style={{ color: name === 'value' ? '#0EA5E9' : '#FBBF24' }}>
                    {fmt.num(value)}
                  </span>,
                  name === 'value' ? 'Daily' : '7-Day Avg'
                ]}
              />
              <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={16}>
                {dailyChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.aboveAvg ? 'url(#barHot)' : 'url(#barCool)'} />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="rollingAvg"
                stroke="#FBBF24"
                strokeWidth={2}
                dot={false}
                strokeOpacity={0.9}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* === SECONDARY CHARTS ROW === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Weekly Production */}
        <div className="rounded-xl border border-border bg-bg-secondary p-5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary mb-4">
            Weekly Output
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyChartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                <defs>
                  <linearGradient id="weeklyHot" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                  <linearGradient id="weeklyCool" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={FORGE.ember} />
                    <stop offset="100%" stopColor={FORGE.copper} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="week"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748B', fontSize: 10 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748B', fontSize: 10 }}
                  width={40}
                  tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  contentStyle={{
                    backgroundColor: '#12151F',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                  labelStyle={{ color: '#94A3B8' }}
                  itemStyle={{ color: '#FFFFFF' }}
                  formatter={(value: number) => [fmt.num(value), 'Total']}
                />
                <ReferenceLine y={5000} stroke="#475569" strokeDasharray="4 4" strokeOpacity={0.5} />
                <Bar dataKey="total" radius={[3, 3, 0, 0]} maxBarSize={40}>
                  {weeklyChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.meetsTarget ? 'url(#weeklyHot)' : 'url(#weeklyCool)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Summary (moved from bottom) */}
        <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary">
              Monthly Summary
            </h3>
          </div>
          <div className="overflow-y-auto max-h-48 scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-secondary">
                <tr className="text-[9px] uppercase tracking-wider text-text-muted border-b border-border">
                  <th className="text-left py-2 px-4 font-medium">Month</th>
                  <th className="text-right py-2 px-4 font-medium">Total</th>
                  <th className="text-right py-2 px-4 font-medium">Avg</th>
                  <th className="text-right py-2 px-4 font-medium">MoM</th>
                </tr>
              </thead>
              <tbody>
                {monthlyWithMoM.slice(0, 6).map((m, idx) => (
                  <tr
                    key={m.key}
                    className={`border-b border-border/50 ${idx % 2 === 0 ? 'bg-bg-tertiary/30' : ''}`}
                  >
                    <td className="py-2 px-4 text-text-secondary">{m.monthName.slice(0, 3)}</td>
                    <td className="py-2 px-4 text-right text-text-tertiary tabular-nums">{fmt.compact(m.total)}</td>
                    <td className="py-2 px-4 text-right text-text-secondary tabular-nums">{fmt.num(m.dailyAvg)}</td>
                    <td className={`py-2 px-4 text-right tabular-nums ${
                      m.momPct === null ? 'text-text-muted' : m.momPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {m.momPct !== null ? fmt.delta(m.momPct) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* === DEFECT RATE + WEEKDAY PATTERN (side by side) === */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Defect Rate by SKU */}
        {data.defectRates && data.defectRates.length > 0 && (
          <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary">
                Defect Rate by SKU <span className="text-text-muted ml-2">· All Time</span>
              </h3>
            </div>
            <div className="max-h-[320px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-secondary">
                  <tr className="text-[9px] uppercase tracking-wider text-text-muted border-b border-border">
                    <th className="text-left py-3 px-4 font-medium">SKU</th>
                    <th className="text-right py-3 px-3 font-medium">All-Time</th>
                    <th className="text-right py-3 px-4 font-medium">60-Day</th>
                  </tr>
                </thead>
                <tbody>
                  {data.defectRates.slice(0, 25).map((d, idx) => (
                    <tr
                      key={d.sku}
                      className={`border-b border-border/50 hover:bg-bg-tertiary transition-colors ${
                        d.is_elevated
                          ? 'bg-amber-950/20'
                          : idx % 2 === 0 ? 'bg-bg-tertiary/30' : ''
                      }`}
                    >
                      <td className="py-2 px-4 text-text-secondary">{d.display_name}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${
                        d.defect_rate > 5 ? 'text-red-400' : d.defect_rate > 2 ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        {d.defect_rate.toFixed(1)}%
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {d.is_elevated ? (
                          <span className="inline-flex items-center gap-1.5 text-amber-300 font-semibold">
                            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                            {d.recent_rate.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-text-muted">{d.recent_rate.toFixed(1)}%</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Weekday Pattern */}
        <div className="rounded-xl border border-border bg-bg-secondary p-5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary mb-4">
            Weekday Pattern
          </h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowChartData} margin={{ top: 10, right: 5, left: -15, bottom: 5 }}>
                <defs>
                  <linearGradient id="dowGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#64748B" />
                    <stop offset="100%" stopColor="#475569" />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748B', fontSize: 10 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748B', fontSize: 10 }}
                  width={40}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  contentStyle={{
                    backgroundColor: '#12151F',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                  labelStyle={{ color: '#94A3B8' }}
                  itemStyle={{ color: '#FFFFFF' }}
                  formatter={(value: number) => [fmt.num(value), 'Avg']}
                />
                <Bar dataKey="avg" fill="url(#dowGrad)" radius={[3, 3, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* === 2026 ANNUAL TARGETS === */}
      {data.annualTargets && data.annualTargets.length > 0 && (
        <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-[10px] uppercase tracking-widest text-text-tertiary">
              2026 Annual Production Progress
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-text-muted border-b border-border">
                  <th className="text-left py-3 px-5 font-medium">SKU</th>
                  <th className="text-right py-3 px-4 font-medium">Target</th>
                  <th className="text-right py-3 px-4 font-medium">YTD</th>
                  <th className="text-right py-3 px-4 font-medium text-amber-400">T7</th>
                  <th className="text-right py-3 px-4 font-medium">Remaining</th>
                  <th className="py-3 px-5 font-medium w-36">Progress</th>
                </tr>
              </thead>
              <tbody>
                {data.annualTargets.map((target, idx) => {
                  const remaining = Math.max(0, target.annual_target - target.ytd_built);
                  const isComplete = target.pct_complete >= 100;
                  return (
                    <tr
                      key={target.sku}
                      className={`border-b border-border/50 hover:bg-bg-tertiary transition-colors ${idx % 2 === 0 ? 'bg-bg-tertiary/30' : ''}`}
                    >
                      <td className="py-2.5 px-5 text-text-secondary">{target.display_name}</td>
                      <td className="py-2.5 px-4 text-right text-text-muted tabular-nums">{fmt.num(target.annual_target)}</td>
                      <td className="py-2.5 px-4 text-right text-text-tertiary tabular-nums">{fmt.num(target.ytd_built)}</td>
                      <td className={`py-2.5 px-4 text-right tabular-nums ${target.t7 ? 'text-amber-400' : 'text-text-muted'}`}>
                        {target.t7 ? fmt.num(target.t7) : "—"}
                      </td>
                      <td className={`py-2.5 px-4 text-right tabular-nums ${isComplete ? 'text-emerald-400' : 'text-text-tertiary'}`}>
                        {isComplete ? "✓" : fmt.num(remaining)}
                      </td>
                      <td className="py-2.5 px-5">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, target.pct_complete)}%`,
                                background: isComplete ? '#10B981' : '#0EA5E9',
                              }}
                            />
                          </div>
                          <span className={`text-[10px] tabular-nums w-12 text-right ${isComplete ? 'text-emerald-400' : 'text-text-muted'}`}>
                            {target.pct_complete.toFixed(1)}%
                          </span>
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

      {/* === FOOTER: SYNC STATUS === */}
      <div className="flex justify-end">
        <StaleTimestamp date={data.lastSynced} />
      </div>
    </div>
  );
}
