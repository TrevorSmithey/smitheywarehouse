"use client";

import { useState, useEffect, useCallback } from "react";
import { format, formatDistanceToNow, startOfDay, subDays } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Package,
  Truck,
  Clock,
  MapPin,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import type {
  MetricsResponse,
  WarehouseMetrics,
  DailyFulfillment,
  DailyOrders,
  StuckShipment,
  FulfillmentLeadTime,
  TransitAnalytics,
  SkuInQueue,
} from "@/lib/types";

type DateRangeOption = "today" | "3days" | "7days" | "30days" | "custom";

// Calculate date range bounds based on selection
function getDateBounds(option: DateRangeOption, customStart?: Date, customEnd?: Date): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (option) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "3days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 2);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "7days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "30days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case "custom": {
      if (customStart && customEnd) {
        const start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
        const endDate = new Date(customEnd);
        endDate.setHours(23, 59, 59, 999);
        return { start, end: endDate };
      }
      // Default to 7 days if no custom dates
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
  }
}

function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return "0";
  return num.toLocaleString("en-US");
}

// Calculate percentage change
function getChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Global date range state
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>("7days");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);

      // Calculate date bounds for the selected range
      const customStart = customStartDate ? new Date(customStartDate) : undefined;
      const customEnd = customEndDate ? new Date(customEndDate) : undefined;
      const { start, end } = getDateBounds(dateRangeOption, customStart, customEnd);

      // Build query string with date range
      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
      });

      const res = await fetch(`/api/metrics?${params}`);
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const data: MetricsResponse = await res.json();
      setMetrics(data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [dateRangeOption, customStartDate, customEndDate]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    const interval = setInterval(fetchMetrics, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Aggregate totals across warehouses
  const totals = metrics?.warehouses?.reduce(
    (acc, wh) => ({
      queue: acc.queue + wh.unfulfilled_count + wh.partial_count,
      today: acc.today + wh.fulfilled_today,
      week: acc.week + wh.fulfilled_this_week,
      lastWeek: acc.lastWeek + wh.fulfilled_last_week,
      avg7d: acc.avg7d + wh.avg_per_day_7d,
      avg30d: acc.avg30d + wh.avg_per_day_30d,
    }),
    { queue: 0, today: 0, week: 0, lastWeek: 0, avg7d: 0, avg30d: 0 }
  ) || { queue: 0, today: 0, week: 0, lastWeek: 0, avg7d: 0, avg30d: 0 };

  // Calculate change indicators
  const todayVsAvg = getChange(totals.today, totals.avg7d);
  const weekOverWeek = getChange(totals.week, totals.lastWeek);
  const avgTrend = getChange(totals.avg7d, totals.avg30d);

  const stuckCount = metrics?.stuckShipments?.length || 0;
  const chartData = processChartData(metrics?.daily || []);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-label font-medium text-text-tertiary tracking-wide-sm">
              SMITHEY WAREHOUSE
            </h1>
            <p className="text-context text-text-muted mt-1">
              {lastRefresh
                ? `Updated ${formatDistanceToNow(lastRefresh, { addSuffix: true })}`
                : "Loading..."}
            </p>
          </div>
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="p-2 text-text-tertiary hover:text-accent-blue transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Date Range Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {(["today", "3days", "7days", "30days", "custom"] as DateRangeOption[]).map((option) => {
              const labels: Record<DateRangeOption, string> = {
                today: "Today",
                "3days": "3 Days",
                "7days": "7 Days",
                "30days": "30 Days",
                custom: "Custom",
              };
              return (
                <button
                  key={option}
                  onClick={() => setDateRangeOption(option)}
                  className={`px-3 py-1.5 text-sm font-medium transition-all border rounded ${
                    dateRangeOption === option
                      ? "bg-accent-blue text-white border-accent-blue"
                      : "bg-transparent text-text-secondary border-border hover:border-border-hover hover:text-text-primary"
                  }`}
                >
                  {labels[option]}
                </button>
              );
            })}
          </div>

          {/* Custom Date Inputs */}
          {dateRangeOption === "custom" && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-text-tertiary" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:border-accent-blue focus:outline-none"
              />
              <span className="text-text-muted">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2 py-1.5 text-sm bg-bg-secondary border border-border rounded text-text-primary focus:border-accent-blue focus:outline-none"
              />
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-status-bad/10 border border-status-bad/30 rounded text-status-bad text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards - with change indicators like Lathe app */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="IN QUEUE"
          value={totals.queue}
          loading={loading}
          status={totals.queue > 500 ? "warning" : undefined}
        />
        <KPICard
          label="SHIPPED TODAY"
          value={totals.today}
          loading={loading}
          status="good"
          change={todayVsAvg}
          changeLabel="vs avg"
        />
        <KPICard
          label="THIS WEEK"
          value={totals.week}
          loading={loading}
          change={weekOverWeek}
          changeLabel="vs last week"
        />
        <KPICard
          label="AVG / DAY"
          value={Math.round(totals.avg7d)}
          loading={loading}
          change={avgTrend}
          changeLabel="vs 30d avg"
          subtitle="7-day average"
        />
      </div>

      {/* Warehouse Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {metrics?.warehouses?.map((wh) => (
          <WarehousePanel
            key={wh.warehouse}
            data={wh}
            queueHealth={metrics.queueHealth?.find(
              (q) => q.warehouse === wh.warehouse
            )}
            transitData={metrics.transitAnalytics?.find(
              (t) => t.warehouse === wh.warehouse
            )}
            loading={loading}
          />
        ))}
      </div>

      {/* Stuck Shipments Alert */}
      {stuckCount > 0 && (
        <StuckShipmentsPanel shipments={metrics?.stuckShipments || []} />
      )}

      {/* Fulfillment Lead Time Analytics */}
      <FulfillmentLeadTimePanel
        data={metrics?.fulfillmentLeadTime || []}
        loading={loading}
      />

      {/* Two-column layout: Chart + Top SKUs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Fulfillment Trend Chart */}
        <div className="lg:col-span-2 bg-bg-secondary rounded border border-border p-6 transition-all hover:border-border-hover">
          <div className="mb-6">
            <h3 className="text-label font-medium text-text-tertiary">
              FULFILLMENT TREND
            </h3>
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="smitheyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="seleryGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#64748B" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#64748B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  stroke="#64748B"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="#64748B"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={35}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#12151F",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "4px",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "#94A3B8" }}
                  itemStyle={{ color: "#FFFFFF" }}
                />
                <Area
                  type="monotone"
                  dataKey="Smithey"
                  stroke="#0EA5E9"
                  strokeWidth={2}
                  fill="url(#smitheyGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="Selery"
                  stroke="#64748B"
                  strokeWidth={2}
                  fill="url(#seleryGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">
              No data available
            </div>
          )}
          <div className="flex justify-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-accent-blue" />
              <span className="text-context text-text-secondary">Smithey</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-text-tertiary" />
              <span className="text-context text-text-secondary">Selery</span>
            </div>
          </div>
        </div>

        {/* Top SKUs in Queue */}
        <TopSkusPanel skus={metrics?.topSkusInQueue || []} loading={loading} />
      </div>

      {/* Transit Analytics */}
      <TransitAnalyticsPanel analytics={metrics?.transitAnalytics || []} />
    </div>
  );
}

function KPICard({
  label,
  value,
  loading,
  status,
  subtitle,
  change,
  changeLabel,
}: {
  label: string;
  value: number;
  loading: boolean;
  status?: "good" | "warning" | "bad";
  subtitle?: string;
  change?: number;
  changeLabel?: string;
}) {
  const statusColors = {
    good: "text-status-good",
    warning: "text-status-warning",
    bad: "text-status-bad",
  };

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 transition-all duration-200 hover:border-border-hover hover:shadow-card-hover hover:-translate-y-px">
      <div className="text-label text-text-tertiary font-medium mb-2">
        {label}
      </div>
      <div
        className={`text-metric font-light tracking-tight-sm ${
          status ? statusColors[status] : "text-text-primary"
        }`}
      >
        {loading ? "—" : formatNumber(value)}
      </div>
      {/* Change indicator - like Lathe app */}
      {change !== undefined && !loading && (
        <div className="text-context text-text-secondary mt-1">
          <span
            className={
              change > 0
                ? "text-status-good"
                : change < 0
                ? "text-status-bad"
                : "text-text-tertiary"
            }
          >
            {change > 0 ? "↑" : change < 0 ? "↓" : "→"}{" "}
            {Math.abs(change).toFixed(1)}%
          </span>
          {changeLabel && (
            <span className="text-text-muted ml-1">{changeLabel}</span>
          )}
        </div>
      )}
      {subtitle && !change && (
        <div className="text-context text-text-muted mt-1">{subtitle}</div>
      )}
    </div>
  );
}

function WarehousePanel({
  data,
  queueHealth,
  transitData,
  loading,
}: {
  data: WarehouseMetrics;
  queueHealth?: {
    waiting_1_day: number;
    waiting_3_days: number;
    waiting_7_days: number;
    oldest_order_name: string | null;
    oldest_order_days: number;
  };
  transitData?: TransitAnalytics;
  loading: boolean;
}) {
  const name = data.warehouse.toUpperCase();
  const isSmithey = data.warehouse === "smithey";
  const weekChange = data.week_over_week_change;

  return (
    <div className="bg-bg-secondary rounded border border-border overflow-hidden transition-all hover:border-border-hover">
      {/* Header */}
      <div
        className={`px-6 py-4 border-b border-border flex items-center justify-between ${
          isSmithey
            ? "border-l-2 border-l-accent-blue"
            : "border-l-2 border-l-text-tertiary"
        }`}
      >
        <span className="text-label font-medium text-text-primary tracking-wide-sm">
          {name}
        </span>
        <div className="flex items-center gap-1 text-context">
          {weekChange > 0 ? (
            <TrendingUp className="w-3.5 h-3.5 text-status-good" />
          ) : weekChange < 0 ? (
            <TrendingDown className="w-3.5 h-3.5 text-status-bad" />
          ) : null}
          <span
            className={
              weekChange > 0
                ? "text-status-good"
                : weekChange < 0
                ? "text-status-bad"
                : "text-text-tertiary"
            }
          >
            {weekChange > 0 ? "+" : ""}
            {weekChange}% vs last week
          </span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="p-6">
        <div className="grid grid-cols-4 gap-6 mb-6">
          <div>
            <div className="text-3xl font-light text-text-primary">
              {loading ? "—" : formatNumber(data.unfulfilled_count)}
            </div>
            <div className="text-label text-text-tertiary flex items-center gap-1 mt-2">
              <Package className="w-3 h-3" />
              Unfulfilled
            </div>
          </div>
          <div>
            <div
              className={`text-3xl font-light ${
                data.partial_count > 0
                  ? "text-status-warning"
                  : "text-text-primary"
              }`}
            >
              {loading ? "—" : formatNumber(data.partial_count)}
            </div>
            <div className="text-label text-text-tertiary flex items-center gap-1 mt-2">
              <Clock className="w-3 h-3" />
              Partial
            </div>
          </div>
          <div>
            <div className="text-3xl font-light text-status-good">
              {loading ? "—" : formatNumber(data.fulfilled_today)}
            </div>
            <div className="text-label text-text-tertiary mt-2">Today</div>
          </div>
          <div>
            <div className="text-3xl font-light text-text-primary">
              {loading ? "—" : formatNumber(data.avg_per_day_7d)}
            </div>
            <div className="text-label text-text-tertiary mt-2">Avg/Day</div>
          </div>
        </div>

        {/* Queue Aging */}
        {queueHealth && (
          <div className="bg-bg-tertiary rounded p-4 mb-4">
            <div className="text-label text-text-tertiary mb-3">
              QUEUE AGING
            </div>
            <div className="flex gap-6">
              <div>
                <span className="text-xl font-light text-text-primary">
                  {queueHealth.waiting_1_day}
                </span>
                <span className="text-context text-text-muted ml-1">
                  &gt;1d
                </span>
              </div>
              <div>
                <span
                  className={`text-xl font-light ${
                    queueHealth.waiting_3_days > 0
                      ? "text-status-warning"
                      : "text-text-primary"
                  }`}
                >
                  {queueHealth.waiting_3_days}
                </span>
                <span className="text-context text-text-muted ml-1">
                  &gt;3d
                </span>
              </div>
              <div>
                <span
                  className={`text-xl font-light ${
                    queueHealth.waiting_7_days > 0
                      ? "text-status-bad"
                      : "text-text-primary"
                  }`}
                >
                  {queueHealth.waiting_7_days}
                </span>
                <span className="text-context text-text-muted ml-1">
                  &gt;7d
                </span>
              </div>
            </div>
            {queueHealth.oldest_order_name && (
              <div className="text-context text-text-muted mt-3">
                Oldest:{" "}
                <span className="text-text-secondary">
                  {queueHealth.oldest_order_name}
                </span>
                <span className="text-status-bad ml-1">
                  ({queueHealth.oldest_order_days}d)
                </span>
              </div>
            )}
          </div>
        )}

        {/* Transit Time */}
        {transitData && transitData.total_delivered > 0 && (
          <div className="bg-bg-tertiary rounded p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-label text-text-tertiary flex items-center gap-1">
                <Truck className="w-3 h-3" />
                AVG TRANSIT
              </div>
              <div className="text-context">
                <span className="text-text-primary font-medium">
                  {transitData.avg_transit_days}
                </span>
                <span className="text-text-muted ml-1">days</span>
              </div>
            </div>
            <div className="text-context text-text-muted">
              {transitData.total_delivered.toLocaleString()} deliveries tracked
            </div>
          </div>
        )}
      </div>
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
  // Split by warehouse
  const smitheySkus = skus.filter((s) => s.warehouse === "smithey").slice(0, 8);
  const selerySkus = skus.filter((s) => s.warehouse === "selery").slice(0, 8);

  const SkuTable = ({ items, warehouse }: { items: SkuInQueue[]; warehouse: string }) => (
    <div>
      <div className={`text-label font-medium mb-3 ${
        warehouse === "smithey" ? "text-accent-blue" : "text-text-tertiary"
      }`}>
        {warehouse.toUpperCase()}
      </div>
      {items.length > 0 ? (
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 text-label text-text-tertiary opacity-50 font-medium">
                ITEM
              </th>
              <th className="text-right py-1.5 text-label text-text-tertiary opacity-50 font-medium">
                QTY
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((sku) => (
              <tr
                key={`${sku.warehouse}-${sku.sku}`}
                className="border-b border-border-subtle hover:bg-white/[0.02] transition-all"
              >
                <td className="py-2 text-context text-text-primary">
                  <div className="truncate max-w-[140px]" title={sku.title || sku.sku}>
                    {sku.title || sku.sku}
                  </div>
                </td>
                <td className="py-2 text-right text-context text-text-secondary">
                  {formatNumber(sku.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-context text-text-muted py-2">Queue clear</div>
      )}
    </div>
  );

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 transition-all hover:border-border-hover">
      <h3 className="text-label font-medium text-text-tertiary mb-4">
        TOP ITEMS IN QUEUE
      </h3>
      {loading ? (
        <div className="text-text-muted text-sm">Loading...</div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <SkuTable items={smitheySkus} warehouse="smithey" />
          <SkuTable items={selerySkus} warehouse="selery" />
        </div>
      )}
    </div>
  );
}

function FulfillmentLeadTimePanel({
  data,
  loading,
}: {
  data: FulfillmentLeadTime[];
  loading: boolean;
}) {
  const smithey = data.find((d) => d.warehouse === "smithey");
  const selery = data.find((d) => d.warehouse === "selery");

  const WarehouseLeadTime = ({
    wh,
    name,
    color,
  }: {
    wh: FulfillmentLeadTime | undefined;
    name: string;
    color: string;
  }) => {
    if (!wh || wh.total_fulfilled === 0) {
      return (
        <div className={`p-4 rounded bg-bg-tertiary border-l-2 ${color}`}>
          <div className="text-label text-text-tertiary mb-2">{name}</div>
          <div className="text-context text-text-muted">No data available</div>
        </div>
      );
    }

    return (
      <div className={`p-4 rounded bg-bg-tertiary border-l-2 ${color}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-label text-text-tertiary">{name}</div>
          <div className="flex items-center gap-1 text-context">
            {wh.trend_pct !== 0 && (
              <>
                <span
                  className={
                    wh.trend_pct < 0
                      ? "text-status-good"
                      : "text-status-warning"
                  }
                >
                  {wh.trend_pct > 0 ? "↑" : "↓"} {Math.abs(wh.trend_pct)}%
                </span>
                <span className="text-text-muted">vs last week</span>
              </>
            )}
          </div>
        </div>

        {/* Main Metric */}
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-3xl font-light text-text-primary">
            {wh.avg_hours < 24
              ? `${wh.avg_hours}h`
              : `${wh.avg_days}d`}
          </span>
          <span className="text-context text-text-muted">avg lead time</span>
        </div>

        {/* SLA Distribution */}
        <div className="space-y-2">
          <div className="text-label text-text-tertiary opacity-75 mb-1">
            SLA BREAKDOWN
          </div>
          <div className="flex gap-4 text-context">
            <div>
              <span className="text-status-good font-medium">{wh.within_24h}%</span>
              <span className="text-text-muted ml-1">&lt;24h</span>
            </div>
            <div>
              <span className="text-text-primary font-medium">{wh.within_48h}%</span>
              <span className="text-text-muted ml-1">&lt;48h</span>
            </div>
            <div>
              <span
                className={`font-medium ${
                  wh.over_72h > 10 ? "text-status-warning" : "text-text-secondary"
                }`}
              >
                {wh.over_72h}%
              </span>
              <span className="text-text-muted ml-1">&gt;72h</span>
            </div>
          </div>
        </div>

        <div className="text-context text-text-muted mt-3 pt-3 border-t border-border-subtle">
          {wh.total_fulfilled.toLocaleString()} orders (30d)
        </div>
      </div>
    );
  };

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 mb-6 transition-all hover:border-border-hover">
      <h3 className="text-label font-medium text-text-tertiary mb-4 flex items-center gap-2">
        <Clock className="w-3.5 h-3.5" />
        ORDER TO FULFILLMENT TIME
      </h3>
      {loading ? (
        <div className="text-text-muted text-sm">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <WarehouseLeadTime
            wh={smithey}
            name="SMITHEY"
            color="border-l-accent-blue"
          />
          <WarehouseLeadTime
            wh={selery}
            name="SELERY"
            color="border-l-text-tertiary"
          />
        </div>
      )}
    </div>
  );
}

function StuckShipmentsPanel({ shipments }: { shipments: StuckShipment[] }) {
  const smithey = shipments.filter((s) => s.warehouse === "smithey");
  const selery = shipments.filter((s) => s.warehouse === "selery");

  const renderShipment = (s: StuckShipment) => (
    <div
      key={`${s.order_id}-${s.tracking_number}`}
      className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0"
    >
      <div className="min-w-0">
        <div className="text-context text-text-primary">{s.order_name}</div>
        <div className="text-label text-text-muted truncate">
          {s.carrier}: {s.tracking_number}
        </div>
      </div>
      <div className="text-right flex-shrink-0 ml-4">
        <div
          className={`text-context font-medium ${
            s.days_without_scan >= 7
              ? "text-status-bad"
              : s.days_without_scan >= 5
              ? "text-status-warning"
              : "text-text-primary"
          }`}
        >
          {s.days_without_scan}d
        </div>
        <div className="text-label text-text-muted">no scan</div>
      </div>
    </div>
  );

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 mb-6">
      <h3 className="text-label font-medium text-status-warning mb-4 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5" />
        STUCK SHIPMENTS — NO SCANS 3+ DAYS
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-label text-text-tertiary mb-3">
            SMITHEY ({smithey.length})
          </div>
          {smithey.length > 0 ? (
            smithey.slice(0, 5).map(renderShipment)
          ) : (
            <div className="text-context text-text-muted py-2">All clear</div>
          )}
        </div>
        <div>
          <div className="text-label text-text-tertiary mb-3">
            SELERY ({selery.length})
          </div>
          {selery.length > 0 ? (
            selery.slice(0, 5).map(renderShipment)
          ) : (
            <div className="text-context text-text-muted py-2">All clear</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TransitAnalyticsPanel({
  analytics,
}: {
  analytics: TransitAnalytics[];
}) {
  const hasData = analytics.some((a) => a.total_delivered > 0);
  if (!hasData) return null;

  return (
    <div className="bg-bg-secondary rounded border border-border p-6">
      <h3 className="text-label font-medium text-text-tertiary mb-4 flex items-center gap-2">
        <MapPin className="w-3.5 h-3.5" />
        TRANSIT TIME BY STATE
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {analytics.map((wh) => (
          <div key={wh.warehouse}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-label font-medium text-text-secondary uppercase">
                {wh.warehouse}
              </div>
              <div className="text-context text-text-muted">
                Avg:{" "}
                <span className="text-text-primary">{wh.avg_transit_days}d</span>
              </div>
            </div>
            {wh.by_state.length > 0 ? (
              <div className="space-y-2">
                {wh.by_state.slice(0, 6).map((state) => (
                  <div
                    key={state.state}
                    className="flex items-center justify-between text-context py-1.5"
                  >
                    <span className="text-text-secondary">{state.state}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-text-muted">
                        {state.shipment_count} shipments
                      </span>
                      <span
                        className={`font-medium ${
                          state.avg_transit_days > 5
                            ? "text-status-warning"
                            : "text-text-primary"
                        }`}
                      >
                        {state.avg_transit_days}d
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-context text-text-muted py-2">
                No delivery data yet
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function processChartData(daily: DailyFulfillment[]) {
  const grouped = new Map<string, { Smithey: number; Selery: number }>();

  for (const item of daily) {
    const existing = grouped.get(item.date) || { Smithey: 0, Selery: 0 };
    if (item.warehouse === "smithey") {
      existing.Smithey = item.count;
    } else if (item.warehouse === "selery") {
      existing.Selery = item.count;
    }
    grouped.set(item.date, existing);
  }

  return Array.from(grouped.entries())
    .map(([date, counts]) => ({
      date: format(new Date(date), "M/d"),
      rawDate: date,
      ...counts,
    }))
    .sort((a, b) => a.rawDate.localeCompare(b.rawDate));
}
