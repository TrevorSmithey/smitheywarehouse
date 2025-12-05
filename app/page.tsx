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
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Package,
  Truck,
  Clock,
  MapPin,
} from "lucide-react";
import type {
  MetricsResponse,
  WarehouseMetrics,
  DailyFulfillment,
  StuckShipment,
  TransitAnalytics,
} from "@/lib/types";

export default function Dashboard() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

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

  // Calculate alert conditions
  const stuckCount = metrics?.stuckShipments?.length || 0;
  const oldOrdersCount = metrics?.queueHealth?.reduce(
    (sum, q) => sum + q.waiting_7_days,
    0
  ) || 0;
  const hasAlerts = stuckCount > 0 || oldOrdersCount > 0;

  // Totals
  const totals = metrics?.warehouses?.reduce(
    (acc, wh) => ({
      queue: acc.queue + wh.unfulfilled_count + wh.partial_count,
      today: acc.today + wh.fulfilled_today,
      week: acc.week + wh.fulfilled_this_week,
    }),
    { queue: 0, today: 0, week: 0 }
  ) || { queue: 0, today: 0, week: 0 };

  const chartData = processChartData(metrics?.daily || []);

  return (
    <div className="min-h-screen bg-[#0A0C0F] text-[#E8E6E3] p-4 md:p-6 font-mono">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-medium tracking-tight text-[#C9A962]">
            SMITHEY WAREHOUSE
          </h1>
          <p className="text-xs text-[#6B7280] mt-0.5">
            {lastRefresh
              ? `Updated ${formatDistanceToNow(lastRefresh, { addSuffix: true })}`
              : "Loading..."}
          </p>
        </div>
        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="p-2 text-[#6B7280] hover:text-[#C9A962] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Alert Banner - Only shows if there are problems */}
      {hasAlerts && (
        <AlertBanner stuckCount={stuckCount} oldOrdersCount={oldOrdersCount} />
      )}

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard
          label="IN QUEUE"
          value={totals.queue}
          loading={loading}
          variant={totals.queue > 500 ? "warning" : "default"}
        />
        <StatCard
          label="SHIPPED TODAY"
          value={totals.today}
          loading={loading}
          variant="success"
        />
        <StatCard
          label="THIS WEEK"
          value={totals.week}
          loading={loading}
        />
      </div>

      {/* Warehouse Comparison - The Core View */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
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

      {/* Stuck Shipments - Actionable List */}
      {stuckCount > 0 && (
        <StuckShipmentsPanel shipments={metrics?.stuckShipments || []} />
      )}

      {/* Weekly Trend Chart */}
      <div className="bg-[#12151A] rounded-lg border border-[#1F2937] p-4 mb-6">
        <h3 className="text-xs font-medium text-[#6B7280] mb-4 tracking-wide">
          30-DAY FULFILLMENT TREND
        </h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barCategoryGap="20%">
              <XAxis
                dataKey="date"
                stroke="#374151"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="#374151"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1F2937",
                  border: "1px solid #374151",
                  borderRadius: "4px",
                  fontSize: "11px",
                }}
                labelStyle={{ color: "#9CA3AF" }}
              />
              <Bar
                dataKey="Smithey"
                fill="#C9A962"
                radius={[2, 2, 0, 0]}
                stackId="a"
              />
              <Bar
                dataKey="Selery"
                fill="#4B5563"
                radius={[2, 2, 0, 0]}
                stackId="a"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[180px] flex items-center justify-center text-[#4B5563] text-sm">
            No data available
          </div>
        )}
        <div className="flex justify-center gap-6 mt-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-[#C9A962]" />
            <span className="text-xs text-[#6B7280]">Smithey</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-[#4B5563]" />
            <span className="text-xs text-[#6B7280]">Selery</span>
          </div>
        </div>
      </div>

      {/* Transit Analytics */}
      <TransitAnalyticsPanel analytics={metrics?.transitAnalytics || []} />
    </div>
  );
}

function AlertBanner({
  stuckCount,
  oldOrdersCount,
}: {
  stuckCount: number;
  oldOrdersCount: number;
}) {
  return (
    <div className="mb-6 p-4 bg-[#FEF3C7]/10 border border-[#F59E0B]/30 rounded-lg">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-[#F59E0B] flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-[#F59E0B] text-sm">
            ATTENTION REQUIRED
          </div>
          <div className="text-sm text-[#D1D5DB] mt-1 space-y-1">
            {stuckCount > 0 && (
              <p>{stuckCount} shipment{stuckCount > 1 ? "s" : ""} with no tracking scans for 3+ days</p>
            )}
            {oldOrdersCount > 0 && (
              <p>{oldOrdersCount} order{oldOrdersCount > 1 ? "s" : ""} waiting 7+ days for fulfillment</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  variant = "default",
}: {
  label: string;
  value: number;
  loading: boolean;
  variant?: "default" | "success" | "warning";
}) {
  const variantStyles = {
    default: "text-[#E8E6E3]",
    success: "text-[#10B981]",
    warning: "text-[#F59E0B]",
  };

  return (
    <div className="bg-[#12151A] rounded-lg border border-[#1F2937] p-4">
      <div className="text-xs text-[#6B7280] mb-1 tracking-wide">{label}</div>
      <div className={`text-2xl font-light ${variantStyles[variant]}`}>
        {loading ? "—" : value.toLocaleString()}
      </div>
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
  queueHealth?: { waiting_1_day: number; waiting_3_days: number; waiting_7_days: number; oldest_order_name: string | null; oldest_order_days: number };
  transitData?: TransitAnalytics;
  loading: boolean;
}) {
  const name = data.warehouse.toUpperCase();
  const isSmithey = data.warehouse === "smithey";
  const accentColor = isSmithey ? "#C9A962" : "#6B7280";
  const weekChange = data.week_over_week_change;

  return (
    <div className="bg-[#12151A] rounded-lg border border-[#1F2937] overflow-hidden">
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-[#1F2937] flex items-center justify-between"
        style={{ borderLeftWidth: "3px", borderLeftColor: accentColor }}
      >
        <span className="font-medium text-sm tracking-wide">{name}</span>
        <div className="flex items-center gap-1 text-xs">
          {weekChange > 0 ? (
            <TrendingUp className="w-3 h-3 text-[#10B981]" />
          ) : weekChange < 0 ? (
            <TrendingDown className="w-3 h-3 text-[#EF4444]" />
          ) : null}
          <span
            className={
              weekChange > 0
                ? "text-[#10B981]"
                : weekChange < 0
                ? "text-[#EF4444]"
                : "text-[#6B7280]"
            }
          >
            {weekChange > 0 ? "+" : ""}
            {weekChange}% vs last week
          </span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="p-4">
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-2xl font-light">
              {loading ? "—" : data.unfulfilled_count}
            </div>
            <div className="text-xs text-[#6B7280] flex items-center gap-1 mt-1">
              <Package className="w-3 h-3" />
              Unfulfilled
            </div>
          </div>
          <div>
            <div className={`text-2xl font-light ${data.partial_count > 0 ? "text-[#F59E0B]" : ""}`}>
              {loading ? "—" : data.partial_count}
            </div>
            <div className="text-xs text-[#6B7280] flex items-center gap-1 mt-1">
              <Clock className="w-3 h-3" />
              Partial
            </div>
          </div>
          <div>
            <div className="text-2xl font-light text-[#10B981]">
              {loading ? "—" : data.fulfilled_today}
            </div>
            <div className="text-xs text-[#6B7280] mt-1">Today</div>
          </div>
          <div>
            <div className="text-2xl font-light">
              {loading ? "—" : data.avg_per_day_7d}
            </div>
            <div className="text-xs text-[#6B7280] mt-1">Avg/Day</div>
          </div>
        </div>

        {/* Queue Aging - Compact */}
        {queueHealth && (
          <div className="bg-[#0A0C0F] rounded p-3 mb-3">
            <div className="text-xs text-[#6B7280] mb-2">Queue Aging</div>
            <div className="flex gap-4">
              <div>
                <span className="text-lg font-light">{queueHealth.waiting_1_day}</span>
                <span className="text-xs text-[#6B7280] ml-1">&gt;1d</span>
              </div>
              <div>
                <span className={`text-lg font-light ${queueHealth.waiting_3_days > 0 ? "text-[#F59E0B]" : ""}`}>
                  {queueHealth.waiting_3_days}
                </span>
                <span className="text-xs text-[#6B7280] ml-1">&gt;3d</span>
              </div>
              <div>
                <span className={`text-lg font-light ${queueHealth.waiting_7_days > 0 ? "text-[#EF4444]" : ""}`}>
                  {queueHealth.waiting_7_days}
                </span>
                <span className="text-xs text-[#6B7280] ml-1">&gt;7d</span>
              </div>
            </div>
            {queueHealth.oldest_order_name && (
              <div className="text-xs text-[#6B7280] mt-2">
                Oldest: <span className="text-[#9CA3AF]">{queueHealth.oldest_order_name}</span>
                <span className="text-[#EF4444] ml-1">({queueHealth.oldest_order_days}d)</span>
              </div>
            )}
          </div>
        )}

        {/* Transit Time - Compact */}
        {transitData && transitData.total_delivered > 0 && (
          <div className="bg-[#0A0C0F] rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-[#6B7280] flex items-center gap-1">
                <Truck className="w-3 h-3" />
                Avg Transit
              </div>
              <div className="text-sm">
                <span className="text-[#E8E6E3] font-medium">{transitData.avg_transit_days}</span>
                <span className="text-[#6B7280] ml-1">days</span>
              </div>
            </div>
            <div className="text-xs text-[#6B7280]">
              {transitData.total_delivered.toLocaleString()} deliveries tracked
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StuckShipmentsPanel({ shipments }: { shipments: StuckShipment[] }) {
  // Group by warehouse
  const smithey = shipments.filter((s) => s.warehouse === "smithey");
  const selery = shipments.filter((s) => s.warehouse === "selery");

  const renderShipment = (s: StuckShipment) => (
    <div
      key={`${s.order_id}-${s.tracking_number}`}
      className="flex items-center justify-between py-2 border-b border-[#1F2937] last:border-0"
    >
      <div className="min-w-0">
        <div className="text-sm text-[#E8E6E3]">{s.order_name}</div>
        <div className="text-xs text-[#6B7280] truncate">
          {s.carrier}: {s.tracking_number}
        </div>
      </div>
      <div className="text-right flex-shrink-0 ml-3">
        <div
          className={`text-sm font-medium ${
            s.days_without_scan >= 7
              ? "text-[#EF4444]"
              : s.days_without_scan >= 5
              ? "text-[#F59E0B]"
              : "text-[#E8E6E3]"
          }`}
        >
          {s.days_without_scan}d
        </div>
        <div className="text-xs text-[#6B7280]">no scan</div>
      </div>
    </div>
  );

  return (
    <div className="bg-[#12151A] rounded-lg border border-[#1F2937] p-4 mb-6">
      <h3 className="text-xs font-medium text-[#F59E0B] mb-4 tracking-wide flex items-center gap-2">
        <Truck className="w-3.5 h-3.5" />
        STUCK SHIPMENTS — NO SCANS 3+ DAYS
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-[#6B7280] mb-2">SMITHEY ({smithey.length})</div>
          {smithey.length > 0 ? (
            smithey.slice(0, 5).map(renderShipment)
          ) : (
            <div className="text-xs text-[#4B5563] py-2">All clear</div>
          )}
        </div>
        <div>
          <div className="text-xs text-[#6B7280] mb-2">SELERY ({selery.length})</div>
          {selery.length > 0 ? (
            selery.slice(0, 5).map(renderShipment)
          ) : (
            <div className="text-xs text-[#4B5563] py-2">All clear</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TransitAnalyticsPanel({ analytics }: { analytics: TransitAnalytics[] }) {
  const hasData = analytics.some((a) => a.total_delivered > 0);
  if (!hasData) return null;

  return (
    <div className="bg-[#12151A] rounded-lg border border-[#1F2937] p-4">
      <h3 className="text-xs font-medium text-[#6B7280] mb-4 tracking-wide flex items-center gap-2">
        <MapPin className="w-3.5 h-3.5" />
        TRANSIT TIME BY STATE
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {analytics.map((wh) => (
          <div key={wh.warehouse}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-medium text-[#9CA3AF] uppercase">
                {wh.warehouse}
              </div>
              <div className="text-xs text-[#6B7280]">
                Avg: <span className="text-[#E8E6E3]">{wh.avg_transit_days}d</span>
              </div>
            </div>
            {wh.by_state.length > 0 ? (
              <div className="space-y-1">
                {wh.by_state.slice(0, 6).map((state) => (
                  <div
                    key={state.state}
                    className="flex items-center justify-between text-xs py-1"
                  >
                    <span className="text-[#9CA3AF]">{state.state}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[#6B7280]">
                        {state.shipment_count} shipments
                      </span>
                      <span
                        className={`font-medium ${
                          state.avg_transit_days > 5
                            ? "text-[#F59E0B]"
                            : "text-[#E8E6E3]"
                        }`}
                      >
                        {state.avg_transit_days}d
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[#4B5563] py-2">
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
      ...counts,
    }))
    .slice(-30);
}
