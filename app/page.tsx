"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { RefreshCw, Package, Clock, CheckCircle, AlertCircle } from "lucide-react";
import type { MetricsResponse, WarehouseMetrics, DailyFulfillment } from "@/lib/types";

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

  // Initial fetch
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(fetchMetrics, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Process daily data for chart
  const chartData = processChartData(metrics?.daily || []);

  // Calculate totals
  const totals = metrics?.warehouses.reduce(
    (acc, wh) => ({
      unfulfilled: acc.unfulfilled + wh.unfulfilled_count,
      partial: acc.partial + wh.partial_count,
      fulfilledToday: acc.fulfilledToday + wh.fulfilled_today,
    }),
    { unfulfilled: 0, partial: 0, fulfilledToday: 0 }
  ) || { unfulfilled: 0, partial: 0, fulfilledToday: 0 };

  return (
    <div className="min-h-screen p-6 md:p-8">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
              Warehouse Dashboard
            </h1>
            <p className="text-text-tertiary text-context mt-1">
              Fulfillment tracking for Smithey & Selery
            </p>
          </div>
          <div className="flex items-center gap-4">
            {lastRefresh && (
              <span className="text-text-muted text-context">
                Updated {format(lastRefresh, "h:mm a")}
              </span>
            )}
            <button
              onClick={fetchMetrics}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-bg-secondary text-text-secondary hover:text-text-primary border border-border hover:border-border-hover rounded transition-all duration-200 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span className="text-sm font-medium">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-status-bad/10 border border-status-bad rounded flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-status-bad" />
          <span className="text-status-bad">{error}</span>
        </div>
      )}

      {/* Status Banner */}
      <StatusBanner totals={totals} loading={loading} />

      {/* Warehouse KPI Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {metrics?.warehouses.map((wh) => (
          <WarehouseCard key={wh.warehouse} data={wh} loading={loading} />
        ))}
      </div>

      {/* 30-Day Fulfillment Chart */}
      <div className="bg-bg-secondary rounded border border-border p-6 transition-all duration-200 hover:border-border-hover">
        <h3 className="text-label font-medium text-text-tertiary mb-6 tracking-wide-sm">
          DAILY FULFILLMENTS (30 DAYS)
        </h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} barCategoryGap="15%">
              <CartesianGrid
                strokeDasharray="1 3"
                stroke="rgba(255,255,255,0.03)"
                strokeWidth={0.5}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                stroke="#64748B"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              />
              <YAxis
                stroke="#64748B"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1A1D2A",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "6px",
                  fontSize: "13px",
                }}
                labelStyle={{ color: "#94A3B8", marginBottom: "4px" }}
                cursor={{ fill: "rgba(255,255,255,0.02)" }}
              />
              <Legend
                wrapperStyle={{ fontSize: "12px", paddingTop: "16px" }}
                iconType="square"
              />
              <Bar
                dataKey="Smithey"
                fill="#0EA5E9"
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
              />
              <Bar
                dataKey="Selery"
                fill="#06B6D4"
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[320px] flex items-center justify-center text-text-tertiary">
            <div className="text-center">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-context">No fulfillment data available</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Status Banner Component
function StatusBanner({
  totals,
  loading,
}: {
  totals: { unfulfilled: number; partial: number; fulfilledToday: number };
  loading: boolean;
}) {
  const hasIssues = totals.partial > 0;
  const isIdle = totals.unfulfilled === 0 && totals.partial === 0;

  return (
    <div
      className={`rounded-lg p-5 mb-8 flex items-center justify-between transition-all duration-200 ${
        loading
          ? "bg-bg-tertiary border border-border"
          : isIdle
          ? "bg-status-good/10 border-2 border-status-good"
          : hasIssues
          ? "bg-status-warning/10 border-2 border-status-warning"
          : "bg-bg-tertiary border border-border"
      }`}
    >
      <div className="flex items-center gap-4">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center ${
            loading
              ? "bg-bg-secondary"
              : isIdle
              ? "bg-status-good/20"
              : hasIssues
              ? "bg-status-warning/20"
              : "bg-bg-secondary"
          }`}
        >
          {loading ? (
            <RefreshCw className="w-6 h-6 text-text-tertiary animate-spin" />
          ) : isIdle ? (
            <CheckCircle className="w-6 h-6 text-status-good" />
          ) : hasIssues ? (
            <AlertCircle className="w-6 h-6 text-status-warning" />
          ) : (
            <Package className="w-6 h-6 text-text-tertiary" />
          )}
        </div>
        <div>
          <div
            className={`text-xl font-bold ${
              loading
                ? "text-text-secondary"
                : isIdle
                ? "text-status-good"
                : hasIssues
                ? "text-status-warning"
                : "text-text-primary"
            }`}
          >
            {loading
              ? "LOADING..."
              : isIdle
              ? "ALL ORDERS FULFILLED"
              : hasIssues
              ? `${totals.partial} PARTIAL ORDERS`
              : `${totals.unfulfilled} ORDERS PENDING`}
          </div>
          <div className="text-base text-text-secondary">
            {loading
              ? "Fetching warehouse data"
              : isIdle
              ? "No pending orders in queue"
              : `${totals.fulfilledToday} fulfilled today`}
          </div>
        </div>
      </div>
      {!loading && !isIdle && (
        <div className="text-right">
          <div className="text-3xl font-light text-text-primary">
            {totals.unfulfilled + totals.partial}
          </div>
          <div className="text-sm text-text-tertiary uppercase">Total Queue</div>
        </div>
      )}
    </div>
  );
}

// Warehouse Card Component
function WarehouseCard({
  data,
  loading,
}: {
  data: WarehouseMetrics;
  loading: boolean;
}) {
  const warehouseName = data.warehouse.charAt(0).toUpperCase() + data.warehouse.slice(1);
  const totalQueue = data.unfulfilled_count + data.partial_count;

  return (
    <div className="bg-bg-secondary rounded border border-border p-6 transition-all duration-200 hover:border-border-hover hover:shadow-card-hover">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-label font-medium text-text-tertiary tracking-wide-sm">
          {warehouseName.toUpperCase()}
        </h2>
        <div
          className={`px-3 py-1 rounded text-xs font-medium ${
            totalQueue === 0
              ? "bg-status-good/20 text-status-good"
              : data.partial_count > 0
              ? "bg-status-warning/20 text-status-warning"
              : "bg-bg-tertiary text-text-secondary"
          }`}
        >
          {totalQueue === 0 ? "CLEAR" : `${totalQueue} PENDING`}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* Unfulfilled */}
        <div>
          <div className="text-metric font-light tracking-tight-sm text-text-primary">
            {loading ? "-" : data.unfulfilled_count.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Package className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-context text-text-tertiary">Unfulfilled</span>
          </div>
        </div>

        {/* Partial */}
        <div>
          <div
            className={`text-metric font-light tracking-tight-sm ${
              data.partial_count > 0 ? "text-status-warning" : "text-text-primary"
            }`}
          >
            {loading ? "-" : data.partial_count.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Clock className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-context text-text-tertiary">Partial</span>
          </div>
        </div>

        {/* Fulfilled Today */}
        <div>
          <div className="text-metric font-light tracking-tight-sm text-status-good">
            {loading ? "-" : data.fulfilled_today.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <CheckCircle className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-context text-text-tertiary">Today</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Process daily fulfillment data for chart
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
      date: format(new Date(date), "MMM d"),
      ...counts,
    }))
    .slice(-30); // Last 30 days
}
