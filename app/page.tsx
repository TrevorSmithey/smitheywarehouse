"use client";

import { useState, useEffect, useCallback } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  BarChart,
  Bar,
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
} from "lucide-react";
import type {
  MetricsResponse,
  WarehouseMetrics,
  DailyFulfillment,
  StuckShipment,
  TransitAnalytics,
} from "@/lib/types";

type DateRange = 7 | 14 | 30;

function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return "0";
  return num.toLocaleString("en-US");
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(7);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/metrics");
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
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    const interval = setInterval(fetchMetrics, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Totals
  const totals = metrics?.warehouses?.reduce(
    (acc, wh) => ({
      queue: acc.queue + wh.unfulfilled_count + wh.partial_count,
      today: acc.today + wh.fulfilled_today,
      week: acc.week + wh.fulfilled_this_week,
      avg: acc.avg + wh.avg_per_day_7d,
    }),
    { queue: 0, today: 0, week: 0, avg: 0 }
  ) || { queue: 0, today: 0, week: 0, avg: 0 };

  const stuckCount = metrics?.stuckShipments?.length || 0;
  const chartData = processChartData(metrics?.daily || [], dateRange);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-label font-medium text-text-tertiary tracking-wide-sm">
            WAREHOUSE FULFILLMENT
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
      </header>

      {error && (
        <div className="mb-6 p-4 bg-status-bad/10 border border-status-bad/30 rounded text-status-bad text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards - Match Lathe style */}
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
        />
        <KPICard
          label="THIS WEEK"
          value={totals.week}
          loading={loading}
        />
        <KPICard
          label="AVG / DAY"
          value={Math.round(totals.avg / 2)}
          loading={loading}
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

      {/* Fulfillment Trend Chart */}
      <div className="bg-bg-secondary rounded border border-border p-6 mb-6 transition-all hover:border-border-hover">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-label font-medium text-text-tertiary">
            FULFILLMENT TREND
          </h3>
          <div className="flex gap-2">
            {([7, 14, 30] as DateRange[]).map((days) => (
              <button
                key={days}
                onClick={() => setDateRange(days)}
                className={`px-3 py-1.5 text-sm font-medium transition-all border rounded ${
                  dateRange === days
                    ? "bg-accent-blue text-white border-accent-blue"
                    : "bg-transparent text-text-secondary border-border hover:border-border-hover hover:text-text-primary"
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barCategoryGap="20%">
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
                cursor={{ fill: "rgba(14, 165, 233, 0.1)" }}
              />
              <Bar
                dataKey="Smithey"
                fill="#0EA5E9"
                radius={[2, 2, 0, 0]}
                stackId="a"
              />
              <Bar
                dataKey="Selery"
                fill="#64748B"
                radius={[2, 2, 0, 0]}
                stackId="a"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">
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
}: {
  label: string;
  value: number;
  loading: boolean;
  status?: "good" | "warning" | "bad";
  subtitle?: string;
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
      {subtitle && (
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
          isSmithey ? "border-l-2 border-l-accent-blue" : "border-l-2 border-l-text-tertiary"
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
                data.partial_count > 0 ? "text-status-warning" : "text-text-primary"
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
            <div className="text-label text-text-tertiary mb-3">QUEUE AGING</div>
            <div className="flex gap-6">
              <div>
                <span className="text-xl font-light text-text-primary">
                  {queueHealth.waiting_1_day}
                </span>
                <span className="text-context text-text-muted ml-1">&gt;1d</span>
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
                <span className="text-context text-text-muted ml-1">&gt;3d</span>
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
                <span className="text-context text-text-muted ml-1">&gt;7d</span>
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
                Avg: <span className="text-text-primary">{wh.avg_transit_days}d</span>
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

function processChartData(daily: DailyFulfillment[], days: number = 7) {
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
    .sort((a, b) => a.rawDate.localeCompare(b.rawDate))
    .slice(-days);
}
