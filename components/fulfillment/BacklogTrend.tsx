"use client";

import { format } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Package, TrendingDown, TrendingUp } from "lucide-react";
import type { DailyBacklog } from "@/lib/types";
import { formatNumber, parseLocalDate } from "@/lib/dashboard-utils";

interface BacklogTrendProps {
  backlog: DailyBacklog[];
  loading: boolean;
}

export function BacklogTrend({ backlog, loading }: BacklogTrendProps) {
  const chartData = backlog.map((d) => ({
    date: format(parseLocalDate(d.date), "M/d"),
    rawDate: d.date,
    backlog: d.runningBacklog,
    created: d.created,
    fulfilled: d.fulfilled,
  }));

  if (chartData.length === 0) return null;

  // Get current backlog (most recent value)
  const currentBacklog = chartData[chartData.length - 1]?.backlog || 0;
  const startBacklog = chartData[0]?.backlog || 0;
  const change = currentBacklog - startBacklog;
  const changePercent = startBacklog > 0 ? Math.round((change / startBacklog) * 100) : 0;
  const isImproving = change < 0;

  // Calculate Y-axis domain with padding
  const backlogValues = chartData.map(d => d.backlog);
  const minBacklog = Math.min(...backlogValues);
  const maxBacklog = Math.max(...backlogValues);
  const padding = Math.max(100, (maxBacklog - minBacklog) * 0.15);
  const yMin = Math.max(0, Math.floor((minBacklog - padding) / 100) * 100);
  const yMax = Math.ceil((maxBacklog + padding) / 100) * 100;

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6 transition-all hover:border-border-hover">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted flex items-center gap-2">
            <Package className="w-3.5 h-3.5" />
            BACKLOG TREND
          </h3>
          <p className="text-xs text-text-muted mt-1">
            Orders waiting to be fulfilled
          </p>
        </div>

        {/* Current state card */}
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-text-primary">
            {formatNumber(currentBacklog)}
          </div>
          {change !== 0 && (
            <div className={`flex items-center justify-end gap-1 text-xs mt-1 ${
              isImproving ? "text-status-good" : "text-status-bad"
            }`}>
              {isImproving ? (
                <TrendingDown className="w-3 h-3" />
              ) : (
                <TrendingUp className="w-3 h-3" />
              )}
              <span>
                {change > 0 ? "+" : ""}{formatNumber(change)} ({changePercent > 0 ? "+" : ""}{changePercent}%)
              </span>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-[180px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="backlogGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isImproving ? "#10B981" : "#EF4444"} stopOpacity={0.2} />
                <stop offset="95%" stopColor={isImproving ? "#10B981" : "#EF4444"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              stroke="#64748B"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: "#1E293B" }}
              dy={8}
            />
            <YAxis
              stroke="#64748B"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={45}
              domain={[yMin, yMax]}
              tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
              labelStyle={{ color: "#94A3B8", marginBottom: "4px", fontWeight: 500 }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  backlog: "Backlog",
                  created: "Created",
                  fulfilled: "Fulfilled"
                };
                return [
                  <span key="v" className="font-semibold tabular-nums">
                    {formatNumber(value)}
                  </span>,
                  labels[name] || name
                ];
              }}
            />
            <Area
              type="monotone"
              dataKey="backlog"
              stroke={isImproving ? "#10B981" : "#EF4444"}
              strokeWidth={2}
              fill="url(#backlogGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
