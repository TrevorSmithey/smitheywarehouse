"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { format, formatDistanceToNow } from "date-fns";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
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
  Pen,
  BarChart3,
} from "lucide-react";
import type {
  MetricsResponse,
  WarehouseMetrics,
  DailyFulfillment,
  DailyOrders,
  DailyBacklog,
  StuckShipment,
  FulfillmentLeadTime,
  TransitAnalytics,
  SkuInQueue,
  EngravingQueue,
  OrderAging,
  InventoryResponse,
  ProductInventory,
  InventoryCategory,
} from "@/lib/types";
import { USTransitMap } from "@/components/USTransitMap";

type DateRangeOption = "today" | "yesterday" | "3days" | "7days" | "30days" | "custom";
type PrimaryTab = "inventory" | "fulfillment";
type FulfillmentSubTab = "dashboard" | "tracking";
type InventoryCategoryTab = "cast_iron" | "carbon_steel" | "accessory" | "factory_second";

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
    case "yesterday": {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(start);
      yesterdayEnd.setHours(23, 59, 59, 999);
      return { start, end: yesterdayEnd };
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

// Parse date string (YYYY-MM-DD) as local date, not UTC
// This fixes timezone issues where "2025-12-05" parsed as UTC shows as 12/4 in EST
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Calculate percentage change
function getChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// Get number of days in the selected date range
function getDaysInRange(option: DateRangeOption): number {
  switch (option) {
    case "today": return 1;
    case "yesterday": return 1;
    case "3days": return 3;
    case "7days": return 7;
    case "30days": return 30;
    case "custom": return 7; // Fallback for custom
    default: return 7;
  }
}

// Get comparison label based on date range
function getComparisonLabel(option: DateRangeOption): string {
  switch (option) {
    case "today": return "vs yesterday";
    case "yesterday": return "vs prev day";
    case "3days": return "vs prev 3d";
    case "7days": return "vs prev 7d";
    case "30days": return "vs prev 30d";
    case "custom": return "vs prev period";
    default: return "vs prev period";
  }
}

// Get short range label for display (e.g., "today", "3d", "7d")
function getShortRangeLabel(option: DateRangeOption): string {
  switch (option) {
    case "today": return "today";
    case "yesterday": return "yesterday";
    case "3days": return "3d";
    case "7days": return "7d";
    case "30days": return "30d";
    case "custom": return "period";
    default: return "period";
  }
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Global date range state - default to 3 days
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>("3days");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  // Tab state - two-tier navigation
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("inventory");
  const [fulfillmentSubTab, setFulfillmentSubTab] = useState<FulfillmentSubTab>("dashboard");

  // Tracking tab - shipped within filter (for stuck shipments)
  const [trackingShippedWithin, setTrackingShippedWithin] = useState<"7days" | "14days" | "30days" | "all">("14days");

  // Stuck threshold - how many days without scan counts as "stuck"
  const [stuckThreshold, setStuckThreshold] = useState<1 | 2 | 3>(2);

  // Inventory tab state
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryCategory, setInventoryCategory] = useState<InventoryCategoryTab>("cast_iron");

  // Fetch inventory when tab becomes active
  const fetchInventory = useCallback(async () => {
    try {
      setInventoryLoading(true);
      const res = await fetch("/api/inventory");
      if (!res.ok) throw new Error("Failed to fetch inventory");
      const data: InventoryResponse = await res.json();
      setInventory(data);
    } catch (err) {
      console.error("Inventory fetch error:", err);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  // Load inventory when switching to inventory tab
  useEffect(() => {
    if (primaryTab === "inventory" && !inventory && !inventoryLoading) {
      fetchInventory();
    }
  }, [primaryTab, inventory, inventoryLoading, fetchInventory]);

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
  // Compare current period avg/day to 7-day rolling avg (same units)
  const currentAvgPerDay = totals.today / getDaysInRange(dateRangeOption);
  const todayVsAvg = getChange(currentAvgPerDay, totals.avg7d);
  const weekOverWeek = getChange(totals.week, totals.lastWeek);
  const avgTrend = getChange(totals.avg7d, totals.avg30d);

  // Filter stuck shipments based on threshold AND shipped-within filter
  const filteredStuckShipments = (metrics?.stuckShipments || []).filter((s) => {
    // First: must meet stuck threshold
    if (s.days_without_scan < stuckThreshold) return false;

    // Second: apply shipped-within filter
    if (trackingShippedWithin === "all") return true;
    const shippedDate = new Date(s.shipped_at);
    const now = new Date();
    const daysAgo = trackingShippedWithin === "7days" ? 7 : trackingShippedWithin === "14days" ? 14 : 30;
    const cutoff = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return shippedDate >= cutoff;
  });

  const stuckCount = filteredStuckShipments.length;

  const chartData = processChartData(metrics?.daily || [], metrics?.dailyBacklog || []);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Image
              src="/smithey-logo-white.png"
              alt="Smithey"
              width={40}
              height={40}
              className="object-contain"
            />
            <div>
              <p className="text-sm text-text-secondary uppercase tracking-wide">
                RETAIL FULFILLMENT
              </p>
              <p className="text-xs text-text-muted">
                {lastRefresh
                  ? `Updated ${formatDistanceToNow(lastRefresh, { addSuffix: true })}`
                  : "Loading..."}
              </p>
            </div>
          </div>
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="p-2 text-text-tertiary hover:text-accent-blue transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Date Range Selector - hide on Inventory tab */}
        {primaryTab !== "inventory" && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              {(["today", "yesterday", "3days", "7days", "30days", "custom"] as DateRangeOption[]).map((option) => {
                const labels: Record<DateRangeOption, string> = {
                  today: "Today",
                  yesterday: "Yesterday",
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
        )}

        {/* Primary Tab Selector */}
        <div className="flex gap-1 mt-4 border-b border-border">
          <button
            onClick={() => setPrimaryTab("inventory")}
            className={`px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px ${
              primaryTab === "inventory"
                ? "text-accent-blue border-accent-blue"
                : "text-text-tertiary border-transparent hover:text-text-secondary"
            }`}
          >
            <BarChart3 className="w-4 h-4 inline-block mr-2 -mt-0.5" />
            INVENTORY
          </button>
          <button
            onClick={() => setPrimaryTab("fulfillment")}
            className={`px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px ${
              primaryTab === "fulfillment"
                ? "text-accent-blue border-accent-blue"
                : "text-text-tertiary border-transparent hover:text-text-secondary"
            }`}
          >
            <Package className="w-4 h-4 inline-block mr-2 -mt-0.5" />
            FULFILLMENT
          </button>
        </div>

        {/* Fulfillment Sub-tabs */}
        {primaryTab === "fulfillment" && (
          <div className="flex gap-4 mt-3">
            <button
              onClick={() => setFulfillmentSubTab("dashboard")}
              className={`text-sm font-medium transition-all ${
                fulfillmentSubTab === "dashboard"
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setFulfillmentSubTab("tracking")}
              className={`text-sm font-medium transition-all ${
                fulfillmentSubTab === "tracking"
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Tracking
              {stuckCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-status-warning/20 text-status-warning rounded">
                  {stuckCount}
                </span>
              )}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="mb-6 p-4 bg-status-bad/10 border border-status-bad/30 rounded text-status-bad text-sm">
          {error}
        </div>
      )}

      {/* FULFILLMENT DASHBOARD */}
      {primaryTab === "fulfillment" && fulfillmentSubTab === "dashboard" && (
        <>
          {/* KPI Cards - with change indicators like Lathe app */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="IN QUEUE"
          subtitle="(running total, excl. restorations)"
          value={totals.queue}
          loading={loading}
          status={totals.queue > 500 ? "warning" : undefined}
        />
        <KPICard
          label={
            dateRangeOption === "today" ? "SHIPPED TODAY" :
            dateRangeOption === "yesterday" ? "SHIPPED YESTERDAY" :
            dateRangeOption === "3days" ? "SHIPPED (3D)" :
            dateRangeOption === "7days" ? "SHIPPED (7D)" :
            dateRangeOption === "30days" ? "SHIPPED (30D)" :
            "SHIPPED"
          }
          value={totals.today}
          loading={loading}
          status="good"
          change={todayVsAvg}
          changeLabel="vs avg"
        />
        <EngravingQueueCard
          data={metrics?.engravingQueue}
          loading={loading}
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
            leadTimeData={metrics.fulfillmentLeadTime?.find(
              (l) => l.warehouse === wh.warehouse
            )}
            loading={loading}
            dateRangeOption={dateRangeOption}
          />
        ))}
      </div>

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

        {/* Queue Aging */}
        <OrderAgingChart aging={metrics?.orderAging || []} loading={loading} />
      </div>

      {/* Backlog Chart - separate, smaller, 10-day window */}
      <BacklogChart backlog={metrics?.dailyBacklog || []} loading={loading} />

      {/* Warehouse Distribution Chart */}
      <WarehouseSplitChart dailyOrders={metrics?.dailyOrders || []} loading={loading} />

      {/* Top SKUs in Queue - full width at bottom */}
      <TopSkusPanel skus={metrics?.topSkusInQueue || []} loading={loading} />
        </>
      )}

      {/* TRACKING SUB-TAB */}
      {primaryTab === "fulfillment" && fulfillmentSubTab === "tracking" && (
        <>
          {/* Tracking Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-bg-secondary rounded border border-border p-6">
              <div className="text-label text-text-tertiary mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-status-warning" />
                STUCK SHIPMENTS
              </div>
              <div className={`text-metric font-light ${stuckCount > 0 ? "text-status-warning" : "text-text-primary"}`}>
                {formatNumber(stuckCount)}
              </div>
              <div className="text-context text-text-muted mt-1">
                No scans in {stuckThreshold}+ day{stuckThreshold > 1 ? "s" : ""}
              </div>
            </div>
            <div className="bg-bg-secondary rounded border border-border p-6">
              <div className="text-label text-text-tertiary mb-2 flex items-center gap-1.5">
                <Package className="w-3 h-3" />
                DELIVERED
              </div>
              <div className="text-metric font-light text-status-good">
                {formatNumber((metrics?.transitAnalytics || []).reduce((sum, t) => sum + t.total_delivered, 0))}
              </div>
              <div className="text-context text-text-muted mt-1">
                Shipments delivered
              </div>
            </div>
            <div className="bg-bg-secondary rounded border border-border p-6">
              <div className="text-label text-text-tertiary mb-2 flex items-center gap-1.5">
                <Truck className="w-3 h-3" />
                AVG TRANSIT
              </div>
              <div className="text-metric font-light text-text-primary">
                {(() => {
                  const analytics = metrics?.transitAnalytics || [];
                  const totalDelivered = analytics.reduce((sum, t) => sum + t.total_delivered, 0);
                  const weightedSum = analytics.reduce((sum, t) => sum + (t.avg_transit_days * t.total_delivered), 0);
                  return totalDelivered > 0 ? (weightedSum / totalDelivered).toFixed(1) : "—";
                })()}d
              </div>
              <div className="text-context text-text-muted mt-1">
                Average delivery time
              </div>
            </div>
          </div>

          {/* Stuck Shipments with integrated filters */}
          <StuckShipmentsPanel
            shipments={filteredStuckShipments}
            threshold={stuckThreshold}
            trackingShippedWithin={trackingShippedWithin}
            setTrackingShippedWithin={setTrackingShippedWithin}
            stuckThreshold={stuckThreshold}
            setStuckThreshold={setStuckThreshold}
          />

          {/* Transit Map */}
          <USTransitMap analytics={metrics?.transitAnalytics || []} loading={loading} />
        </>
      )}

      {/* INVENTORY TAB */}
      {primaryTab === "inventory" && (
        <InventoryDashboard
          inventory={inventory}
          loading={inventoryLoading}
          category={inventoryCategory}
          setCategory={setInventoryCategory}
          onRefresh={fetchInventory}
        />
      )}
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
  note,
}: {
  label: string;
  value: number;
  loading: boolean;
  status?: "good" | "warning" | "bad";
  subtitle?: string;
  change?: number;
  changeLabel?: string;
  note?: string;
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
        {note && <span className="text-text-muted font-normal text-xs ml-1">({note})</span>}
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

function EngravingQueueCard({
  data,
  loading,
}: {
  data: EngravingQueue | undefined;
  loading: boolean;
}) {
  const totalUnits = data?.total_units || 0;
  const estimatedDays = data?.estimated_days || 0;
  const orderCount = data?.order_count || 0;

  // Warning if lead time exceeds 3 days
  const status = estimatedDays > 3 ? "warning" : estimatedDays > 5 ? "bad" : undefined;
  const statusColors = {
    warning: "text-status-warning",
    bad: "text-status-bad",
  };

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 transition-all duration-200 hover:border-border-hover hover:shadow-card-hover hover:-translate-y-px">
      <div className="text-label text-text-tertiary font-medium mb-2 flex items-center gap-1.5">
        <Pen className="w-3 h-3" />
        ENGRAVING QUEUE
        <span className="text-text-muted font-normal text-xs ml-1">(running total)</span>
      </div>
      <div
        className={`text-metric font-light tracking-tight-sm ${
          status ? statusColors[status] : "text-text-primary"
        }`}
      >
        {loading ? "—" : formatNumber(totalUnits)}
      </div>
      <div className="text-context text-text-secondary mt-1">
        <span className={status ? statusColors[status] : "text-text-primary"}>
          ~{estimatedDays}d
        </span>
        <span className="text-text-muted ml-1">lead time</span>
      </div>
      <div className="text-context text-text-muted mt-1">
        {formatNumber(orderCount)} orders
      </div>
    </div>
  );
}

function WarehousePanel({
  data,
  queueHealth,
  transitData,
  leadTimeData,
  loading,
  dateRangeOption,
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
  leadTimeData?: FulfillmentLeadTime;
  dateRangeOption: DateRangeOption;
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
            {weekChange.toFixed(1)}% {getComparisonLabel(dateRangeOption)}
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
            <div className="text-label text-text-tertiary mt-2">
              {dateRangeOption === "today" ? "Shipped Today" :
               dateRangeOption === "yesterday" ? "Shipped Yesterday" :
               dateRangeOption === "3days" ? "Shipped (3D)" :
               dateRangeOption === "7days" ? "Shipped (7D)" :
               dateRangeOption === "30days" ? "Shipped (30D)" :
               "Shipped"}
            </div>
          </div>
          <div>
            <div className="text-3xl font-light text-text-primary">
              {loading ? "—" : formatNumber(Math.round(data.fulfilled_today / getDaysInRange(dateRangeOption)))}
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
                  {formatNumber(queueHealth.waiting_1_day)}
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
                  {formatNumber(queueHealth.waiting_3_days)}
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
                  {formatNumber(queueHealth.waiting_7_days)}
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

        {/* Lead Time + Expected Clear + SLA Breakdown */}
        {leadTimeData && leadTimeData.total_fulfilled > 0 && (
          <div className="bg-bg-tertiary rounded p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-label text-text-tertiary flex items-center gap-1">
                <Clock className="w-3 h-3" />
                FULFILLMENT SPEED
              </div>
              {leadTimeData.trend_pct !== 0 && (
                <div className="flex items-center gap-1 text-context">
                  <span
                    className={
                      leadTimeData.trend_pct < 0
                        ? "text-status-good"
                        : "text-status-warning"
                    }
                  >
                    {leadTimeData.trend_pct > 0 ? "+" : ""}{leadTimeData.trend_pct.toFixed(1)}%
                  </span>
                  <span className="text-text-muted">{getComparisonLabel(dateRangeOption)}</span>
                </div>
              )}
            </div>

            {/* Main metrics row */}
            <div className="flex items-center gap-6 mb-3">
              <div>
                <span className="text-xl font-light text-text-primary">
                  {leadTimeData.avg_hours < 24
                    ? `${leadTimeData.avg_hours}h`
                    : `${leadTimeData.avg_days}d`}
                </span>
                <span className="text-context text-text-muted ml-1">avg lead</span>
              </div>
              {(() => {
                const queueSize = data.unfulfilled_count + data.partial_count;
                const daysInRange = getDaysInRange(dateRangeOption);
                const avgPerDay = daysInRange > 0 ? Math.round(data.fulfilled_today / daysInRange) : 0;
                const expectedDays = avgPerDay > 0 ? Math.round(queueSize / avgPerDay) : 0;

                return avgPerDay > 0 ? (
                  <div>
                    <span className={`text-xl font-light ${expectedDays > 5 ? "text-status-warning" : "text-text-primary"}`}>
                      ~{expectedDays}d
                    </span>
                    <span className="text-context text-text-muted ml-1">to clear</span>
                  </div>
                ) : null;
              })()}
            </div>

            {/* SLA Distribution */}
            <div className="flex gap-4 text-context pt-2 border-t border-border-subtle">
              <div>
                <span className="text-status-good font-medium">{leadTimeData.within_24h}%</span>
                <span className="text-text-muted ml-1">&lt;24h</span>
              </div>
              <div>
                <span className="text-text-primary font-medium">{leadTimeData.within_48h}%</span>
                <span className="text-text-muted ml-1">&lt;48h</span>
              </div>
              <div>
                <span
                  className={`font-medium ${
                    leadTimeData.over_72h > 10 ? "text-status-warning" : "text-text-secondary"
                  }`}
                >
                  {leadTimeData.over_72h}%
                </span>
                <span className="text-text-muted ml-1">&gt;72h</span>
              </div>
            </div>
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
              {formatNumber(transitData.total_delivered)} deliveries tracked
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
  // Split by warehouse - no limit, we'll scroll
  const smitheySkus = skus.filter((s) => s.warehouse === "smithey");
  const selerySkus = skus.filter((s) => s.warehouse === "selery");

  const SkuTable = ({ items, warehouse }: { items: SkuInQueue[]; warehouse: string }) => (
    <div>
      <div className={`text-label font-medium mb-3 ${
        warehouse === "smithey" ? "text-accent-blue" : "text-text-tertiary"
      }`}>
        {warehouse.toUpperCase()}
      </div>
      {items.length > 0 ? (
        <div className="max-h-[300px] overflow-y-auto">
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

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 mt-6 transition-all hover:border-border-hover">
      <h3 className="text-label font-medium text-text-tertiary mb-4">
        TOP SKUS IN QUEUE
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

function StuckShipmentsPanel({
  shipments,
  threshold,
  trackingShippedWithin,
  setTrackingShippedWithin,
  stuckThreshold,
  setStuckThreshold,
}: {
  shipments: StuckShipment[];
  threshold: number;
  trackingShippedWithin: "7days" | "14days" | "30days" | "all";
  setTrackingShippedWithin: (v: "7days" | "14days" | "30days" | "all") => void;
  stuckThreshold: 1 | 2 | 3;
  setStuckThreshold: (v: 1 | 2 | 3) => void;
}) {
  const smithey = shipments.filter((s) => s.warehouse === "smithey");
  const selery = shipments.filter((s) => s.warehouse === "selery");

  const renderShipment = (s: StuckShipment) => (
    <div
      key={`${s.order_id}-${s.tracking_number}`}
      className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0"
    >
      <div className="min-w-0">
        <a
          href={`https://admin.shopify.com/store/smithey-iron-ware/orders/${s.order_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-context text-accent-blue hover:underline"
        >
          {s.order_name}
        </a>
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
      {/* Header with integrated filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-label font-medium text-status-warning flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          STUCK SHIPMENTS — NO SCANS {threshold}+ DAY{threshold > 1 ? "S" : ""}
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-label text-text-tertiary">SHIPPED WITHIN</span>
            <div className="flex gap-1">
              {(["7days", "14days", "30days", "all"] as const).map((option) => {
                const labels = {
                  "7days": "7d",
                  "14days": "14d",
                  "30days": "30d",
                  "all": "All",
                };
                return (
                  <button
                    key={option}
                    onClick={() => setTrackingShippedWithin(option)}
                    className={`px-2 py-0.5 text-xs font-medium transition-all border rounded ${
                      trackingShippedWithin === option
                        ? "bg-accent-blue text-white border-accent-blue"
                        : "bg-transparent text-text-secondary border-border hover:border-border-hover hover:text-text-primary"
                    }`}
                  >
                    {labels[option]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-label text-text-tertiary">STUCK THRESHOLD</span>
            <div className="flex gap-1">
              {([1, 2, 3] as const).map((days) => (
                <button
                  key={days}
                  onClick={() => setStuckThreshold(days)}
                  className={`px-2 py-0.5 text-xs font-medium transition-all border rounded ${
                    stuckThreshold === days
                      ? "bg-status-warning text-bg-primary border-status-warning"
                      : "bg-transparent text-text-secondary border-border hover:border-border-hover hover:text-text-primary"
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-label text-text-tertiary mb-3">
            SMITHEY ({formatNumber(smithey.length)})
          </div>
          {smithey.length > 0 ? (
            <div className="max-h-[320px] overflow-y-auto pr-2">
              {smithey.map(renderShipment)}
            </div>
          ) : (
            <div className="text-context text-text-muted py-2">All clear</div>
          )}
        </div>
        <div>
          <div className="text-label text-text-tertiary mb-3">
            SELERY ({formatNumber(selery.length)})
          </div>
          {selery.length > 0 ? (
            <div className="max-h-[320px] overflow-y-auto pr-2">
              {selery.map(renderShipment)}
            </div>
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
                        {formatNumber(state.shipment_count)} shipments
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
                <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
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
              formatter={(value: number, name: string) => {
                if (name === "backlog") return [formatNumber(value), "Backlog"];
                if (name === "created") return [formatNumber(value), "Created"];
                if (name === "fulfilled") return [formatNumber(value), "Fulfilled"];
                return [value, name];
              }}
            />
            <Area
              type="monotone"
              dataKey="backlog"
              stroke="#EF4444"
              strokeWidth={2}
              fill="url(#backlogGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
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
                isDanger ? "bg-status-bad/50" : "bg-slate-500/50"
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

function WarehouseSplitChart({
  dailyOrders,
  loading,
}: {
  dailyOrders: DailyOrders[];
  loading: boolean;
}) {
  // Process data for the chart - show percentage over time
  const chartData = dailyOrders
    .map((d) => ({
      date: format(parseLocalDate(d.date), "M/d"),
      rawDate: d.date,
      Smithey: d.smithey_pct,
      Selery: d.selery_pct,
      total: d.total,
    }))
    .sort((a, b) => a.rawDate.localeCompare(b.rawDate));

  // Calculate average split
  const avgSmithey = dailyOrders.length > 0
    ? Math.round(dailyOrders.reduce((sum, d) => sum + d.smithey_pct, 0) / dailyOrders.length)
    : 0;

  if (chartData.length === 0) return null;

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 mb-6 transition-all hover:border-border-hover">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-label font-medium text-text-tertiary">
          WAREHOUSE SPLIT
        </h3>
        <div className="text-context text-text-muted">
          Avg: <span className="text-accent-blue">{avgSmithey}%</span> Smithey / <span className="text-text-tertiary">{100 - avgSmithey}%</span> Selery
        </div>
      </div>
      {loading ? (
        <div className="h-[180px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData}>
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
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#12151F",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#94A3B8" }}
              formatter={(value: number, name: string) => [`${value}%`, name]}
            />
            <ReferenceLine y={50} stroke="#374151" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="Smithey"
              stroke="#0EA5E9"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="Selery"
              stroke="#64748B"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="flex justify-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-accent-blue" />
          <span className="text-context text-text-secondary">Smithey %</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-text-tertiary" />
          <span className="text-context text-text-secondary">Selery %</span>
        </div>
      </div>
    </div>
  );
}

function processChartData(daily: DailyFulfillment[], backlog: DailyBacklog[] = []) {
  const grouped = new Map<string, { Smithey: number; Selery: number; Backlog: number }>();

  // Build backlog map by date
  const backlogByDate = new Map<string, number>();
  for (const b of backlog) {
    backlogByDate.set(b.date, b.runningBacklog);
  }

  // First, add all dates from backlog (ensures all days show up even with 0 fulfillments)
  for (const b of backlog) {
    grouped.set(b.date, { Smithey: 0, Selery: 0, Backlog: b.runningBacklog });
  }

  // Then overlay fulfillment data
  for (const item of daily) {
    const existing = grouped.get(item.date) || { Smithey: 0, Selery: 0, Backlog: backlogByDate.get(item.date) || 0 };
    if (item.warehouse === "smithey") {
      existing.Smithey = item.count;
    } else if (item.warehouse === "selery") {
      existing.Selery = item.count;
    }
    grouped.set(item.date, existing);
  }

  return Array.from(grouped.entries())
    .map(([date, counts]) => ({
      date: format(parseLocalDate(date), "M/d"),
      rawDate: date,
      ...counts,
    }))
    .sort((a, b) => a.rawDate.localeCompare(b.rawDate));
}

// Inventory Dashboard - See. Understand. Prioritize.
function InventoryDashboard({
  inventory,
  loading,
  category,
  setCategory,
  onRefresh,
}: {
  inventory: InventoryResponse | null;
  loading: boolean;
  category: InventoryCategoryTab;
  setCategory: (cat: InventoryCategoryTab) => void;
  onRefresh: () => void;
}) {
  const [sortBy, setSortBy] = useState<"total" | "pipefitter" | "hobson" | "selery" | "doi">("doi");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc"); // For DOI, "desc" = low-to-high (most urgent first)
  const [healthFilter, setHealthFilter] = useState<"backorder" | "urgent" | "watch" | null>(null);

  // Get products for current category
  const categoryProducts = category === "accessory"
    ? [...(inventory?.byCategory.accessory || []), ...(inventory?.byCategory.glass_lid || [])]
    : inventory?.byCategory[category] || [];

  // Filter by health status if selected
  const filteredProducts = healthFilter
    ? categoryProducts.filter(p => {
        if (healthFilter === "backorder") return p.isBackordered;
        if (healthFilter === "urgent") return !p.isBackordered && p.doi !== undefined && p.doi < 7;
        if (healthFilter === "watch") return !p.isBackordered && p.doi !== undefined && p.doi >= 7 && p.doi < 30;
        return true;
      })
    : categoryProducts;

  // Sort products (handle doi specially - backordered items go to top, then by DOI)
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === "doi") {
      // Backordered items get -1 (most urgent), undefined DOI goes to end with 9999
      const aVal = a.isBackordered ? -1 : (a.doi ?? 9999);
      const bVal = b.isBackordered ? -1 : (b.doi ?? 9999);
      return sortDir === "desc" ? aVal - bVal : bVal - aVal;
    }
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    return sortDir === "desc" ? bVal - aVal : aVal - bVal;
  });

  // Calculate totals (all products)
  const totals = inventory?.totals || { pipefitter: 0, hobson: 0, selery: 0, total: 0 };

  // Calculate cookware totals (cast iron + carbon steel only)
  const cookwareProducts = [
    ...(inventory?.byCategory.cast_iron || []),
    ...(inventory?.byCategory.carbon_steel || []),
  ];
  const cookwareTotals = cookwareProducts.reduce(
    (acc, p) => ({
      pipefitter: acc.pipefitter + p.pipefitter,
      hobson: acc.hobson + p.hobson,
      selery: acc.selery + p.selery,
      total: acc.total + p.total,
    }),
    { pipefitter: 0, hobson: 0, selery: 0, total: 0 }
  );

  // DOI Health Analysis (cookware only - factory seconds excluded)
  const doiHealth = cookwareProducts.reduce(
    (acc, p) => {
      if (p.isBackordered) {
        acc.backorder++;
        acc.backorderItems.push(p.displayName);
      } else if (p.doi === undefined) {
        acc.noForecast++;
      } else if (p.doi < 7) {
        acc.urgent++;
        acc.urgentItems.push(p.displayName);
      } else if (p.doi < 30) {
        acc.critical++;
        acc.criticalItems.push(p.displayName);
      } else if (p.doi < 60) {
        acc.watch++;
      } else {
        acc.healthy++;
      }
      return acc;
    },
    { backorder: 0, urgent: 0, critical: 0, watch: 0, healthy: 0, noForecast: 0, backorderItems: [] as string[], urgentItems: [] as string[], criticalItems: [] as string[] }
  );

  // Check if DOI applies to current category
  const showDoi = category !== "factory_second";

  // Category config
  const categoryLabels: Record<InventoryCategoryTab, string> = {
    cast_iron: "CAST IRON",
    carbon_steel: "CARBON STEEL",
    accessory: "ACCESSORIES",
    factory_second: "FACTORY SECOND",
  };

  // Calculate category totals for footer
  const categoryTotals = sortedProducts.reduce(
    (acc, p) => ({
      pipefitter: acc.pipefitter + p.pipefitter,
      hobson: acc.hobson + p.hobson,
      selery: acc.selery + p.selery,
      total: acc.total + p.total,
    }),
    { pipefitter: 0, hobson: 0, selery: 0, total: 0 }
  );

  // Calculate max values for heat map intensity (per column)
  const maxValues = {
    pipefitter: Math.max(...sortedProducts.map(p => p.pipefitter), 1),
    hobson: Math.max(...sortedProducts.map(p => p.hobson), 1),
    selery: Math.max(...sortedProducts.map(p => p.selery), 1),
    total: Math.max(...sortedProducts.map(p => p.total), 1),
  };

  // Get intensity (0-1) for heat map coloring
  const getIntensity = (value: number, max: number): number => {
    if (value === 0) return 0;
    // Use sqrt for more gradual gradient (not linear)
    return Math.sqrt(value / max);
  };

  // Color configs for each warehouse (using consistent palette)
  const warehouseColors = {
    pipefitter: { r: 59, g: 130, b: 246 },  // blue-500
    hobson: { r: 245, g: 158, b: 11 },      // amber-500
    selery: { r: 34, g: 197, b: 94 },       // green-500
  };

  // Get background style with color intensity
  const getCellStyle = (value: number, warehouse: "pipefitter" | "hobson" | "selery") => {
    const intensity = getIntensity(value, maxValues[warehouse]);
    const color = warehouseColors[warehouse];
    // Background opacity scales from 0 to 0.25 based on intensity
    const bgOpacity = intensity * 0.25;
    return {
      backgroundColor: `rgba(${color.r}, ${color.g}, ${color.b}, ${bgOpacity})`,
    };
  };

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return null;
    return <span className="ml-1 opacity-60">{sortDir === "desc" ? "↓" : "↑"}</span>;
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Category Tabs */}
      <div className="flex items-center gap-2 mb-6">
        {(["cast_iron", "carbon_steel", "accessory", "factory_second"] as InventoryCategoryTab[]).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
              category === cat
                ? "bg-accent-blue text-white"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            }`}
          >
            {categoryLabels[cat]}
          </button>
        ))}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="ml-auto p-2 text-text-tertiary hover:text-accent-blue transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Cookware Totals + Inventory Health */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-bg-secondary rounded border border-border p-4 border-l-2 border-l-amber-500">
          <div className="text-xs text-amber-400 mb-1 tracking-wide">HOBSON</div>
          <div className="text-3xl font-medium text-text-primary tabular-nums">
            {loading ? "—" : formatNumber(cookwareTotals.hobson)}
          </div>
        </div>
        <div className="bg-bg-secondary rounded border border-border p-4 border-l-2 border-l-green-500">
          <div className="text-xs text-green-400 mb-1 tracking-wide">SELERY</div>
          <div className="text-3xl font-medium text-text-primary tabular-nums">
            {loading ? "—" : formatNumber(cookwareTotals.selery)}
          </div>
        </div>
        <div className="bg-bg-secondary rounded border border-border p-4 border-l-2 border-l-blue-500">
          <div className="text-xs text-blue-400 mb-1 tracking-wide">PIPEFITTER</div>
          <div className="text-3xl font-medium text-text-primary tabular-nums">
            {loading ? "—" : formatNumber(cookwareTotals.pipefitter)}
          </div>
        </div>
        <div className="bg-bg-secondary rounded border border-border p-4 border-l-2 border-l-slate-500">
          <div className="text-xs text-slate-400 mb-1 tracking-wide">TOTAL COOKWARE</div>
          <div className="text-3xl font-medium text-text-primary tabular-nums">
            {loading ? "—" : formatNumber(cookwareTotals.total)}
          </div>
        </div>
        {/* Inventory Health Summary - Clickable filters */}
        <div className="bg-bg-secondary rounded border border-border p-4 border-l-2 border-l-purple-500">
          <div className="text-xs text-purple-400 mb-2 tracking-wide flex items-center justify-between">
            <span>INVENTORY HEALTH</span>
            {healthFilter && (
              <button
                onClick={() => setHealthFilter(null)}
                className="text-text-muted hover:text-text-primary text-[10px]"
              >
                Clear
              </button>
            )}
          </div>
          {loading ? (
            <div className="text-text-muted">—</div>
          ) : doiHealth.backorder > 0 || doiHealth.urgent > 0 || doiHealth.critical > 0 ? (
            <div className="space-y-1">
              {doiHealth.backorder > 0 && (
                <button
                  onClick={() => setHealthFilter(healthFilter === "backorder" ? null : "backorder")}
                  className={`flex items-center gap-2 w-full text-left rounded px-1 -mx-1 transition-colors ${
                    healthFilter === "backorder" ? "bg-red-500/20" : "hover:bg-white/5"
                  }`}
                >
                  <span className="w-7 text-lg font-bold text-red-400 bg-red-500/20 px-1.5 rounded text-center">{doiHealth.backorder}</span>
                  <span className="text-xs text-red-400 font-medium uppercase">Backorder</span>
                </button>
              )}
              {doiHealth.urgent > 0 && (
                <button
                  onClick={() => setHealthFilter(healthFilter === "urgent" ? null : "urgent")}
                  className={`flex items-center gap-2 w-full text-left rounded px-1 -mx-1 transition-colors ${
                    healthFilter === "urgent" ? "bg-red-500/20" : "hover:bg-white/5"
                  }`}
                >
                  <span className="w-7 text-lg font-bold text-red-400 bg-red-500/20 px-1.5 rounded text-center">{doiHealth.urgent}</span>
                  <span className="text-xs text-red-400 font-medium">URGENT (&lt;7d)</span>
                </button>
              )}
              {doiHealth.critical > 0 && (
                <button
                  onClick={() => setHealthFilter(healthFilter === "watch" ? null : "watch")}
                  className={`flex items-center gap-2 w-full text-left rounded px-1 -mx-1 transition-colors ${
                    healthFilter === "watch" ? "bg-orange-500/20" : "hover:bg-white/5"
                  }`}
                >
                  <span className="w-7 text-lg font-medium text-status-bad text-center">{doiHealth.critical}</span>
                  <span className="text-xs text-status-bad">WATCH (&lt;30d)</span>
                </button>
              )}
              {doiHealth.noForecast > 0 && (
                <div className="text-xs text-text-muted mt-1 pl-1">
                  {doiHealth.noForecast} without forecast
                </div>
              )}
            </div>
          ) : doiHealth.noForecast === cookwareProducts.length ? (
            <div className="text-sm text-text-muted">No forecast data</div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium text-status-good">{doiHealth.healthy}</span>
              <span className="text-xs text-status-good">ALL HEALTHY</span>
            </div>
          )}
        </div>
      </div>

      {/* Inventory Table with Heat Map */}
      <div className="bg-bg-secondary rounded border border-border overflow-hidden">
        <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-secondary z-10 border-b border-border">
              <tr>
                <th className="text-left px-5 py-3 text-xs text-text-tertiary font-medium tracking-wide w-[180px]">
                  PRODUCT
                </th>
                <th
                  onClick={() => handleSort("hobson")}
                  className="text-right px-4 py-3 text-xs text-amber-400 font-medium cursor-pointer select-none tracking-wide"
                >
                  HOBSON<SortIcon col="hobson" />
                </th>
                <th
                  onClick={() => handleSort("selery")}
                  className="text-right px-4 py-3 text-xs text-green-400 font-medium cursor-pointer select-none tracking-wide"
                >
                  SELERY<SortIcon col="selery" />
                </th>
                <th
                  onClick={() => handleSort("pipefitter")}
                  className="text-right px-4 py-3 text-xs text-blue-400 font-medium cursor-pointer select-none tracking-wide"
                >
                  PIPEFITTER<SortIcon col="pipefitter" />
                </th>
                <th
                  onClick={() => handleSort("total")}
                  className={`text-right py-3 text-sm text-white font-semibold cursor-pointer select-none tracking-wide ${showDoi ? "px-4" : "px-5"}`}
                >
                  TOTAL<SortIcon col="total" />
                </th>
                {showDoi && (
                  <th
                    onClick={() => handleSort("doi")}
                    className="text-right px-5 py-3 text-xs text-purple-400 font-medium cursor-pointer select-none tracking-wide"
                  >
                    DOI<SortIcon col="doi" />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={showDoi ? 6 : 5} className="px-5 py-12 text-center text-text-muted text-sm">
                    Loading...
                  </td>
                </tr>
              ) : sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={showDoi ? 6 : 5} className="px-5 py-12 text-center text-text-muted text-sm">
                    No products in this category
                  </td>
                </tr>
              ) : (
                <>
                  {sortedProducts.map((product) => {
                    return (
                      <tr
                        key={product.sku}
                        className="border-b border-border/30 group cursor-default"
                        title={product.monthBudget
                          ? `${product.displayName}\nDec Budget: ${product.monthBudget?.toLocaleString()} | Sold: ${product.monthSold?.toLocaleString()} (${product.monthPct}%)`
                          : product.displayName}
                      >
                        <td className="px-5 py-2.5">
                          <span className={`text-base font-medium ${
                            product.isBackordered
                              ? "text-red-400 bg-red-500/20 px-2 py-0.5 rounded font-bold"
                              : product.doi !== undefined && product.doi < 7
                              ? "text-red-400 bg-red-500/20 px-2 py-0.5 rounded font-bold"
                              : "text-text-primary"
                          }`}>{product.displayName}</span>
                          {product.monthBudget && (
                            <div className="text-xs mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-text-muted">Budget:</span>
                              <span className="text-text-secondary ml-1">{product.monthBudget?.toLocaleString()}</span>
                              <span className="text-text-muted ml-2">Sold:</span>
                              <span className={`ml-1 ${
                                (product.monthPct || 0) >= 100 ? "text-status-good" :
                                (product.monthPct || 0) >= 75 ? "text-status-warning" :
                                "text-status-bad"
                              }`}>
                                {product.monthSold?.toLocaleString()} ({product.monthPct}%)
                              </span>
                            </div>
                          )}
                        </td>
                        <td
                          className="text-right px-4 py-2.5 tabular-nums"
                          style={getCellStyle(product.hobson, "hobson")}
                        >
                          <span className={`text-base font-medium ${
                            product.hobson < 0
                              ? "text-red-400 bg-red-500/20 px-1.5 rounded font-bold"
                              : product.hobson > 0
                              ? "text-text-primary"
                              : "text-text-muted/50"
                          }`}>
                            {formatNumber(product.hobson)}
                          </span>
                        </td>
                        <td
                          className="text-right px-4 py-2.5 tabular-nums"
                          style={getCellStyle(product.selery, "selery")}
                        >
                          <span className={`text-base font-medium ${
                            product.selery < 0
                              ? "text-red-400 bg-red-500/20 px-1.5 rounded font-bold"
                              : product.selery > 0
                              ? "text-text-primary"
                              : "text-text-muted/50"
                          }`}>
                            {formatNumber(product.selery)}
                          </span>
                        </td>
                        <td
                          className="text-right px-4 py-2.5 tabular-nums"
                          style={getCellStyle(product.pipefitter, "pipefitter")}
                        >
                          <span className={`text-base font-medium ${
                            product.pipefitter < 0
                              ? "text-red-400 bg-red-500/20 px-1.5 rounded font-bold"
                              : product.pipefitter > 0
                              ? "text-text-primary"
                              : "text-text-muted/50"
                          }`}>
                            {formatNumber(product.pipefitter)}
                          </span>
                        </td>
                        <td className={`text-right py-2.5 tabular-nums ${showDoi ? "px-4" : "px-5"}`}>
                          <span className={`text-lg font-bold ${product.isBackordered ? "text-red-400 bg-red-500/20 px-1.5 rounded" : "text-white"}`}>
                            {formatNumber(product.total)}
                          </span>
                        </td>
                        {showDoi && (
                          <td className="text-right px-5 py-2.5 tabular-nums">
                            {product.isBackordered ? (
                              <span className="text-red-400 bg-red-500/20 px-2 py-0.5 rounded font-bold text-sm uppercase">
                                Backorder
                              </span>
                            ) : product.doi !== undefined ? (
                              <span
                                className={`text-base font-medium cursor-help ${
                                  product.doi < 7
                                    ? "text-red-400 bg-red-500/20 px-2 py-0.5 rounded font-bold"
                                    : product.doi < 30
                                    ? "text-status-bad"
                                    : product.doi < 60
                                    ? "text-status-warning"
                                    : "text-status-good"
                                }`}
                                title={product.stockoutWeek && product.stockoutYear
                                  ? `Stockout: Week ${product.stockoutWeek}, ${product.stockoutYear}`
                                  : undefined}
                              >
                                ~{product.doi}d
                              </span>
                            ) : (
                              <span className="text-text-muted/50">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {/* Category Total */}
                  <tr className="bg-bg-tertiary sticky bottom-0 border-t-2 border-border">
                    <td className="px-5 py-4 text-base text-text-primary font-bold">
                      {categoryLabels[category]} TOTAL
                    </td>
                    <td className="text-right px-4 py-4 text-lg text-amber-400 font-bold tabular-nums">
                      {formatNumber(categoryTotals.hobson)}
                    </td>
                    <td className="text-right px-4 py-4 text-lg text-green-400 font-bold tabular-nums">
                      {formatNumber(categoryTotals.selery)}
                    </td>
                    <td className="text-right px-4 py-4 text-lg text-blue-400 font-bold tabular-nums">
                      {formatNumber(categoryTotals.pipefitter)}
                    </td>
                    <td className={`text-right py-4 text-lg text-text-primary font-bold tabular-nums ${showDoi ? "px-4" : "px-5"}`}>
                      {formatNumber(categoryTotals.total)}
                    </td>
                    {showDoi && (
                      <td className="text-right px-5 py-4">
                        {/* DOI column - no aggregate */}
                      </td>
                    )}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Last synced */}
      {inventory?.lastSynced && (
        <div className="mt-3 text-xs text-text-muted text-right">
          Synced {formatDistanceToNow(new Date(inventory.lastSynced), { addSuffix: true })}
        </div>
      )}
    </div>
  );
}
