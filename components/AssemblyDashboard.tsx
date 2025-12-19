"use client";

import { format, formatDistanceToNow } from "date-fns";
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
  LabelList,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Package,
  Calendar,
  CalendarDays,
  BarChart3,
  Hammer,
} from "lucide-react";
import { parseLocalDate } from "@/lib/dashboard-utils";
import type { AssemblyResponse } from "@/lib/types";
import { StaleTimestamp } from "@/components/StaleTimestamp";

interface AssemblyDashboardProps {
  data: AssemblyResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

export function AssemblyDashboard({
  data,
  loading,
  onRefresh,
}: AssemblyDashboardProps) {
  // Forge color palette
  const forge = {
    copper: "#D97706",
    ember: "#EA580C",
    iron: "#78716C",
    glow: "#FCD34D",
    heat: "#F59E0B",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-bg-tertiary" />
            <div
              className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent animate-spin"
              style={{ borderTopColor: forge.copper, borderRightColor: forge.ember }}
            />
          </div>
          <span className="text-sm text-text-tertiary tracking-widest uppercase">Firing up the forge...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Hammer className="w-16 h-16" style={{ color: forge.iron }} />
        <span className="text-text-tertiary tracking-wide">No assembly data available</span>
        <button
          onClick={onRefresh}
          className="px-6 py-2.5 text-sm font-medium tracking-wider uppercase transition-all border-2 rounded"
          style={{ borderColor: forge.copper, color: forge.copper }}
        >
          Refresh
        </button>
      </div>
    );
  }

  const { summary, daily, weeklyData, dayOfWeekAvg, config } = data;

  // Calculate progress percentage toward cutoff
  const cutoffDate = new Date(config.manufacturing_cutoff);
  const startDate = new Date(config.cutoff_start_date);
  const today = new Date();
  const totalDays = Math.ceil((cutoffDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const timeProgressPct = Math.min(100, Math.round((elapsedDays / totalDays) * 100));

  // Prepare chart data - last 30 days with 7-day rolling average
  const sortedDaily = [...daily].sort((a, b) => b.date.localeCompare(a.date));
  const recentDaily = sortedDaily.slice(0, 30).reverse();

  // T7 (trailing 7 days) calculations
  const t7Days = sortedDaily.slice(0, 7);
  const t7Total = t7Days.reduce((sum, d) => sum + d.daily_total, 0);
  const priorT7Days = sortedDaily.slice(7, 14);
  const priorT7Total = priorT7Days.reduce((sum, d) => sum + d.daily_total, 0);
  const t7Delta = priorT7Total > 0 ? ((t7Total - priorT7Total) / priorT7Total) * 100 : 0;

  const dailyChartData = recentDaily.map((d, idx, arr) => {
    // Calculate 7-day rolling average (use available days if less than 7)
    const windowStart = Math.max(0, idx - 6);
    const window = arr.slice(windowStart, idx + 1);
    const rollingAvg = window.reduce((sum, item) => sum + item.daily_total, 0) / window.length;
    const aboveAvg = d.daily_total >= rollingAvg;

    return {
      date: format(parseLocalDate(d.date), "M/d"),
      value: d.daily_total,
      rollingAvg: Math.round(rollingAvg),
      day: d.day_of_week,
      aboveAvg,
      fill: aboveAvg ? "url(#greenGradient)" : "url(#emberGradient)",
    };
  });

  // Weekly comparison data
  const WEEKLY_TARGET = 5000;
  const weeklyChartData = weeklyData.map((w) => ({
    week: `W${w.week_num}`,
    total: w.total,
    dailyAvg: w.daily_avg,
    daysWorked: w.days_worked,
    fill: w.total >= WEEKLY_TARGET ? "url(#weeklyGreenGradient)" : "url(#weeklyEmberGradient)",
  }));

  // Day of week data
  const dowChartData = dayOfWeekAvg.map((d) => ({
    day: d.day.slice(0, 3),
    avg: d.avg,
    count: d.count,
  }));

  const fmt = {
    number: (n: number) => n.toLocaleString(),
    delta: (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`,
  };

  return (
    <div className="space-y-6">
      {/* Sync Status */}
      <div className="flex justify-end">
        <StaleTimestamp date={data.lastSynced} />
      </div>

      {/* Production Stats Row */}
      {(() => {
        // Calculate MTD production (current month)
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const currentDay = now.getDate();

        // This year's MTD
        const mtdThisYear = daily
          .filter(d => {
            const date = new Date(d.date);
            return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
          })
          .reduce((sum, d) => sum + d.daily_total, 0);

        // Last month's same period (up to same day)
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        const mtdLastMonth = daily
          .filter(d => {
            const date = new Date(d.date);
            return date.getMonth() === lastMonth &&
                   date.getFullYear() === lastMonthYear &&
                   date.getDate() <= currentDay;
          })
          .reduce((sum, d) => sum + d.daily_total, 0);

        const mtdDelta = mtdLastMonth > 0
          ? ((mtdThisYear - mtdLastMonth) / mtdLastMonth) * 100
          : mtdThisYear > 0 ? 100 : 0;

        const lastMonthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][lastMonth];

        return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Yesterday's Production */}
        <div className="bg-bg-secondary rounded-xl p-3 sm:p-5 border border-border/30">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {summary.latestDate ? format(parseLocalDate(summary.latestDate), "MMM d").toUpperCase() : "LATEST"}
            </span>
            <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
            {fmt.number(summary.yesterdayProduction)}
          </div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${summary.yesterdayDelta >= 0 ? "text-status-good" : "text-status-bad"}`}>
            {summary.yesterdayDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmt.delta(summary.yesterdayDelta)} vs prior day
          </div>
        </div>

        {/* MTD Production */}
        <div className="bg-bg-secondary rounded-xl p-3 sm:p-5 border border-border/30">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">MTD</span>
            <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
            {fmt.number(mtdThisYear)}
          </div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${mtdDelta >= 0 ? "text-status-good" : "text-status-bad"}`}>
            {mtdDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmt.delta(mtdDelta)} vs {lastMonthName}
          </div>
        </div>

        {/* 7-Day Average */}
        <div className="bg-bg-secondary rounded-xl p-3 sm:p-5 border border-border/30">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">7-DAY AVG</span>
            <BarChart3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
            {fmt.number(summary.dailyAverage7d)}
          </div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${summary.dailyAverageDelta >= 0 ? "text-status-good" : "text-status-bad"}`}>
            {summary.dailyAverageDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmt.delta(summary.dailyAverageDelta)} vs prior week
          </div>
        </div>

        {/* T7 (Trailing 7 Days) */}
        <div className="bg-bg-secondary rounded-xl p-3 sm:p-5 border border-border/30">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">T7</span>
            <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
            {fmt.number(t7Total)}
          </div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${t7Delta >= 0 ? "text-status-good" : "text-status-bad"}`}>
            {t7Delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmt.delta(t7Delta)} vs prior 7d
          </div>
        </div>
      </div>
        );
      })()}

      {/* Daily Production Chart - Full Width with Rolling Average */}
      <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            DAILY PRODUCTION
          </h3>
          <div className="flex items-center gap-4 text-[10px] text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#10B981" }} />
              Above Avg
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: forge.ember }} />
              Below Avg
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded" style={{ backgroundColor: forge.glow }} />
              7-Day Avg
            </span>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dailyChartData} margin={{ top: 20, right: 10, left: -10, bottom: 20 }}>
              <defs>
                <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#059669" stopOpacity={0.85} />
                </linearGradient>
                <linearGradient id="emberGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={forge.heat} stopOpacity={1} />
                  <stop offset="100%" stopColor={forge.ember} stopOpacity={0.85} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748B", fontSize: 10 }}
                interval={2}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748B", fontSize: 10 }}
                width={45}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                contentStyle={{
                  backgroundColor: "rgba(18, 21, 31, 0.98)",
                  border: `1px solid ${forge.copper}40`,
                  borderRadius: "8px",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                  padding: "10px 14px",
                }}
                labelStyle={{ color: "#94A3B8", fontSize: 11, marginBottom: 6 }}
                itemStyle={{ color: "#E2E8F0" }}
                formatter={(value: number, name: string) => {
                  if (name === "value") return [<span key="v" style={{ color: forge.glow, fontWeight: 600 }}>{fmt.number(value)}</span>, "Daily"];
                  if (name === "rollingAvg") return [<span key="a" style={{ color: "#FCD34D", fontWeight: 600 }}>{fmt.number(value)}</span>, "7-Day Avg"];
                  return [value, name];
                }}
              />
              <ReferenceLine
                y={summary.dailyTarget}
                stroke={forge.heat}
                strokeDasharray="6 4"
                label={{
                  value: `Target: ${fmt.number(summary.dailyTarget)}`,
                  position: "insideTopRight",
                  fill: forge.heat,
                  fontSize: 10,
                }}
              />
              <Bar
                dataKey="value"
                radius={[2, 2, 0, 0]}
                maxBarSize={14}
              >
                {dailyChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  fill="#94A3B8"
                  fontSize={9}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={(props: any) => {
                    const x = Number(props.x) || 0;
                    const y = Number(props.y) || 0;
                    const width = Number(props.width) || 0;
                    const value = Number(props.value) || 0;
                    return (
                      <text
                        x={x + width / 2}
                        y={y - 4}
                        textAnchor="middle"
                        fill="#94A3B8"
                        fontSize={9}
                        stroke="rgba(15, 23, 42, 0.8)"
                        strokeWidth={2}
                        paintOrder="stroke"
                      >
                        {value ? value.toLocaleString() : ''}
                      </text>
                    );
                  }}
                />
              </Bar>
              <Line
                type="monotone"
                dataKey="rollingAvg"
                stroke={forge.glow}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: forge.glow, stroke: "#0B0E1A", strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Secondary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Totals */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-5">
            WEEKLY PRODUCTION
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyChartData} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
                <defs>
                  <linearGradient id="weeklyGreenGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                  <linearGradient id="weeklyEmberGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={forge.heat} />
                    <stop offset="100%" stopColor={forge.ember} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="week"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  width={50}
                  tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  contentStyle={{
                    backgroundColor: "rgba(18, 21, 31, 0.98)",
                    border: "1px solid rgba(234, 88, 12, 0.3)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    padding: "10px 14px",
                  }}
                  labelStyle={{ color: "#94A3B8", fontSize: 11, marginBottom: 4 }}
                  itemStyle={{ color: "#E2E8F0" }}
                  formatter={(value: number, name: string) => {
                    if (name === "total") return [
                      <span key="v" style={{ color: "#FCD34D", fontWeight: 600 }}>{fmt.number(value)}</span>,
                      "Total"
                    ];
                    return [value, name];
                  }}
                />
                <ReferenceLine
                  y={5000}
                  stroke="#94A3B8"
                  strokeDasharray="6 4"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
                <Bar
                  dataKey="total"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                >
                  {weeklyChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Day of Week Pattern */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-5">
            AVERAGE BY WEEKDAY
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowChartData} margin={{ top: 20, right: 10, left: -10, bottom: 20 }}>
                <defs>
                  <linearGradient id="dowGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.85} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  width={45}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  contentStyle={{
                    backgroundColor: "rgba(18, 21, 31, 0.98)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    padding: "10px 14px",
                  }}
                  labelStyle={{ color: "#94A3B8", fontSize: 11, marginBottom: 4 }}
                  itemStyle={{ color: "#E2E8F0" }}
                  formatter={(value: number, name: string) => {
                    if (name === "avg") return [
                      <span key="v" style={{ color: "#10B981", fontWeight: 600 }}>{fmt.number(value)}</span>,
                      "Avg"
                    ];
                    return [value, name];
                  }}
                />
                <Bar
                  dataKey="avg"
                  fill="url(#dowGradient)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                >
                  <LabelList
                    dataKey="avg"
                    position="top"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(props: any) => {
                      const x = Number(props.x) || 0;
                      const y = Number(props.y) || 0;
                      const width = Number(props.width) || 0;
                      const value = Number(props.value) || 0;
                      return (
                        <text
                          x={x + width / 2}
                          y={y - 6}
                          textAnchor="middle"
                          fill="#94A3B8"
                          fontSize={11}
                          fontWeight={500}
                        >
                          {value ? value.toLocaleString() : ''}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Section: SKU Progress + Monthly Summary */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
        {/* SKU Progress Table */}
        {data.targets && data.targets.length > 0 && (() => {
        // display_name comes from API (joined with products table)
        const sortedTargets = data.targets
          .filter(t => t.revised_plan > 0)
          .sort((a, b) => {
            const pctA = a.revised_plan > 0 ? (a.assembled_since_cutoff / a.revised_plan) : 0;
            const pctB = b.revised_plan > 0 ? (b.assembled_since_cutoff / b.revised_plan) : 0;
            return pctA - pctB;
          });

        return (
          <div className="bg-bg-secondary rounded-xl p-4 border border-border/30 w-full lg:w-fit overflow-x-auto">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-3">
              SKU PROGRESS
            </h3>
            <table className="text-[11px]">
              <thead>
                <tr className="text-[9px] text-text-muted uppercase tracking-wide">
                  <th className="text-left pb-1.5 pr-6 font-medium border-b border-white/5">SKU</th>
                  <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Target</th>
                  <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Built</th>
                  <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5" style={{ color: forge.glow }}>T7</th>
                  <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Left</th>
                  <th className="pb-1.5 pl-3 border-b border-white/5"></th>
                </tr>
              </thead>
              <tbody>
                {sortedTargets.map((target) => {
                  const progress = target.revised_plan > 0
                    ? (target.assembled_since_cutoff / target.revised_plan) * 100
                    : 0;
                  const isComplete = progress >= 100;
                  return (
                    <tr key={target.sku} className="border-b border-white/[0.02]">
                      <td className="py-1 pr-6 text-text-primary">{target.display_name}</td>
                      <td className="py-1 px-3 text-right text-text-tertiary tabular-nums">{fmt.number(target.revised_plan)}</td>
                      <td className="py-1 px-3 text-right text-text-secondary tabular-nums">{fmt.number(target.assembled_since_cutoff)}</td>
                      <td className="py-1 px-3 text-right tabular-nums" style={{ color: forge.glow }}>{target.t7 ? fmt.number(target.t7) : "—"}</td>
                      <td className={`py-1 px-3 text-right tabular-nums font-medium ${isComplete ? "text-status-good" : "text-text-primary"}`}>
                        {isComplete ? "—" : fmt.number(target.deficit)}
                      </td>
                      <td className="py-1 pl-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-10 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, progress)}%`,
                                background: isComplete
                                  ? "#10B981"
                                  : progress >= 80
                                    ? `linear-gradient(90deg, ${forge.copper}, ${forge.heat})`
                                    : `linear-gradient(90deg, ${forge.copper}, ${forge.ember})`,
                              }}
                            />
                          </div>
                          <span className={`text-[10px] tabular-nums ${isComplete ? "text-status-good" : "text-text-muted"}`}>
                            {progress.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

        {/* Monthly Production Summary */}
        {(() => {
          // Calculate monthly totals from daily data
          const monthlyData = new Map<string, { total: number; days: number }>();
          const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

          for (const d of daily) {
            if (d.month && d.year) {
              const key = `${d.year}-${String(d.month).padStart(2, "0")}`;
              const existing = monthlyData.get(key) || { total: 0, days: 0 };
              monthlyData.set(key, { total: existing.total + d.daily_total, days: existing.days + 1 });
            }
          }

          // Convert to array and sort descending (most recent first)
          const monthlyArray = Array.from(monthlyData.entries())
            .map(([key, val]) => {
              const [year, month] = key.split("-");
              return {
                key,
                month: parseInt(month),
                year: parseInt(year),
                monthName: monthNames[parseInt(month)],
                total: val.total,
                days: val.days,
                dailyAvg: Math.round(val.total / val.days),
              };
            })
            .sort((a, b) => b.key.localeCompare(a.key));

          // Calculate MoM %
          const withMoM = monthlyArray.map((m, idx) => {
            const prevMonth = monthlyArray[idx + 1];
            const momPct = prevMonth ? ((m.dailyAvg - prevMonth.dailyAvg) / prevMonth.dailyAvg) * 100 : null;
            return { ...m, momPct };
          });

          return (
            <div className="bg-bg-secondary rounded-xl p-4 border border-border/30 flex-1 overflow-x-auto">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-3">
                MONTHLY SUMMARY
              </h3>
              <table className="w-full text-[11px] min-w-[300px]">
                <thead>
                  <tr className="text-[9px] text-text-muted uppercase tracking-wide">
                    <th className="text-left pb-1.5 pr-4 font-medium border-b border-white/5">Month</th>
                    <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Total</th>
                    <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Days</th>
                    <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Daily Avg</th>
                    <th className="text-right pb-1.5 pl-3 font-medium border-b border-white/5">MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {withMoM.slice(0, 6).map((m) => (
                    <tr key={m.key} className="border-b border-white/[0.02]">
                      <td className="py-1.5 pr-4 text-text-primary">{m.monthName}</td>
                      <td className="py-1.5 px-3 text-right text-text-secondary tabular-nums">{fmt.number(m.total)}</td>
                      <td className="py-1.5 px-3 text-right text-text-tertiary tabular-nums">{m.days}</td>
                      <td className="py-1.5 px-3 text-right text-text-primary tabular-nums font-medium">{fmt.number(m.dailyAvg)}</td>
                      <td className={`py-1.5 pl-3 text-right tabular-nums ${
                        m.momPct === null ? "text-text-muted" : m.momPct >= 0 ? "text-status-good" : "text-status-bad"
                      }`}>
                        {m.momPct !== null ? `${m.momPct >= 0 ? "+" : ""}${m.momPct.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

    </div>
  );
}
