"use client";

import { format } from "date-fns";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Clock, Target, AlertTriangle } from "lucide-react";
import type { LeadTimeVsVolume } from "@/lib/types";
import { parseLocalDate } from "@/lib/dashboard-utils";

interface LeadTimeTrendProps {
  data: LeadTimeVsVolume[];
  loading: boolean;
}

export function LeadTimeTrend({ data, loading }: LeadTimeTrendProps) {
  if (data.length === 0) return null;

  // Merge warehouse data into single rows
  const dateMap = new Map<string, {
    date: string;
    smithey: number | null;
    selery: number | null;
    smitheyOrders: number;
    seleryOrders: number;
  }>();

  for (const d of data) {
    if (!dateMap.has(d.date)) {
      dateMap.set(d.date, {
        date: d.date,
        smithey: null,
        selery: null,
        smitheyOrders: 0,
        seleryOrders: 0
      });
    }
    const entry = dateMap.get(d.date)!;
    if (d.warehouse === "smithey") {
      entry.smithey = d.avgLeadTimeHours;
      entry.smitheyOrders = d.orderCount;
    } else {
      entry.selery = d.avgLeadTimeHours;
      entry.seleryOrders = d.orderCount;
    }
  }

  const chartData = [...dateMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      displayDate: format(parseLocalDate(d.date), "M/d"),
    }));

  // Calculate VOLUME-WEIGHTED averages (not average of daily averages!)
  // This ensures days with more orders contribute more to the overall average
  const smitheyPoints = chartData.filter((d) => d.smithey !== null && d.smitheyOrders > 0);
  const seleryPoints = chartData.filter((d) => d.selery !== null && d.seleryOrders > 0);

  const smitheyTotalHours = smitheyPoints.reduce((sum, d) => sum + (d.smithey || 0) * d.smitheyOrders, 0);
  const smitheyTotalOrders = smitheyPoints.reduce((sum, d) => sum + d.smitheyOrders, 0);
  const smitheyAvg = smitheyTotalOrders > 0 ? Math.round(smitheyTotalHours / smitheyTotalOrders) : 0;

  const seleryTotalHours = seleryPoints.reduce((sum, d) => sum + (d.selery || 0) * d.seleryOrders, 0);
  const seleryTotalOrders = seleryPoints.reduce((sum, d) => sum + d.seleryOrders, 0);
  const seleryAvg = seleryTotalOrders > 0 ? Math.round(seleryTotalHours / seleryTotalOrders) : 0;

  // Cap Y-axis at reasonable max
  const allValues = chartData
    .flatMap((d) => [d.smithey, d.selery])
    .filter((v): v is number => v !== null && v <= 120);
  const maxLeadTime = Math.max(...allValues, 48) * 1.1;

  // Determine status
  const overallAvg = (smitheyAvg + seleryAvg) / 2;
  const isHealthy = overallAvg <= 24;
  const isWarning = overallAvg > 24 && overallAvg <= 48;

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6 transition-all hover:border-border-hover">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            FULFILLMENT LEAD TIME
          </h3>
          <p className="text-xs text-text-muted mt-1">
            Hours from order placed to shipped
          </p>
        </div>

        {/* Summary cards */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Smithey</div>
            <div className={`text-xl font-bold tabular-nums ${
              smitheyAvg <= 24 ? "text-status-good" : smitheyAvg <= 48 ? "text-status-warning" : "text-status-bad"
            }`}>
              {smitheyAvg}h
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Selery</div>
            <div className={`text-xl font-bold tabular-nums ${
              seleryAvg <= 24 ? "text-status-good" : seleryAvg <= 48 ? "text-status-warning" : "text-status-bad"
            }`}>
              {seleryAvg}h
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="displayDate"
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
                width={40}
                domain={[0, Math.ceil(maxLeadTime)]}
                tickFormatter={(v) => `${Math.round(v)}h`}
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
                formatter={(value: number, name: string) => [
                  <span key="v" className="font-semibold tabular-nums">{Math.round(value)}h</span>,
                  name === "smithey" ? "Smithey" : "Selery"
                ]}
              />
              {/* Target lines */}
              <ReferenceLine y={24} stroke="#10B981" strokeDasharray="4 4" strokeWidth={1} />
              <ReferenceLine y={48} stroke="#F59E0B" strokeDasharray="4 4" strokeWidth={1} />
              {/* Data lines */}
              <Line
                type="monotone"
                dataKey="smithey"
                name="smithey"
                stroke="#0EA5E9"
                strokeWidth={2.5}
                dot={{ fill: "#0EA5E9", r: 3, strokeWidth: 0 }}
                activeDot={{ fill: "#0EA5E9", r: 5, strokeWidth: 2, stroke: "#0F172A" }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="selery"
                name="selery"
                stroke="#8B5CF6"
                strokeWidth={2.5}
                dot={{ fill: "#8B5CF6", r: 3, strokeWidth: 0 }}
                activeDot={{ fill: "#8B5CF6", r: 5, strokeWidth: 2, stroke: "#0F172A" }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex items-center justify-center gap-8 mt-4 pt-4 border-t border-border/30">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-0.5 rounded-full bg-[#0EA5E9]" />
              <span className="text-text-muted">Smithey</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-0.5 rounded-full bg-[#8B5CF6]" />
              <span className="text-text-muted">Selery</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Target className="w-3 h-3 text-status-good" />
              <span className="text-text-muted">24h target</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle className="w-3 h-3 text-status-warning" />
              <span className="text-text-muted">48h threshold</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
