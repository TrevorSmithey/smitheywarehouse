"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  AreaChart,
  Area,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Package, Clock, Truck } from "lucide-react";
import { SmitheyPageLoader } from "@/components/SmitheyLoader";
import type {
  MetricsResponse,
  DailyFulfillment,
  SkuInQueue,
  OrderAging,
  DailyBacklog,
} from "@/lib/types";
import {
  formatNumber,
  parseLocalDate,
  getDaysInRange,
  type DateRangeOption,
} from "@/lib/dashboard-utils";

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function SkuTable({ items, warehouse }: { items: SkuInQueue[]; warehouse: string }) {
  return (
    <div>
      <div className={`text-label font-medium mb-3 ${
        warehouse === "smithey" ? "text-accent-blue" : "text-text-tertiary"
      }`}>
        {warehouse.toUpperCase()}
      </div>
      {items.length > 0 ? (
        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-secondary">
              <tr className="border-b border-border">
                <th className="text-left py-1.5 text-label text-text-tertiary opacity-50 font-medium">
                  SKU
                </th>
                <th className="text-right py-1.5 text-label text-text-tertiary opacity-50 font-medium">
                  QTY
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={`${item.warehouse}-${item.sku}-${idx}`}
                  className="border-b border-border-subtle hover:bg-white/[0.02] transition-all"
                >
                  <td className="py-2 text-context text-text-primary">
                    <div className="truncate max-w-[200px]" title={item.title || item.sku}>
                      {item.sku}
                    </div>
                  </td>
                  <td className="py-2 text-right text-context text-text-secondary tabular-nums">
                    {formatNumber(item.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-context text-text-muted py-2">Queue clear</div>
      )}
    </div>
  );
}

function TopSkusPanel({
  skus,
  loading,
}: {
  skus: SkuInQueue[];
  loading: boolean;
}) {
  const smitheySkus = skus.filter((s) => s.warehouse === "smithey");
  const selerySkus = skus.filter((s) => s.warehouse === "selery");

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 mt-6 transition-all hover:border-border-hover">
      <h3 className="text-label font-medium text-text-tertiary mb-4">
        TOP SKUS IN QUEUE
      </h3>
      {loading ? (
        <div className="text-text-muted text-sm">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SkuTable items={smitheySkus} warehouse="smithey" />
          <SkuTable items={selerySkus} warehouse="selery" />
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-bg-secondary rounded border border-border px-5 py-3 hover:border-border-hover transition-all"
      >
        <span className="text-label font-medium text-text-tertiary">{title}</span>
        <svg
          className={`w-4 h-4 text-text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && <div className="mt-2">{children}</div>}
    </div>
  );
}

function OrderAgingChart({
  aging,
  loading,
}: {
  aging: OrderAging[];
  loading: boolean;
}) {
  // Calculate totals
  const totalSmithey = aging.reduce((sum, d) => sum + d.smithey, 0);
  const totalSelery = aging.reduce((sum, d) => sum + d.selery, 0);
  const totalOrders = totalSmithey + totalSelery;

  // Find max for each warehouse separately for better visual balance
  const maxSmithey = Math.max(...aging.map(d => d.smithey), 1);
  const maxSelery = Math.max(...aging.map(d => d.selery), 1);

  if (aging.length === 0 || totalOrders === 0) return null;

  const AgingRow = ({
    bucket,
    isLast
  }: {
    bucket: OrderAging;
    isLast: boolean;
  }) => {
    const isDanger = bucket.bucket === "5+d";
    const smitheyBarPct = (bucket.smithey / maxSmithey) * 100;
    const seleryBarPct = (bucket.selery / maxSelery) * 100;
    // Percentage of total queue for each warehouse
    const smitheyOfTotal = totalSmithey > 0 ? Math.round((bucket.smithey / totalSmithey) * 100) : 0;
    const seleryOfTotal = totalSelery > 0 ? Math.round((bucket.selery / totalSelery) * 100) : 0;

    return (
      <div className={`grid grid-cols-[1fr_auto_1fr] gap-3 items-center py-2 ${
        !isLast ? "border-b border-border-subtle" : ""
      }`}>
        {/* Smithey - right aligned bar */}
        <div className="flex items-center justify-end gap-3">
          <span className={`text-sm tabular-nums ${
            isDanger && bucket.smithey > 0 ? "text-status-bad" : "text-text-secondary"
          }`}>
            {formatNumber(bucket.smithey)}
            <span className="text-text-muted ml-1 text-xs">({smitheyOfTotal}%)</span>
          </span>
          <div className="w-32 h-5 bg-bg-tertiary/50 rounded-sm overflow-hidden flex justify-end">
            <div
              className={`h-full rounded-sm transition-all duration-500 ease-out ${
                isDanger ? "bg-status-bad/70" : "bg-accent-blue/70"
              }`}
              style={{ width: `${smitheyBarPct}%` }}
            />
          </div>
        </div>

        {/* Center label */}
        <div className={`w-12 text-center text-xs font-semibold tracking-wide ${
          isDanger ? "text-status-bad" : "text-text-tertiary"
        }`}>
          {bucket.bucket}
        </div>

        {/* Selery - left aligned bar */}
        <div className="flex items-center gap-3">
          <div className="w-32 h-5 bg-bg-tertiary/50 rounded-sm overflow-hidden">
            <div
              className={`h-full rounded-sm transition-all duration-500 ease-out ${
                isDanger ? "bg-status-bad/70" : "bg-slate-500/70"
              }`}
              style={{ width: `${seleryBarPct}%` }}
            />
          </div>
          <span className={`text-sm tabular-nums ${
            isDanger && bucket.selery > 0 ? "text-status-bad" : "text-text-secondary"
          }`}>
            {formatNumber(bucket.selery)}
            <span className="text-text-muted ml-1 text-xs">({seleryOfTotal}%)</span>
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 transition-all hover:border-border-hover">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-label font-medium text-text-tertiary flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" />
          QUEUE AGING
        </h3>
      </div>

      {loading ? (
        <div className="h-[160px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 mb-2">
            <div className="flex items-center justify-end gap-3">
              <span className="text-xs font-medium text-accent-blue tracking-wide">
                SMITHEY
              </span>
              <span className="text-lg font-light text-accent-blue tabular-nums">
                {formatNumber(totalSmithey)}
              </span>
            </div>
            <div className="w-12" />
            <div className="flex items-center gap-3">
              <span className="text-lg font-light text-text-tertiary tabular-nums">
                {formatNumber(totalSelery)}
              </span>
              <span className="text-xs font-medium text-text-tertiary tracking-wide">
                SELERY
              </span>
            </div>
          </div>

          {/* Aging rows */}
          <div className="mt-3">
            {aging.map((bucket, idx) => (
              <AgingRow
                key={bucket.bucket}
                bucket={bucket}
                isLast={idx === aging.length - 1}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BacklogChart({
  backlog,
  loading,
}: {
  backlog: DailyBacklog[];
  loading: boolean;
}) {
  // Use full date range from API (respects global date selector)
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

  // Calculate Y-axis domain with padding (don't start at 0 - show actual range)
  const backlogValues = chartData.map(d => d.backlog);
  const minBacklog = Math.min(...backlogValues);
  const maxBacklog = Math.max(...backlogValues);
  const padding = Math.max(100, (maxBacklog - minBacklog) * 0.1); // 10% padding or 100 minimum
  const yMin = Math.max(0, Math.floor((minBacklog - padding) / 100) * 100);
  const yMax = Math.ceil((maxBacklog + padding) / 100) * 100;

  return (
    <div className="bg-bg-secondary rounded border border-border p-4 mb-6 transition-all hover:border-border-hover">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-label font-medium text-text-tertiary flex items-center gap-2">
          <Package className="w-3.5 h-3.5" />
          BACKLOG
        </h3>
        <div className="flex items-center gap-4 text-context">
          <span className="text-text-primary font-medium">
            {formatNumber(currentBacklog)} orders
          </span>
          {change !== 0 && (
            <span className={change > 0 ? "text-status-bad" : "text-status-good"}>
              {change > 0 ? "+" : ""}{formatNumber(change)} ({changePercent > 0 ? "+" : ""}{changePercent}%)
            </span>
          )}
        </div>
      </div>
      {loading ? (
        <div className="h-[100px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="backlogGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#DC2626" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
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
              width={40}
              domain={[yMin, yMax]}
              tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#12151F",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "4px",
                fontSize: "11px",
              }}
              labelStyle={{ color: "#94A3B8" }}
              itemStyle={{ color: "#E2E8F0" }}
              formatter={(value: number, name: string) => {
                const colors: Record<string, string> = { backlog: "#DC2626", created: "#3B82F6", fulfilled: "#10B981" };
                const labels: Record<string, string> = { backlog: "Backlog", created: "Created", fulfilled: "Fulfilled" };
                if (name in colors) return [<span key="v" style={{ color: colors[name], fontWeight: 600 }}>{formatNumber(value)}</span>, labels[name]];
                return [value, name];
              }}
            />
            <Area
              type="monotone"
              dataKey="backlog"
              stroke="#DC2626"
              strokeWidth={2}
              fill="url(#backlogGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface FulfillmentDashboardProps {
  metrics: MetricsResponse | null;
  loading: boolean;
  dateRangeOption: DateRangeOption;
  onDateRangeChange: (option: DateRangeOption) => void;
  chartData: Array<{
    date: string;
    rawDate: string;
    Smithey: number;
    Selery: number;
  }>;
}

export function FulfillmentDashboard({
  metrics,
  loading,
  dateRangeOption,
  onDateRangeChange,
  chartData,
}: FulfillmentDashboardProps) {
  // Calculate totals
  const totals = {
    queue: (metrics?.warehouses || []).reduce((sum, w) => sum + w.unfulfilled_count + w.partial_count, 0),
    today: (metrics?.warehouses || []).reduce((sum, w) => sum + w.fulfilled_in_range, 0),
    avg7d: (metrics?.warehouses || []).reduce((sum, w) => sum + w.avg_per_day_7d, 0),
  };

  // Loading state with animated quail
  if (loading && !metrics) {
    return <SmitheyPageLoader />;
  }

  return (
    <>
      {/* Hero Section - Key metrics + engraving */}
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">FULFILLMENT OVERVIEW</h2>
          <div className="flex items-center gap-1">
            {(["today", "yesterday", "3days", "7days", "30days"] as const).map((option) => {
              const labels = { today: "Today", yesterday: "Yesterday", "3days": "3D", "7days": "7D", "30days": "30D" };
              return (
                <button
                  key={option}
                  onClick={() => onDateRangeChange(option)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${
                    dateRangeOption === option
                      ? "bg-accent-blue text-white"
                      : "text-text-tertiary hover:text-text-secondary hover:bg-white/5"
                  }`}
                >
                  {labels[option]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-6 md:gap-8">
          {/* 1. In Queue */}
          <div>
            <div className={`text-4xl font-bold tabular-nums ${totals.queue > 500 ? "text-status-warning" : "text-text-primary"}`}>
              {loading ? "—" : formatNumber(totals.queue)}
            </div>
            <div className="text-xs text-text-muted mt-1">IN QUEUE</div>
          </div>

          {/* 2. Avg Per Day */}
          {(() => {
            const daysInRange = getDaysInRange(dateRangeOption);
            const avgPerDay = daysInRange > 0 ? Math.round(totals.today / daysInRange) : 0;
            return (
              <div>
                <div className="text-4xl font-bold tabular-nums text-text-primary">
                  {loading || avgPerDay === 0 ? "—" : formatNumber(avgPerDay)}
                </div>
                <div className="text-xs text-text-muted mt-1">AVG/DAY</div>
              </div>
            );
          })()}

          {/* 3. Days to Clear - uses fixed T7 rolling average, NOT date-range-filtered */}
          {(() => {
            // Use fixed 7-day rolling average for days-to-clear calculation
            // This ensures the metric is stable and not affected by date range selection
            const daysToClear = totals.avg7d > 0 ? Math.round(totals.queue / totals.avg7d) : 0;
            return (
              <div>
                <div className={`text-4xl font-bold tabular-nums ${daysToClear > 5 ? "text-status-warning" : "text-text-primary"}`}>
                  {loading || totals.avg7d === 0 ? "—" : `~${daysToClear}d`}
                </div>
                <div className="text-xs text-text-muted mt-1">TO CLEAR</div>
              </div>
            );
          })()}

          {/* 4. Total Shipped */}
          {(() => {
            // Calculate comparison for single-day views (today or yesterday)
            const shippedInRange = totals.today;
            const vsAvg = totals.avg7d > 0 ? ((shippedInRange - totals.avg7d) / totals.avg7d) * 100 : undefined;
            const showComparison = (dateRangeOption === "today" || dateRangeOption === "yesterday") && vsAvg !== undefined && vsAvg !== 0;

            return (
              <div>
                <div className="text-4xl font-bold tabular-nums text-status-good">
                  {loading ? "—" : formatNumber(shippedInRange)}
                </div>
                <div className="text-xs mt-1">
                  <span className="text-text-muted">SHIPPED</span>
                  {showComparison && !loading && (
                    <span className={`ml-2 ${vsAvg > 0 ? "text-status-good" : "text-status-bad"}`}>
                      {vsAvg > 0 ? "↑" : "↓"}{Math.abs(vsAvg).toFixed(0)}% vs 7d avg
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 5. Engraving */}
          <div>
            <div className={`text-4xl font-bold tabular-nums ${(metrics?.engravingQueue?.estimated_days || 0) > 3 ? "text-status-warning" : "text-text-primary"}`}>
              {loading ? "—" : formatNumber(metrics?.engravingQueue?.total_units || 0)}
            </div>
            <div className="text-xs mt-1">
              <span className="text-text-muted">ENGRAVING</span>
              <span className={`ml-2 ${(metrics?.engravingQueue?.estimated_days || 0) > 3 ? "text-status-warning" : "text-text-secondary"}`}>
                ~{metrics?.engravingQueue?.estimated_days || 0}d
              </span>
              <span className="ml-2 text-text-tertiary">
                ({formatNumber(metrics?.engravingQueue?.order_count || 0)} orders)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Warehouse Cards - Combined metrics + speed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {metrics?.warehouses?.map((wh) => {
          const qh = metrics.queueHealth?.find(q => q.warehouse === wh.warehouse);
          const lt = metrics.fulfillmentLeadTime?.find(l => l.warehouse === wh.warehouse);
          const tr = metrics.transitAnalytics?.find(t => t.warehouse === wh.warehouse);
          const isSmithey = wh.warehouse === "smithey";
          const queueSize = wh.unfulfilled_count + wh.partial_count;
          // Use fixed 7-day rolling average for days-to-clear (stable, not affected by date range)
          const daysToClear = wh.avg_per_day_7d > 0 ? Math.round(queueSize / wh.avg_per_day_7d) : 0;

          return (
            <div key={wh.warehouse} className={`bg-bg-secondary rounded-xl border border-border/30 overflow-hidden transition-all hover:border-border-hover ${isSmithey ? "border-l-2 border-l-accent-blue" : "border-l-2 border-l-text-tertiary"}`}>
              {/* Header */}
              <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between">
                <span className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.15em] ${isSmithey ? "text-accent-blue" : "text-text-primary"}`}>{wh.warehouse.toUpperCase()}</span>
                {wh.week_over_week_change !== 0 && (
                  <span className={`text-xs tabular-nums ${wh.week_over_week_change > 0 ? "text-status-good" : "text-status-bad"}`}>
                    {wh.week_over_week_change > 0 ? "+" : ""}{wh.week_over_week_change.toFixed(1)}%
                  </span>
                )}
              </div>

              <div className="p-5">
                {/* Primary Metrics Row: Queue, Avg/Day, To Clear, Shipped, Today */}
                <div className="grid grid-cols-5 gap-4 mb-4">
                  <div>
                    <div className="text-2xl font-bold tabular-nums text-text-primary">{formatNumber(queueSize)}</div>
                    <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">QUEUE</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold tabular-nums text-text-primary">{formatNumber(Math.round(wh.avg_per_day_7d))}</div>
                    <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">AVG/DAY</div>
                  </div>
                  <div>
                    <div className={`text-2xl font-bold tabular-nums ${daysToClear > 5 ? "text-status-warning" : "text-text-primary"}`}>
                      {wh.avg_per_day_7d > 0 ? `~${daysToClear}d` : "—"}
                    </div>
                    <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">TO CLEAR</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold tabular-nums text-status-good">{formatNumber(wh.fulfilled_in_range)}</div>
                    <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">SHIPPED</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold tabular-nums text-accent-blue">{formatNumber(wh.fulfilled_today)}</div>
                    <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">TODAY</div>
                  </div>
                </div>

                {/* Smithey Queue Breakdown - Default vs Engraving */}
                {isSmithey && metrics?.engravingQueue && (
                  <div className="flex gap-4 mb-4 pb-4 border-b border-border/30">
                    <div>
                      <div className="text-lg font-bold tabular-nums text-text-primary">
                        {formatNumber(queueSize - metrics.engravingQueue.smithey_engraving_orders)}
                      </div>
                      <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">DEFAULT</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold tabular-nums text-accent-blue">
                        {formatNumber(metrics.engravingQueue.smithey_engraving_orders)}
                      </div>
                      <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">ENGRAVING</div>
                    </div>
                  </div>
                )}

                {/* Aging + Speed Row */}
                <div className="flex flex-wrap items-start justify-between gap-4 pt-4 border-t border-border/30">
                  {/* Aging */}
                  {qh && (() => {
                    const fresh = queueSize - qh.waiting_1_day;
                    const days1to3 = qh.waiting_1_day - qh.waiting_3_days;
                    const days3to7 = qh.waiting_3_days - qh.waiting_7_days;
                    const days7plus = qh.waiting_7_days;
                    return (
                      <div>
                        <div className="text-[9px] uppercase tracking-[0.15em] text-text-muted mb-2">AGING</div>
                        <div className="flex gap-3 text-xs">
                          <span><span className="text-status-good font-medium">{fresh}</span> <span className="text-text-muted">&lt;1d</span></span>
                          <span><span className="text-text-primary font-medium">{days1to3}</span> <span className="text-text-muted">1-3d</span></span>
                          <span><span className={days3to7 > 0 ? "text-status-warning font-medium" : "text-text-primary font-medium"}>{days3to7}</span> <span className="text-text-muted">3-7d</span></span>
                          <span><span className={days7plus > 0 ? "text-status-bad font-medium" : "text-text-primary font-medium"}>{days7plus}</span> <span className="text-text-muted">7d+</span></span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Speed */}
                  {lt && lt.total_fulfilled > 0 && (
                    <div>
                      <div className="text-[9px] uppercase tracking-[0.15em] text-text-muted mb-2">SPEED</div>
                      <div className="flex gap-3 text-xs">
                        <span>
                          <span className="text-text-primary font-medium">{lt.avg_hours < 24 ? `${lt.avg_hours}h` : `${lt.avg_days}d`}</span>
                          <span className="text-text-muted ml-1">avg</span>
                        </span>
                        <span><span className="text-status-good font-medium">{lt.within_24h}%</span> <span className="text-text-muted">&lt;24h</span></span>
                        <span><span className={lt.over_72h > 10 ? "text-status-warning font-medium" : "text-text-secondary font-medium"}>{lt.over_72h}%</span> <span className="text-text-muted">&gt;72h</span></span>
                        {tr && tr.total_delivered > 0 && (
                          <span><span className="text-text-primary font-medium">{tr.avg_transit_days}d</span> <span className="text-text-muted">transit</span></span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Section 4: Full-Width Fulfillment Chart */}
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-6 mb-6 transition-all hover:border-border-hover">
        {(() => {
          // Calculate distribution stats
          const dailyOrders = metrics?.dailyOrders || [];
          const avgSmithey = dailyOrders.length > 0
            ? Math.round(dailyOrders.reduce((sum, d) => sum + d.smithey_pct, 0) / dailyOrders.length)
            : 0;

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

          return (
            <>
              {/* Header with stats */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">FULFILLMENT TREND</h3>
                  <p className="text-xs text-text-muted mt-1">Daily shipments by warehouse</p>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-accent-blue" />
                    <span className="text-text-secondary">Smithey</span>
                    <span className="text-accent-blue font-medium">{avgSmithey}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-[#475569]" />
                    <span className="text-text-secondary">Selery</span>
                    <span className="text-text-tertiary font-medium">{100 - avgSmithey}%</span>
                  </div>
                </div>
              </div>

              {/* Chart - Grouped Bars + Distribution Line */}
              {combinedData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={combinedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
                    <XAxis
                      dataKey="date"
                      stroke="#64748B"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "#1E293B" }}
                      dy={8}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke="#64748B"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={45}
                      tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#64748B"
                      fontSize={11}
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
                        borderRadius: "6px",
                        fontSize: "12px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
                      }}
                      labelStyle={{ color: "#94A3B8", marginBottom: "4px", fontWeight: 500 }}
                      itemStyle={{ color: "#E2E8F0" }}
                      formatter={(value: number, name: string) => {
                        if (name === "SmitheyPct") return [<span key="v" style={{ color: "#F59E0B", fontWeight: 600 }}>{value}%</span>, "Smithey %"];
                        return [<span key="v" style={{ color: name === "Smithey" ? "#0EA5E9" : "#8B5CF6", fontWeight: 600 }}>{formatNumber(value)}</span>, name === "Smithey" ? "Smithey" : "Selery"];
                      }}
                    />
                    <ReferenceLine yAxisId="right" y={50} stroke="#334155" strokeDasharray="3 3" />
                    <Bar
                      yAxisId="left"
                      dataKey="Smithey"
                      fill="#0EA5E9"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={32}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="Selery"
                      fill="#475569"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={32}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="SmitheyPct"
                      stroke="#F59E0B"
                      strokeWidth={2.5}
                      dot={{ fill: "#F59E0B", r: 3, strokeWidth: 0 }}
                      activeDot={{ fill: "#F59E0B", r: 5, strokeWidth: 2, stroke: "#0F172A" }}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[240px] flex items-center justify-center text-text-muted text-sm">No data available</div>
              )}

              {/* Bottom legend */}
              <div className="flex items-center justify-center gap-8 mt-4 pt-4 border-t border-border-subtle">
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-sm bg-accent-blue" />
                  <span className="text-text-muted">Smithey</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-sm bg-[#475569]" />
                  <span className="text-text-muted">Selery</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-5 h-0.5 bg-amber-500 rounded" />
                  <span className="text-text-muted">Smithey %</span>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Section 5: Collapsible Details */}
      <CollapsibleSection title="QUEUE AGING" defaultOpen={false}>
        <OrderAgingChart aging={metrics?.orderAging || []} loading={loading} />
      </CollapsibleSection>

      <CollapsibleSection title="TOP SKUS IN QUEUE" defaultOpen={false}>
        <TopSkusPanel skus={metrics?.topSkusInQueue || []} loading={loading} />
      </CollapsibleSection>

      <CollapsibleSection title="BACKLOG TREND" defaultOpen={false}>
        <BacklogChart backlog={metrics?.dailyBacklog || []} loading={loading} />
      </CollapsibleSection>
    </>
  );
}
