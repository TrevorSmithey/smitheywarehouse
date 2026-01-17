"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Truck } from "lucide-react";
import { formatNumber } from "@/lib/dashboard-utils";

interface FulfillmentTrendProps {
  chartData: Array<{
    date: string;
    rawDate: string;
    Smithey: number;
    Selery: number;
  }>;
  dailyOrders: Array<{
    date: string;
    smithey_pct: number;
    total: number;
  }>;
  loading: boolean;
}

export function FulfillmentTrend({ chartData, dailyOrders, loading }: FulfillmentTrendProps) {
  // Calculate distribution stats
  const avgSmithey = dailyOrders.length > 0
    ? Math.round(dailyOrders.reduce((sum, d) => sum + d.smithey_pct, 0) / dailyOrders.length)
    : 50;

  // Merge fulfillment data with warehouse split percentages
  const splitByDate = new Map(dailyOrders.map(d => [d.date, { smitheyPct: d.smithey_pct, total: d.total }]));
  const combinedData = chartData.map(d => {
    const split = splitByDate.get(d.rawDate);
    return {
      ...d,
      Total: d.Smithey + d.Selery,
      SmitheyPct: split?.smitheyPct ?? null,
    };
  });

  // Calculate totals for summary
  const totalShipped = combinedData.reduce((sum, d) => sum + d.Total, 0);
  const totalSmithey = combinedData.reduce((sum, d) => sum + d.Smithey, 0);
  const totalSelery = combinedData.reduce((sum, d) => sum + d.Selery, 0);

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6 transition-all hover:border-border-hover">
      {/* Header with stats */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted flex items-center gap-2">
            <Truck className="w-3.5 h-3.5" />
            FULFILLMENT VOLUME
          </h3>
          <p className="text-xs text-text-muted mt-1">Daily shipments by warehouse</p>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-text-primary">
              {formatNumber(totalShipped)}
            </div>
            <div className="text-xs text-text-muted">total shipped</div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[#0EA5E9]" />
              <span className="text-sm text-text-secondary">{avgSmithey}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[#8B5CF6]" />
              <span className="text-sm text-text-secondary">{100 - avgSmithey}%</span>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-[260px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : combinedData.length > 0 ? (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={combinedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
              <XAxis
                dataKey="date"
                stroke="#64748B"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: "#1E293B" }}
                dy={8}
              />
              <YAxis
                yAxisId="left"
                stroke="#64748B"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={45}
                tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#64748B"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={40}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(15, 23, 42, 0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
                }}
                labelStyle={{ color: "#94A3B8", marginBottom: "4px", fontWeight: 500 }}
                formatter={(value: number, name: string) => {
                  if (name === "SmitheyPct") {
                    return [<span key="v" style={{ color: "#F59E0B", fontWeight: 600 }}>{value}%</span>, "Smithey %"];
                  }
                  const color = name === "Smithey" ? "#0EA5E9" : "#8B5CF6";
                  return [<span key="v" style={{ color, fontWeight: 600 }}>{formatNumber(value)}</span>, name];
                }}
              />
              <ReferenceLine yAxisId="right" y={50} stroke="#334155" strokeDasharray="3 3" />
              <Bar
                yAxisId="left"
                dataKey="Smithey"
                fill="#0EA5E9"
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
              />
              <Bar
                yAxisId="left"
                dataKey="Selery"
                fill="#8B5CF6"
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="SmitheyPct"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={{ fill: "#F59E0B", r: 2.5, strokeWidth: 0 }}
                activeDot={{ fill: "#F59E0B", r: 4, strokeWidth: 2, stroke: "#0F172A" }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex items-center justify-center gap-8 mt-4 pt-4 border-t border-border/30">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded-sm bg-[#0EA5E9]" />
              <span className="text-text-muted">Smithey ({formatNumber(totalSmithey)})</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded-sm bg-[#8B5CF6]" />
              <span className="text-text-muted">Selery ({formatNumber(totalSelery)})</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-5 h-0.5 bg-amber-500 rounded" />
              <span className="text-text-muted">Smithey % split</span>
            </div>
          </div>
        </>
      ) : (
        <div className="h-[260px] flex items-center justify-center text-text-muted text-sm">
          No data available
        </div>
      )}
    </div>
  );
}
