"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { format } from "date-fns";
import { useDashboard } from "../layout";
import type { MetricsResponse, StuckShipment, DailyBacklog } from "@/lib/types";
import { Calendar } from "lucide-react";
import { getDateBounds, parseLocalDate, type DateRangeOption } from "@/lib/dashboard-utils";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface FulfillmentContextType {
  // Metrics data
  metrics: MetricsResponse | null;
  loading: boolean;
  error: string | null;

  // Date range for fulfillment dashboard
  dateRangeOption: DateRangeOption;
  setDateRangeOption: (option: DateRangeOption) => void;
  customStartDate: string;
  setCustomStartDate: (date: string) => void;
  customEndDate: string;
  setCustomEndDate: (date: string) => void;

  // Stuck shipment filters
  stuckThreshold: 1 | 2 | 3;
  setStuckThreshold: (v: 1 | 2 | 3) => void;
  trackingShippedWithin: "7days" | "14days" | "30days" | "all";
  setTrackingShippedWithin: (v: "7days" | "14days" | "30days" | "all") => void;

  // Computed values
  filteredStuckShipments: StuckShipment[];
  chartData: Array<{
    date: string;
    rawDate: string;
    Smithey: number;
    Selery: number;
    Backlog: number;
  }>;

  // Actions
  refresh: () => void;
}

const FulfillmentContext = createContext<FulfillmentContextType | null>(null);

export function useFulfillment() {
  const context = useContext(FulfillmentContext);
  if (!context) {
    throw new Error("useFulfillment must be used within FulfillmentLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function FulfillmentLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isTracking = pathname === "/fulfillment/tracking";
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  // Metrics state
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date range for dashboard (affects what data is fetched)
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>("7days");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  // Stuck shipment filters (for tracking page)
  const [stuckThreshold, setStuckThreshold] = useState<1 | 2 | 3>(2);
  // Default to "all" - stuck shipments that have been stuck longest are by definition shipped longest ago
  // Filtering by "shipped within X days" excludes the most problematic stuck shipments
  const [trackingShippedWithin, setTrackingShippedWithin] = useState<"7days" | "14days" | "30days" | "all">("all");

  // Fetch metrics data
  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);

      // Parse custom dates if using custom range
      const customStart = customStartDate ? new Date(customStartDate) : undefined;
      const customEnd = customEndDate ? new Date(customEndDate) : undefined;
      const { start, end } = getDateBounds(dateRangeOption, customStart, customEnd);

      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
      });

      const res = await fetch(`/api/metrics?${params}`);
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const data: MetricsResponse = await res.json();
      setMetrics(data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Metrics fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch metrics");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [dateRangeOption, customStartDate, customEndDate, setLastRefresh, setIsRefreshing]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchMetrics);
    return () => setTriggerRefresh(null);
  }, [fetchMetrics, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!metrics && !loading) {
      fetchMetrics();
    }
  }, [metrics, loading, fetchMetrics]);

  // Refetch when date range changes
  useEffect(() => {
    if (metrics) {
      fetchMetrics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeOption]);

  // Auto-refresh every 5 minutes (matches original page.tsx behavior)
  useEffect(() => {
    const interval = setInterval(fetchMetrics, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Compute filtered stuck shipments
  const filteredStuckShipments = (() => {
    const shipments = metrics?.stuckShipments || [];

    // Filter by stuck threshold
    let filtered = shipments.filter((s) => s.days_without_scan >= stuckThreshold);

    // Filter by shipped within
    if (trackingShippedWithin !== "all") {
      const days = parseInt(trackingShippedWithin.replace("days", ""));
      filtered = filtered.filter((s) => s.days_since_shipped <= days);
    }

    return filtered;
  })();

  // Compute chart data from daily fulfillment and backlog (matches original processChartData)
  const chartData = (() => {
    const daily = metrics?.daily || [];
    const backlog = metrics?.dailyBacklog || [];

    // Build backlog map by date
    const backlogByDate = new Map<string, number>();
    for (const b of backlog) {
      backlogByDate.set(b.date, b.runningBacklog);
    }

    // Group by date - start with backlog dates to ensure all days show up
    const grouped = new Map<string, { smithey: number; selery: number; backlog: number }>();

    // First, add all dates from backlog (ensures all days show up even with 0 fulfillments)
    for (const b of backlog) {
      grouped.set(b.date, { smithey: 0, selery: 0, backlog: b.runningBacklog });
    }

    // Then overlay fulfillment data
    daily.forEach((d) => {
      const existing = grouped.get(d.date) || {
        smithey: 0,
        selery: 0,
        backlog: backlogByDate.get(d.date) || 0
      };
      if (d.warehouse === "smithey") {
        existing.smithey = d.count;
      } else if (d.warehouse === "selery") {
        existing.selery = d.count;
      }
      grouped.set(d.date, existing);
    });

    // Convert to array and sort
    return Array.from(grouped.entries())
      .map(([date, counts]) => ({
        date: format(parseLocalDate(date), "M/d"),
        rawDate: date,
        Smithey: counts.smithey,
        Selery: counts.selery,
        Backlog: counts.backlog,
      }))
      .sort((a, b) => a.rawDate.localeCompare(b.rawDate));
  })();

  // Context value
  const contextValue: FulfillmentContextType = {
    metrics,
    loading,
    error,
    dateRangeOption,
    setDateRangeOption,
    customStartDate,
    setCustomStartDate,
    customEndDate,
    setCustomEndDate,
    stuckThreshold,
    setStuckThreshold,
    trackingShippedWithin,
    setTrackingShippedWithin,
    filteredStuckShipments,
    chartData,
    refresh: fetchMetrics,
  };

  return (
    <FulfillmentContext.Provider value={contextValue}>
      <div className="space-y-4">
        {/* Sub-navigation tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-4 border-b border-border/30 pb-2">
            <Link
              href="/fulfillment"
              className={`text-sm font-medium transition-all pb-2 border-b-2 ${
                !isTracking
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/fulfillment/tracking"
              className={`text-sm font-medium transition-all pb-2 border-b-2 ${
                isTracking
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Tracking
            </Link>
          </div>

          {/* Date Range Selector - show on Tracking page (matches original behavior) */}
          {isTracking && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-2">
                {(["today", "yesterday", "3days", "7days", "30days", "custom"] as DateRangeOption[]).map((option) => {
                  const labels: Record<DateRangeOption, string> = {
                    today: "Today",
                    yesterday: "Yesterday",
                    "3days": "3 Days",
                    "7days": "7 Days",
                    "30days": "30 Days",
                    "90days": "90 Days",
                    custom: "Custom",
                  };
                  return (
                    <button
                      key={option}
                      onClick={() => setDateRangeOption(option)}
                      className={`px-3 py-1.5 text-sm font-medium transition-all border rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary ${
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
        </div>

        {/* Error display */}
        {error && (
          <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm">
            <strong>Error:</strong> {error}
            <button
              onClick={fetchMetrics}
              className="ml-4 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {children}
      </div>
    </FulfillmentContext.Provider>
  );
}
