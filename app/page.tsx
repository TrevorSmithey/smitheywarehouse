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
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
  Cell,
  LabelList,
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
  CalendarDays,
  Pen,
  BarChart3,
  Gift,
  Hammer,
  Target,
  Download,
  MessageCircle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
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
  HolidayResponse,
  HolidayData,
  AssemblyResponse,
  DailyAssembly,
  BudgetResponse,
  BudgetDateRange,
  BudgetCategoryData,
  CompareType,
  TicketsResponse,
  TicketCategory,
} from "@/lib/types";
import { USTransitMap } from "@/components/USTransitMap";
import { SyncHealthBanner } from "@/components/SyncHealthBanner";
import { VoiceOfCustomerDashboard } from "@/components/VoiceOfCustomerDashboard";
import { SAFETY_STOCK } from "@/lib/shiphero";

type DateRangeOption = "today" | "yesterday" | "3days" | "7days" | "30days" | "custom";
type PrimaryTab = "inventory" | "holiday" | "assembly" | "fulfillment" | "budget" | "voc";
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

  // Global date range state - default to 7 days
  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>("7days");
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
  const [inventoryExpandedCategories, setInventoryExpandedCategories] = useState<Set<string>>(
    new Set(["cast_iron", "carbon_steel", "accessory"]) // factory_second collapsed by default
  );

  // Holiday tab state
  const [holidayData, setHolidayData] = useState<HolidayResponse | null>(null);
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [assemblyData, setAssemblyData] = useState<AssemblyResponse | null>(null);
  const [assemblyLoading, setAssemblyLoading] = useState(false);

  // Budget tab state
  const [budgetData, setBudgetData] = useState<BudgetResponse | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetDateRange, setBudgetDateRange] = useState<BudgetDateRange>("mtd");
  const [budgetCustomStart, setBudgetCustomStart] = useState<string>("");
  const [budgetCustomEnd, setBudgetCustomEnd] = useState<string>("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["cast_iron", "carbon_steel", "glass_lid", "accessories"]));

  // Support tickets tab state
  const [ticketsData, setTicketsData] = useState<TicketsResponse | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsDateRange, setTicketsDateRange] = useState<"today" | "7days" | "30days" | "90days" | "custom">("7days");
  const [ticketsCustomStart, setTicketsCustomStart] = useState<string>("");
  const [ticketsCustomEnd, setTicketsCustomEnd] = useState<string>("");
  const [ticketsCategoryFilter, setTicketsCategoryFilter] = useState<TicketCategory | "all">("all");
  const [ticketsSentimentFilter, setTicketsSentimentFilter] = useState<"all" | "Positive" | "Negative" | "Neutral" | "Mixed">("all");
  const [ticketsSearch, setTicketsSearch] = useState<string>("");
  const [ticketsPage, setTicketsPage] = useState(1);

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

  // Fetch holiday data
  const fetchHoliday = useCallback(async () => {
    try {
      setHolidayLoading(true);
      const res = await fetch("/api/holiday");
      if (!res.ok) throw new Error("Failed to fetch holiday data");
      const data: HolidayResponse = await res.json();
      setHolidayData(data);
    } catch (err) {
      console.error("Holiday fetch error:", err);
    } finally {
      setHolidayLoading(false);
    }
  }, []);

  // Load holiday data when switching to holiday tab
  useEffect(() => {
    if (primaryTab === "holiday" && !holidayData && !holidayLoading) {
      fetchHoliday();
    }
  }, [primaryTab, holidayData, holidayLoading, fetchHoliday]);

  // Fetch assembly data
  const fetchAssembly = useCallback(async () => {
    try {
      setAssemblyLoading(true);
      const res = await fetch("/api/assembly");
      if (!res.ok) throw new Error("Failed to fetch assembly data");
      const data: AssemblyResponse = await res.json();
      setAssemblyData(data);
    } catch (err) {
      console.error("Assembly fetch error:", err);
    } finally {
      setAssemblyLoading(false);
    }
  }, []);

  // Load assembly data when switching to assembly tab
  useEffect(() => {
    if (primaryTab === "assembly" && !assemblyData && !assemblyLoading) {
      fetchAssembly();
    }
  }, [primaryTab, assemblyData, assemblyLoading, fetchAssembly]);

  // Fetch budget data
  const fetchBudget = useCallback(async (
    range: BudgetDateRange = budgetDateRange,
    customStart?: string,
    customEnd?: string
  ) => {
    try {
      setBudgetLoading(true);
      let url = `/api/budget?range=${range}`;
      if (range === "custom" && customStart && customEnd) {
        url += `&start=${customStart}&end=${customEnd}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch budget data");
      const data: BudgetResponse = await res.json();
      setBudgetData(data);
    } catch (err) {
      console.error("Budget fetch error:", err);
    } finally {
      setBudgetLoading(false);
    }
  }, [budgetDateRange]);

  // Load budget data when switching to budget tab
  useEffect(() => {
    if (primaryTab === "budget" && !budgetData && !budgetLoading) {
      fetchBudget();
    }
  }, [primaryTab, budgetData, budgetLoading, fetchBudget]);

  // Refetch budget when date range or custom dates change
  // Note: primaryTab and budgetData are intentionally excluded from dependencies
  // - primaryTab: we don't want to refetch when switching tabs (handled by separate useEffect above)
  // - budgetData: we check it as a guard, not as a trigger (prevents infinite loop)
  // - fetchBudget: stable callback, but including it would cause unnecessary refetches
  useEffect(() => {
    if (primaryTab === "budget" && budgetData) {
      if (budgetDateRange === "custom") {
        if (budgetCustomStart && budgetCustomEnd) {
          fetchBudget(budgetDateRange, budgetCustomStart, budgetCustomEnd);
        }
      } else {
        fetchBudget(budgetDateRange);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetDateRange, budgetCustomStart, budgetCustomEnd]);

  // Fetch tickets data
  const fetchTickets = useCallback(async () => {
    try {
      setTicketsLoading(true);
      const params = new URLSearchParams();
      params.set("page", ticketsPage.toString());

      // Date range
      const now = new Date();
      let startDate: Date;
      if (ticketsDateRange === "today") {
        // Start of today (midnight)
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      } else if (ticketsDateRange === "7days") {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (ticketsDateRange === "30days") {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (ticketsDateRange === "90days") {
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      } else if (ticketsDateRange === "custom" && ticketsCustomStart && ticketsCustomEnd) {
        startDate = new Date(ticketsCustomStart);
        params.set("end", ticketsCustomEnd);
      } else {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      params.set("start", startDate.toISOString());
      if (ticketsDateRange !== "custom") {
        params.set("end", now.toISOString());
      }

      if (ticketsCategoryFilter !== "all") {
        params.set("category", ticketsCategoryFilter);
      }
      if (ticketsSentimentFilter !== "all") {
        params.set("sentiment", ticketsSentimentFilter);
      }
      if (ticketsSearch) {
        params.set("search", ticketsSearch);
      }

      const res = await fetch(`/api/tickets?${params}`);
      if (!res.ok) throw new Error("Failed to fetch tickets");
      const data: TicketsResponse = await res.json();
      setTicketsData(data);
    } catch (err) {
      console.error("Tickets fetch error:", err);
    } finally {
      setTicketsLoading(false);
    }
  }, [ticketsDateRange, ticketsCustomStart, ticketsCustomEnd, ticketsCategoryFilter, ticketsSentimentFilter, ticketsSearch, ticketsPage]);

  // Load tickets when switching to support tab
  useEffect(() => {
    if (primaryTab === "voc" && !ticketsData && !ticketsLoading) {
      fetchTickets();
    }
  }, [primaryTab, ticketsData, ticketsLoading, fetchTickets]);

  // Refetch tickets when filters change
  useEffect(() => {
    if (primaryTab === "voc" && ticketsData) {
      fetchTickets();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketsDateRange, ticketsCustomStart, ticketsCustomEnd, ticketsCategoryFilter, ticketsSentimentFilter, ticketsSearch, ticketsPage]);

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
    <div className="min-h-screen bg-bg-primary text-text-primary p-4 sm:p-6 overscroll-none">
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
                SMITHEY OPERATIONS
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
            aria-label="Refresh data"
            className="p-2 text-text-tertiary hover:text-accent-blue transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary rounded"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Date Range Selector - only show on Fulfillment Tracking sub-tab */}
        {primaryTab === "fulfillment" && fulfillmentSubTab === "tracking" && (
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

        {/* Primary Tab Selector */}
        <div className="flex gap-1 mt-4 border-b border-border overflow-x-auto touch-pan-x">
          <button
            onClick={() => setPrimaryTab("inventory")}
            className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
              primaryTab === "inventory"
                ? "text-accent-blue border-accent-blue"
                : "text-text-tertiary border-transparent hover:text-text-secondary"
            }`}
          >
            <BarChart3 className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
            INVENTORY
          </button>
          <button
            onClick={() => setPrimaryTab("voc")}
            className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
              primaryTab === "voc"
                ? "text-accent-blue border-accent-blue"
                : "text-text-tertiary border-transparent hover:text-text-secondary"
            }`}
          >
            <MessageCircle className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
            VOC
          </button>
          <button
            onClick={() => setPrimaryTab("budget")}
            className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
              primaryTab === "budget"
                ? "text-accent-blue border-accent-blue"
                : "text-text-tertiary border-transparent hover:text-text-secondary"
            }`}
          >
            <Target className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
            BUDGET V ACTUAL
          </button>
          <button
            onClick={() => setPrimaryTab("assembly")}
            className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
              primaryTab === "assembly"
                ? "text-accent-blue border-accent-blue"
                : "text-text-tertiary border-transparent hover:text-text-secondary"
            }`}
          >
            <Hammer className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
            PRODUCTION
          </button>
          <button
            onClick={() => setPrimaryTab("fulfillment")}
            className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
              primaryTab === "fulfillment"
                ? "text-accent-blue border-accent-blue"
                : "text-text-tertiary border-transparent hover:text-text-secondary"
            }`}
          >
            <Package className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
            FULFILLMENT
          </button>
          <button
            onClick={() => setPrimaryTab("holiday")}
            className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
              primaryTab === "holiday"
                ? "text-accent-blue border-accent-blue"
                : "text-text-tertiary border-transparent hover:text-text-secondary"
            }`}
          >
            <Gift className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
            Q4 PACE
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
          {/* Hero Section - Key metrics + engraving */}
          <div className="bg-bg-secondary rounded-xl border border-border/30 p-6 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <h2 className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">FULFILLMENT OVERVIEW</h2>
              <div className="flex items-center gap-1">
                {(["today", "3days", "7days", "30days"] as const).map((option) => {
                  const labels = { today: "Today", "3days": "3D", "7days": "7D", "30days": "30D" };
                  return (
                    <button
                      key={option}
                      onClick={() => setDateRangeOption(option)}
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

              {/* 3. Days to Clear */}
              {(() => {
                const daysInRange = getDaysInRange(dateRangeOption);
                const avgPerDay = daysInRange > 0 ? Math.round(totals.today / daysInRange) : 0;
                const daysToClear = avgPerDay > 0 ? Math.round(totals.queue / avgPerDay) : 0;
                return (
                  <div>
                    <div className={`text-4xl font-bold tabular-nums ${daysToClear > 5 ? "text-status-warning" : "text-text-primary"}`}>
                      {loading || avgPerDay === 0 ? "—" : `~${daysToClear}d`}
                    </div>
                    <div className="text-xs text-text-muted mt-1">TO CLEAR</div>
                  </div>
                );
              })()}

              {/* 4. Total Shipped */}
              <div>
                <div className="text-4xl font-bold tabular-nums text-status-good">
                  {loading ? "—" : formatNumber(totals.today)}
                </div>
                <div className="text-xs mt-1">
                  <span className="text-text-muted">SHIPPED</span>
                  {dateRangeOption === "today" && todayVsAvg !== undefined && todayVsAvg !== 0 && !loading && (
                    <span className={`ml-2 ${todayVsAvg > 0 ? "text-status-good" : "text-status-bad"}`}>
                      {todayVsAvg > 0 ? "↑" : "↓"}{Math.abs(todayVsAvg).toFixed(0)}% vs 7d avg
                    </span>
                  )}
                </div>
              </div>

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
              const daysInRange = getDaysInRange(dateRangeOption);
              const avgPerDay = daysInRange > 0 ? Math.round(wh.fulfilled_today / daysInRange) : 0;
              const queueSize = wh.unfulfilled_count + wh.partial_count;
              const daysToClear = avgPerDay > 0 ? Math.round(queueSize / avgPerDay) : 0;

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
                    {/* Primary Metrics Row - matches hero order: Queue, Avg/Day, To Clear, Shipped */}
                    <div className="grid grid-cols-4 gap-4 mb-4">
                      <div>
                        <div className="text-2xl font-bold tabular-nums text-text-primary">{formatNumber(queueSize)}</div>
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">QUEUE</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold tabular-nums text-text-primary">{formatNumber(avgPerDay)}</div>
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">AVG/DAY</div>
                      </div>
                      <div>
                        <div className={`text-2xl font-bold tabular-nums ${daysToClear > 5 ? "text-status-warning" : "text-text-primary"}`}>
                          {avgPerDay > 0 ? `~${daysToClear}d` : "—"}
                        </div>
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">TO CLEAR</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold tabular-nums text-status-good">{formatNumber(wh.fulfilled_today)}</div>
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-text-muted mt-1">SHIPPED</div>
                      </div>
                    </div>

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
      )}

      {/* TRACKING SUB-TAB */}
      {primaryTab === "fulfillment" && fulfillmentSubTab === "tracking" && (
        <>
          {/* Tracking Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
              <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-status-warning" />
                STUCK SHIPMENTS
              </div>
              <div className={`text-4xl font-bold tabular-nums ${stuckCount > 0 ? "text-status-warning" : "text-text-primary"}`}>
                {formatNumber(stuckCount)}
              </div>
              <div className="text-xs text-text-muted mt-1">
                No scans in {stuckThreshold}+ day{stuckThreshold > 1 ? "s" : ""}
              </div>
            </div>
            <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
              <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
                <Package className="w-3 h-3" />
                DELIVERED
              </div>
              <div className="text-4xl font-bold tabular-nums text-status-good">
                {formatNumber((metrics?.transitAnalytics || []).reduce((sum, t) => sum + t.total_delivered, 0))}
              </div>
              <div className="text-xs text-text-muted mt-1">
                Shipments delivered
              </div>
            </div>
            <div className="bg-bg-secondary rounded-xl border border-border/30 p-6">
              <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2 flex items-center gap-1.5">
                <Truck className="w-3 h-3" />
                AVG TRANSIT
              </div>
              <div className="text-4xl font-bold tabular-nums text-text-primary">
                {(() => {
                  const analytics = metrics?.transitAnalytics || [];
                  const totalDelivered = analytics.reduce((sum, t) => sum + t.total_delivered, 0);
                  const weightedSum = analytics.reduce((sum, t) => sum + (t.avg_transit_days * t.total_delivered), 0);
                  return totalDelivered > 0 ? (weightedSum / totalDelivered).toFixed(1) : "—";
                })()}d
              </div>
              <div className="text-xs text-text-muted mt-1">
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
          expandedCategories={inventoryExpandedCategories}
          onToggleCategory={(cat) => {
            setInventoryExpandedCategories((prev) => {
              const next = new Set(prev);
              if (next.has(cat)) next.delete(cat);
              else next.add(cat);
              return next;
            });
          }}
          onRefresh={fetchInventory}
        />
      )}

      {/* HOLIDAY TAB */}
      {primaryTab === "holiday" && (
        <HolidayDashboard
          data={holidayData}
          loading={holidayLoading}
          onRefresh={fetchHoliday}
        />
      )}

      {/* ASSEMBLY TAB */}
      {primaryTab === "assembly" && (
        <AssemblyDashboard
          data={assemblyData}
          loading={assemblyLoading}
          onRefresh={fetchAssembly}
        />
      )}

      {/* BUDGET TAB */}
      {primaryTab === "budget" && (
        <BudgetDashboard
          data={budgetData}
          loading={budgetLoading}
          dateRange={budgetDateRange}
          onDateRangeChange={(range) => setBudgetDateRange(range)}
          customStart={budgetCustomStart}
          customEnd={budgetCustomEnd}
          onCustomStartChange={setBudgetCustomStart}
          onCustomEndChange={setBudgetCustomEnd}
          onRefresh={() => fetchBudget(budgetDateRange, budgetCustomStart, budgetCustomEnd)}
          expandedCategories={expandedCategories}
          onToggleCategory={(cat) => {
            setExpandedCategories((prev) => {
              const next = new Set(prev);
              if (next.has(cat)) {
                next.delete(cat);
              } else {
                next.add(cat);
              }
              return next;
            });
          }}
        />
      )}

      {/* VOICE OF CUSTOMER TAB */}
      {primaryTab === "voc" && (
        <VoiceOfCustomerDashboard
          data={ticketsData}
          loading={ticketsLoading}
          dateRange={ticketsDateRange}
          onDateRangeChange={setTicketsDateRange}
          customStart={ticketsCustomStart}
          customEnd={ticketsCustomEnd}
          onCustomStartChange={setTicketsCustomStart}
          onCustomEndChange={setTicketsCustomEnd}
          categoryFilter={ticketsCategoryFilter}
          onCategoryFilterChange={setTicketsCategoryFilter}
          sentimentFilter={ticketsSentimentFilter}
          onSentimentFilterChange={setTicketsSentimentFilter}
          search={ticketsSearch}
          onSearchChange={setTicketsSearch}
          page={ticketsPage}
          onPageChange={setTicketsPage}
          onRefresh={fetchTickets}
        />
      )}

      {/* Sync Health Banner - data freshness indicator at bottom of ALL pages */}
      <SyncHealthBanner />
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
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6 transition-all duration-200 hover:border-border-hover hover:shadow-card-hover hover:-translate-y-px">
      <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted font-medium mb-2">
        {label}
        {note && <span className="text-text-muted font-normal text-[10px] ml-1">({note})</span>}
      </div>
      <div
        className={`text-4xl font-bold tabular-nums ${
          status ? statusColors[status] : "text-text-primary"
        }`}
      >
        {loading ? "—" : formatNumber(value)}
      </div>
      {/* Change indicator - like Lathe app */}
      {change !== undefined && !loading && (
        <div className="text-xs text-text-secondary mt-1">
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
        <div className="text-xs text-text-muted mt-1">{subtitle}</div>
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
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-6 transition-all duration-200 hover:border-border-hover hover:shadow-card-hover hover:-translate-y-px">
      <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted font-medium mb-2 flex items-center gap-1.5">
        <Pen className="w-3 h-3" />
        ENGRAVING QUEUE
        <span className="text-text-muted font-normal text-[10px] ml-1">(running total)</span>
      </div>
      <div
        className={`text-4xl font-bold tabular-nums ${
          status ? statusColors[status] : "text-text-primary"
        }`}
      >
        {loading ? "—" : formatNumber(totalUnits)}
      </div>
      <div className="text-xs text-text-secondary mt-1">
        <span className={status ? statusColors[status] : "text-text-primary"}>
          ~{estimatedDays}d
        </span>
        <span className="text-text-muted ml-1">lead time</span>
      </div>
      <div className="text-xs text-text-muted mt-1">
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
    <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden transition-all hover:border-border-hover">
      {/* Header */}
      <div
        className={`px-6 py-4 border-b border-border/30 flex items-center justify-between ${
          isSmithey
            ? "border-l-2 border-l-accent-blue"
            : "border-l-2 border-l-text-tertiary"
        }`}
      >
        <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.15em] text-text-primary">
          {name}
        </span>
        <div className="flex items-center gap-1 text-xs">
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mb-6">
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
            <div className="max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
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
            <div className="max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
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
              itemStyle={{ color: "#E2E8F0" }}
              formatter={(value: number, name: string) => [<span key="v" style={{ color: name === "Smithey" ? "#0EA5E9" : "#8B5CF6", fontWeight: 600 }}>{value}%</span>, name]}
            />
            <ReferenceLine y={50} stroke="#64748B" strokeDasharray="3 3" strokeOpacity={0.5} />
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
// 4-table collapsible layout like Budget vs Actual
function InventoryDashboard({
  inventory,
  loading,
  expandedCategories,
  onToggleCategory,
  onRefresh,
}: {
  inventory: InventoryResponse | null;
  loading: boolean;
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
  onRefresh: () => void;
}) {

  // Download inventory as CSV
  const downloadCSV = () => {
    if (!inventory) return;

    // Get all products from all categories
    const allProducts = [
      ...inventory.byCategory.cast_iron,
      ...inventory.byCategory.carbon_steel,
      ...inventory.byCategory.accessory,
      ...inventory.byCategory.glass_lid,
      ...inventory.byCategory.factory_second,
    ];

    // Sort by SKU for consistent output
    allProducts.sort((a, b) => a.sku.localeCompare(b.sku));

    // CSV headers
    const headers = ["SKU", "Display Name", "Category", "Hobson", "Selery", "Pipefitter", "Total", "DOI", "Month Sold", "Month Budget", "Month %"];

    // CSV rows
    const rows = allProducts.map(p => [
      p.sku,
      `"${p.displayName.replace(/"/g, '""')}"`, // Escape quotes in display name
      p.category,
      p.hobson,
      p.selery,
      p.pipefitter,
      p.total,
      p.doi !== undefined ? p.doi : "",
      p.monthSold !== undefined ? p.monthSold : "",
      p.monthBudget !== undefined ? p.monthBudget : "",
      p.monthPct !== undefined ? `${p.monthPct}%` : "",
    ]);

    // Build CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    // Create download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const today = new Date().toISOString().split("T")[0];
    link.download = `smithey-inventory-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download velocity as CSV
  const downloadVelocityCSV = () => {
    if (!inventory?.salesVelocity) return;

    // Combine cast iron and carbon steel velocity data
    const allVelocity = [
      ...inventory.salesVelocity.cast_iron,
      ...inventory.salesVelocity.carbon_steel,
    ];

    // Sort by daily average descending
    allVelocity.sort((a, b) => b.sales3DayAvg - a.sales3DayAvg);

    // CSV headers
    const headers = ["SKU", "Display Name", "Category", "3-Day Total", "Daily Avg", "Prior Daily Avg", "Change %"];

    // CSV rows
    const rows = allVelocity.map(v => [
      v.sku,
      `"${v.displayName.replace(/"/g, '""')}"`,
      v.category,
      v.sales3DayTotal,
      v.sales3DayAvg,
      v.prior3DayAvg,
      `${v.delta > 0 ? "+" : ""}${v.delta}%`,
    ]);

    // Build CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    // Create download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const today = new Date().toISOString().split("T")[0];
    link.download = `smithey-velocity-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Category config - factory seconds last, collapsed by default
  const categoryConfig: {
    key: InventoryCategoryTab;
    label: string;
    showDoi: boolean;
    showVelocity: boolean;
  }[] = [
    { key: "cast_iron", label: "CAST IRON", showDoi: true, showVelocity: true },
    { key: "carbon_steel", label: "CARBON STEEL", showDoi: true, showVelocity: true },
    { key: "accessory", label: "ACCESSORIES", showDoi: true, showVelocity: true },
    { key: "factory_second", label: "FACTORY SECONDS", showDoi: false, showVelocity: false },
  ];

  // Build velocity lookup for quick SKU access (store full data for tooltips)
  const velocityBySku = new Map<string, { avg: number; total: number; prior: number; delta: number }>();
  if (inventory?.salesVelocity) {
    const allVelocity = [
      ...(inventory.salesVelocity.cast_iron || []),
      ...(inventory.salesVelocity.carbon_steel || []),
      ...(inventory.salesVelocity.accessory || []),
      ...(inventory.salesVelocity.glass_lid || []),
    ];
    for (const item of allVelocity) {
      velocityBySku.set(item.sku.toLowerCase(), {
        avg: item.sales3DayAvg,
        total: item.sales3DayTotal,
        prior: item.prior3DayAvg,
        delta: item.delta
      });
    }
  }

  // Get products for a category, sorted by DOI ascending (lowest first = most urgent)
  const getProductsForCategory = (cat: InventoryCategoryTab): ProductInventory[] => {
    let products: ProductInventory[] = [];
    if (cat === "accessory") {
      products = [
        ...(inventory?.byCategory.accessory || []),
        ...(inventory?.byCategory.glass_lid || []),
      ].filter(p => p.sku !== "Smith-AC-Glid11"); // Hide 11Lid from accessories
    } else {
      products = inventory?.byCategory[cat] || [];
    }
    // Sort by DOI ascending: backordered first (-1), then lowest DOI, then no DOI at end
    return [...products].sort((a, b) => {
      const aVal = a.isBackordered ? -1 : (a.doi ?? 9999);
      const bVal = b.isBackordered ? -1 : (b.doi ?? 9999);
      return aVal - bVal;
    });
  };

  // Calculate totals for a category
  const getCategoryTotals = (products: ProductInventory[]) => {
    return products.reduce(
      (acc, p) => ({
        pipefitter: acc.pipefitter + p.pipefitter,
        hobson: acc.hobson + p.hobson,
        selery: acc.selery + p.selery,
        total: acc.total + p.total,
      }),
      { pipefitter: 0, hobson: 0, selery: 0, total: 0 }
    );
  };

  // Calculate cookware totals (cast iron + carbon steel only)
  const cookwareProducts = [
    ...(inventory?.byCategory.cast_iron || []),
    ...(inventory?.byCategory.carbon_steel || []),
  ];

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

  // Get DOI status color
  const getDoiColor = (product: ProductInventory): string => {
    if (product.isBackordered) return "#F87171"; // red-400
    if (product.doi === undefined) return "#6B7280"; // gray-500
    if (product.doi < 7) return "#F87171"; // red-400
    if (product.doi < 30) return "#F59E0B"; // amber-500
    if (product.doi < 60) return "#FBBF24"; // yellow-400
    return "#34D399"; // emerald-400
  };

  // Get status label based on lowest DOI in category
  const getCategoryStatus = (products: ProductInventory[]): { label: string; color: string } => {
    const hasBackorder = products.some(p => p.isBackordered);
    if (hasBackorder) return { label: "BACKORDER", color: "#F87171" };
    const lowestDoi = Math.min(...products.filter(p => p.doi !== undefined).map(p => p.doi!), 9999);
    if (lowestDoi < 7) return { label: "URGENT", color: "#F87171" };
    if (lowestDoi < 30) return { label: "WATCH", color: "#F59E0B" };
    if (lowestDoi < 60) return { label: "OK", color: "#FBBF24" };
    return { label: "HEALTHY", color: "#34D399" };
  };

  // Loading state with branded spinner
  if (loading && !inventory) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-bg-tertiary" />
            <div
              className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent animate-spin"
              style={{ borderTopColor: "#0EA5E9", borderRightColor: "#0284C7" }}
            />
          </div>
          <span className="text-sm text-text-tertiary tracking-widest uppercase">Opening the vault...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header with Health Status + Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Health Summary */}
        <div className="flex items-center gap-2 bg-bg-secondary rounded-xl px-3 py-2 border border-border/30">
          {doiHealth.backorder > 0 || doiHealth.urgent > 0 || doiHealth.critical > 0 ? (
            <>
              {doiHealth.backorder > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <span className="text-sm font-bold text-red-400 tabular-nums">{doiHealth.backorder}</span>
                  <span className="text-[10px] text-red-400/80 font-semibold tracking-wide">BACKORDER</span>
                </div>
              )}
              {doiHealth.urgent > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <span className="text-sm font-bold text-red-400 tabular-nums">{doiHealth.urgent}</span>
                  <span className="text-[10px] text-red-400/80 font-semibold tracking-wide">URGENT</span>
                </div>
              )}
              {doiHealth.critical > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <span className="text-sm font-bold text-amber-400 tabular-nums">{doiHealth.critical}</span>
                  <span className="text-[10px] text-amber-400/80 font-semibold tracking-wide">WATCH</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-emerald-400 font-semibold">All Healthy</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            aria-label="Refresh inventory"
            className="p-2 rounded-lg transition-all hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          >
            <RefreshCw className={`w-4 h-4 text-text-tertiary ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={downloadCSV}
            aria-label="Download inventory CSV"
            className="p-2 rounded-lg transition-all hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
            disabled={!inventory}
          >
            <Download className="w-4 h-4 text-text-tertiary" />
          </button>
        </div>
      </div>

      {/* Category Cards - Full width for readable headings */}
      <div className="space-y-4">
        {categoryConfig.map((cat) => {
          const products = getProductsForCategory(cat.key);
          const totals = getCategoryTotals(products);
          const isExpanded = expandedCategories.has(cat.key);
          const status = cat.showDoi ? getCategoryStatus(products) : { label: "N/A", color: "#6B7280" };

          return (
            <div key={cat.key} className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
              {/* Collapsible Header - Category is hero */}
              <button
                onClick={() => onToggleCategory(cat.key)}
                className="w-full text-left hover:bg-bg-tertiary/30 transition-colors"
              >
                <div className="px-4 py-3 flex items-center justify-between">
                  {/* Left: Category name as hero */}
                  <div className="flex items-center gap-3">
                    <span className={`text-sm transition-transform text-text-muted ${isExpanded ? "rotate-90" : ""}`}>
                      ▶
                    </span>
                    <span className="text-base font-bold uppercase tracking-wide text-text-primary">
                      {cat.label}
                    </span>
                    <span className="text-sm text-text-tertiary">({products.length})</span>
                  </div>

                  {/* Right: Warehouse totals - hidden on mobile */}
                  <div className="hidden sm:flex text-sm tabular-nums items-center gap-1">
                    <span className="text-amber-400">{formatNumber(totals.hobson)}</span>
                    <span className="text-text-muted/50">/</span>
                    <span className="text-green-400">{formatNumber(totals.selery)}</span>
                    <span className="text-text-muted/50 mx-1">=</span>
                    <span className="text-text-primary font-bold">{formatNumber(totals.total)}</span>
                  </div>
                </div>
              </button>

              {/* Expanded Table */}
              {isExpanded && (
                <div className="border-t border-border">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-[32%] sm:w-[26%]" />
                      <col className="w-[20%] sm:w-[16%]" />
                      <col className="w-[20%] sm:w-[16%]" />
                      <col className="w-[28%] sm:w-[16%]" />
                      {cat.showDoi && <col className="sm:w-[13%]" />}
                      {cat.showVelocity && <col className="hidden sm:table-column w-[13%]" />}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-border/50 text-text-muted text-[11px] uppercase tracking-wider bg-bg-tertiary/30">
                        <th className="text-left py-2.5 px-2 sm:px-3 font-medium">Product</th>
                        <th className="text-right py-2.5 px-2 sm:px-4 font-medium text-amber-400">Hobson</th>
                        <th className="text-right py-2.5 px-2 sm:px-4 font-medium text-green-400">Selery</th>
                        <th className="text-right py-2.5 px-2 sm:px-4 font-medium">Total</th>
                        {cat.showDoi && (
                          <th className="text-right py-2.5 px-2 sm:px-4 font-medium text-purple-400">DOI</th>
                        )}
                        {cat.showVelocity && (
                          <th className="hidden sm:table-cell text-right py-2.5 px-4 font-medium text-cyan-400">Vel</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product, idx) => {
                        const doiColor = getDoiColor(product);
                        const velocity = velocityBySku.get(product.sku.toLowerCase());
                        const isNegative = product.total < 0;
                        const hasWarehouseNegative = product.hobson < 0 || product.selery < 0;
                        const safetyStock = SAFETY_STOCK[product.sku];
                        const isBelowSafetyStock = safetyStock && product.total < safetyStock;
                        // Build tooltip with budget % and velocity
                        const tooltipParts: string[] = [];
                        if (product.monthPct !== undefined) {
                          tooltipParts.push(`MTD: ${product.monthSold}/${product.monthBudget} (${product.monthPct}%)`);
                        }
                        if (velocity) {
                          const deltaStr = velocity.delta >= 0 ? `+${velocity.delta}%` : `${velocity.delta}%`;
                          tooltipParts.push(`Velocity: ${velocity.avg}/day (${deltaStr} vs prior)`);
                        }
                        if (product.stockoutWeek && product.stockoutYear) {
                          tooltipParts.push(`Stockout: Wk ${product.stockoutWeek}, ${product.stockoutYear}`);
                        }
                        const tooltip = tooltipParts.length > 0 ? tooltipParts.join(" | ") : undefined;

                        // Row background priority: negative (solid red) > SS violation (pulsing amber) > zebra
                        const rowBg = isNegative || hasWarehouseNegative
                          ? "bg-red-500/15"
                          : isBelowSafetyStock
                          ? "ss-violation"
                          : idx % 2 === 1
                          ? "bg-bg-tertiary/10"
                          : "";

                        const hasHighlight = rowBg && rowBg !== "bg-bg-tertiary/10";
                        const isPulsing = rowBg === "ss-violation";

                        return (
                          <tr
                            key={product.sku}
                            className={`border-b border-border/20 ${isPulsing ? "" : "transition-colors"} ${rowBg} ${!hasHighlight ? "hover:bg-bg-tertiary/40" : ""}`}
                          >
                            <td className="py-3 px-2 sm:px-3" title={tooltip}>
                              <div className="flex items-center gap-2">
                                {cat.showDoi && (
                                  <div
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: doiColor }}
                                  />
                                )}
                                <span className={`text-sm font-medium truncate ${isNegative ? "text-red-400" : "text-text-primary"}`}>
                                  {product.displayName}
                                </span>
                                {SAFETY_STOCK[product.sku] && (
                                  <span className="text-[10px] text-text-muted tabular-nums">
                                    ss:{SAFETY_STOCK[product.sku]}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-semibold ${
                              product.hobson < 0 ? "text-red-400 bg-red-500/10" :
                              product.hobson < 10 ? "text-amber-400 bg-status-warning/20" : "text-amber-400"
                            }`}>
                              {formatNumber(product.hobson)}
                            </td>
                            <td className={`py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-semibold ${
                              product.selery < 0 ? "text-red-400 bg-red-500/10" :
                              product.selery < 10 ? "text-green-400 bg-status-warning/20" : "text-green-400"
                            }`}>
                              {formatNumber(product.selery)}
                            </td>
                            <td className={`py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-bold ${
                              isNegative ? "text-red-400" : "text-text-primary"
                            }`}>
                              {formatNumber(product.total)}
                            </td>
                            {cat.showDoi && (
                              <td className="py-3 px-2 sm:px-4 text-right">
                                {product.isBackordered ? (
                                  <span className="text-sm font-bold text-red-400 uppercase">
                                    BACKORDER
                                  </span>
                                ) : product.doi !== undefined ? (
                                  <span
                                    className="inline-block text-sm font-bold tabular-nums px-2 py-0.5 rounded"
                                    style={{ backgroundColor: `${doiColor}20`, color: doiColor }}
                                  >
                                    {product.doi}d
                                  </span>
                                ) : (
                                  <span className="text-text-muted/50">—</span>
                                )}
                              </td>
                            )}
                            {cat.showVelocity && (
                              <td className="hidden sm:table-cell py-3 px-4 text-right">
                                {velocity ? (
                                  <span className={`text-sm font-bold tabular-nums ${
                                    velocity.avg >= 10 ? "text-emerald-400" :
                                    velocity.avg >= 5 ? "text-cyan-400" :
                                    velocity.avg > 0 ? "text-text-secondary" :
                                    "text-text-muted"
                                  }`}>
                                    {velocity.avg}/d
                                  </span>
                                ) : (
                                  <span className="text-text-muted/50">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-bg-tertiary/40">
                        <td className="py-3 px-2 sm:px-3 text-sm font-bold text-text-primary">TOTAL</td>
                        <td className="py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-bold text-amber-400">
                          {formatNumber(totals.hobson)}
                        </td>
                        <td className="py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-bold text-green-400">
                          {formatNumber(totals.selery)}
                        </td>
                        <td className="py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-bold text-text-primary">
                          {formatNumber(totals.total)}
                        </td>
                        {cat.showDoi && <td className="py-3 px-2 sm:px-4" />}
                        {cat.showVelocity && <td className="hidden sm:table-cell py-3 px-4" />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-text-muted">
        <div className="flex items-center gap-4">
          <span className="font-medium text-text-secondary">DOI:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span>&lt;7d Urgent</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>&lt;30d Watch</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <span>&lt;60d OK</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>60d+ Healthy</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-text-secondary">Vel:</span>
          <span>3-day avg sales/day</span>
        </div>
      </div>

      {/* Last synced */}
      {inventory?.lastSynced && (
        <div className="mt-2 text-xs text-text-muted text-right">
          Synced {formatDistanceToNow(new Date(inventory.lastSynced), { addSuffix: true })}
        </div>
      )}
    </div>
  );
}

// Holiday Dashboard - Q4 YoY Comparison
// Design: "The Craftsman's Ledger" - refined data presentation for a premium brand
function HolidayDashboard({
  data,
  loading,
  onRefresh,
}: {
  data: HolidayResponse | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
          <span className="text-sm text-text-tertiary tracking-wide">Loading holiday data...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Calendar className="w-12 h-12 text-text-muted" />
        <span className="text-text-tertiary">No holiday data available</span>
        <button
          onClick={onRefresh}
          className="px-4 py-2 text-sm bg-bg-secondary hover:bg-bg-tertiary rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>
    );
  }

  const { summary } = data;

  // Semantic colors: Emerald for 2025 (growth/current), Warm amber for 2024 (baseline)
  const colors = {
    current: "#10B981",    // Emerald - 2025, the year we're tracking
    baseline: "#F59E0B",   // Amber - 2024, warm baseline comparison
  };

  // Transform ALL data for charts (show full 92-day period)
  const chartData = data.data.map((d) => ({
    day: d.day_number,
    orders2024: d.orders_2024 || 0,
    orders2025: d.orders_2025,  // Keep null for days not yet reached
    sales2024: d.sales_2024 || 0,
    sales2025: d.sales_2025,
    cumOrders2024: d.cumulative_orders_2024 || 0,
    cumOrders2025: d.cumulative_orders_2025,
    cumSales2024: d.cumulative_sales_2024 || 0,
    cumSales2025: d.cumulative_sales_2025,
  }));

  // Find current day (last day with 2025 data)
  const currentDay = data.data.filter(d => d.orders_2025 !== null).length;
  const progressPct = Math.round((currentDay / 92) * 100);

  // Determine current month and calculate month-specific stats
  // Q4: Oct = days 1-31, Nov = days 32-61, Dec = days 62-92
  const getMonthFromDay = (day: number) => {
    if (day <= 31) return "october";
    if (day <= 61) return "november";
    return "december";
  };
  const currentMonth = getMonthFromDay(currentDay);
  const monthStartDay = currentMonth === "october" ? 1 : currentMonth === "november" ? 32 : 62;
  const monthLabel = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);

  // Filter data for current month only
  const monthData2025 = data.data.filter(d =>
    d.day_number >= monthStartDay && d.orders_2025 !== null
  );
  const monthData2024 = data.data.filter(d =>
    d.day_number >= monthStartDay && d.day_number < monthStartDay + monthData2025.length
  );

  // Calculate current month stats
  const monthStats = {
    orders2025: monthData2025.reduce((sum, d) => sum + (d.orders_2025 || 0), 0),
    orders2024: monthData2024.reduce((sum, d) => sum + (d.orders_2024 || 0), 0),
    revenue2025: monthData2025.reduce((sum, d) => sum + (d.sales_2025 || 0), 0),
    revenue2024: monthData2024.reduce((sum, d) => sum + (d.sales_2024 || 0), 0),
    daysTracked: monthData2025.length,
  };

  const monthMetrics = {
    avgDailyOrders2025: monthStats.daysTracked > 0 ? Math.round(monthStats.orders2025 / monthStats.daysTracked) : 0,
    avgDailyOrders2024: monthStats.daysTracked > 0 ? Math.round(monthStats.orders2024 / monthStats.daysTracked) : 0,
    avgDailyRevenue2025: monthStats.daysTracked > 0 ? monthStats.revenue2025 / monthStats.daysTracked : 0,
    avgDailyRevenue2024: monthStats.daysTracked > 0 ? monthStats.revenue2024 / monthStats.daysTracked : 0,
    aov2025: monthStats.orders2025 > 0 ? monthStats.revenue2025 / monthStats.orders2025 : 0,
    aov2024: monthStats.orders2024 > 0 ? monthStats.revenue2024 / monthStats.orders2024 : 0,
  };

  const monthDeltas = {
    avgDailyOrders: monthMetrics.avgDailyOrders2024 > 0
      ? ((monthMetrics.avgDailyOrders2025 - monthMetrics.avgDailyOrders2024) / monthMetrics.avgDailyOrders2024) * 100 : 0,
    avgDailyRevenue: monthMetrics.avgDailyRevenue2024 > 0
      ? ((monthMetrics.avgDailyRevenue2025 - monthMetrics.avgDailyRevenue2024) / monthMetrics.avgDailyRevenue2024) * 100 : 0,
    aov: monthMetrics.aov2024 > 0
      ? ((monthMetrics.aov2025 - monthMetrics.aov2024) / monthMetrics.aov2024) * 100 : 0,
  };

  // Formatting helpers
  const fmt = {
    currency: (n: number) => {
      if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
      if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
      return `$${Math.round(n)}`;
    },
    currencyFull: (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    number: (n: number) => n.toLocaleString(),
    delta: (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`,
  };

  // Custom tooltip component
  const ChartTooltip = ({ active, payload, label, prefix = "" }: {
    active?: boolean;
    payload?: Array<{ value: number; dataKey: string; stroke: string }>;
    label?: number;
    prefix?: string;
  }) => {
    if (!active || !payload?.length) return null;

    const val2025 = payload.find(p => p.dataKey.includes("2025"))?.value || 0;
    const val2024 = payload.find(p => p.dataKey.includes("2024"))?.value || 0;
    const delta = val2024 > 0 ? ((val2025 - val2024) / val2024) * 100 : 0;

    return (
      <div className="bg-bg-primary/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl p-4 min-w-[180px]">
        <div className="text-xs text-text-tertiary uppercase tracking-wider mb-3">Day {label}</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-text-secondary text-sm">2025</span>
            </div>
            <span className="font-semibold text-text-primary tabular-nums">
              {prefix}{fmt.number(Math.round(val2025))}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.baseline }} />
              <span className="text-text-secondary text-sm">2024</span>
            </div>
            <span className="font-medium text-text-tertiary tabular-nums">
              {prefix}{fmt.number(Math.round(val2024))}
            </span>
          </div>
          {val2024 > 0 && val2025 > 0 && (
            <div className="pt-2 mt-2 border-t border-border/50">
              <div className={`text-sm font-semibold text-right ${delta >= 0 ? "text-status-good" : "text-status-bad"}`}>
                {fmt.delta(delta)} YoY
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <h2 className="text-label font-medium text-text-tertiary uppercase tracking-wider">
            Q4 2025
          </h2>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${
              summary.ordersGrowth >= 0 ? "bg-status-good/10 text-status-good" : "bg-status-bad/10 text-status-bad"
            }`}>
              {fmt.delta(summary.ordersGrowth)} Orders
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${
              summary.revenueGrowth >= 0 ? "bg-status-good/10 text-status-good" : "bg-status-bad/10 text-status-bad"
            }`}>
              {fmt.delta(summary.revenueGrowth)} Revenue
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-text-secondary tabular-nums">
            {92 - currentDay} DAYS LEFT
          </span>
          <button
            onClick={onRefresh}
            className="p-2 hover:bg-bg-secondary rounded-lg transition-all"
            title="Refresh data"
          >
            <RefreshCw className="w-3.5 h-3.5 text-text-tertiary" />
          </button>
        </div>
      </div>

      {/* Timeline Progress */}
      <div className="relative mb-6">
        <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-blue rounded-full"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-text-muted">OCT 1</span>
          <span className="text-[10px] text-text-muted">DEC 31</span>
        </div>
      </div>

      {/* Hero Metrics - Revenue & Orders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Revenue Hero */}
        <div className="relative overflow-hidden bg-bg-secondary rounded-2xl p-6 border border-border">
          <div className="absolute top-0 right-0 w-32 h-32 bg-status-good/5 rounded-full blur-3xl -mr-10 -mt-10" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-status-good" />
              <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Revenue Growth</span>
            </div>
            <div className={`text-metric font-bold tracking-tight leading-none mb-2 ${summary.revenueGrowth >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(summary.revenueGrowth)}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-text-primary font-semibold">
                {fmt.currency(summary.totalRevenue2025)}
              </span>
              <span className="text-text-muted">
                vs {fmt.currency(summary.totalRevenue2024)}
              </span>
            </div>
          </div>
        </div>

        {/* Orders Hero */}
        <div className="relative overflow-hidden bg-bg-secondary rounded-2xl p-6 border border-border">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent-blue/5 rounded-full blur-3xl -mr-10 -mt-10" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <Package className="w-4 h-4 text-accent-blue" />
              <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Orders Growth</span>
            </div>
            <div className={`text-metric font-bold tracking-tight leading-none mb-2 ${summary.ordersGrowth >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(summary.ordersGrowth)}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-text-primary font-semibold">
                {fmt.number(summary.totalOrders2025)}
              </span>
              <span className="text-text-muted">
                vs {fmt.number(summary.totalOrders2024)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Metrics Row - Current Month with YoY Change */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted uppercase tracking-wider">{monthLabel} Daily Orders</span>
            <span className={`text-xs font-semibold ${monthDeltas.avgDailyOrders >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(monthDeltas.avgDailyOrders)}
            </span>
          </div>
          <div className="text-xl font-bold text-text-primary tabular-nums">{monthMetrics.avgDailyOrders2025.toLocaleString()}</div>
          <div className="text-xs text-text-muted mt-1">vs {monthMetrics.avgDailyOrders2024.toLocaleString()} in 2024</div>
        </div>
        <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted uppercase tracking-wider">{monthLabel} Daily Rev</span>
            <span className={`text-xs font-semibold ${monthDeltas.avgDailyRevenue >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(monthDeltas.avgDailyRevenue)}
            </span>
          </div>
          <div className="text-xl font-bold text-text-primary tabular-nums">{fmt.currency(monthMetrics.avgDailyRevenue2025)}</div>
          <div className="text-xs text-text-muted mt-1">vs {fmt.currency(monthMetrics.avgDailyRevenue2024)} in 2024</div>
        </div>
        <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted uppercase tracking-wider">{monthLabel} AOV</span>
            <span className={`text-xs font-semibold ${monthDeltas.aov >= 0 ? "text-status-good" : "text-status-bad"}`}>
              {fmt.delta(monthDeltas.aov)}
            </span>
          </div>
          <div className="text-xl font-bold text-text-primary tabular-nums">${monthMetrics.aov2025.toFixed(0)}</div>
          <div className="text-xs text-text-muted mt-1">vs ${monthMetrics.aov2024.toFixed(0)} in 2024</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Daily Orders */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Daily Orders</h3>
              <p className="text-xs text-text-muted">Order volume by day of Q4</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary tabular-nums">
                {chartData[currentDay - 1]?.orders2025?.toLocaleString() || "—"}
              </div>
              <div className="text-xs text-text-muted">Day {currentDay}</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="dailyOrders2025" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.current} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={colors.current} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  axisLine={{ stroke: "#1E293B" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
                  width={35}
                />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine x={currentDay} stroke="#475569" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="orders2025"
                  stroke={colors.current}
                  strokeWidth={2}
                  fill="url(#dailyOrders2025)"
                />
                <Line
                  type="monotone"
                  dataKey="orders2024"
                  stroke={colors.baseline}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-xs text-text-tertiary">2025</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full border-t border-dashed" style={{ borderColor: colors.baseline }} />
              <span className="text-xs text-text-tertiary">2024</span>
            </div>
          </div>
        </div>

        {/* Daily Revenue */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Daily Revenue</h3>
              <p className="text-xs text-text-muted">Revenue by day of Q4</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary tabular-nums">
                {chartData[currentDay - 1]?.sales2025 != null ? fmt.currency(chartData[currentDay - 1].sales2025 ?? 0) : "—"}
              </div>
              <div className="text-xs text-text-muted">Day {currentDay}</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="dailySales2025" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.current} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={colors.current} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  axisLine={{ stroke: "#1E293B" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}K`}
                  width={45}
                />
                <Tooltip content={<ChartTooltip prefix="$" />} />
                <ReferenceLine x={currentDay} stroke="#475569" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="sales2025"
                  stroke={colors.current}
                  strokeWidth={2}
                  fill="url(#dailySales2025)"
                />
                <Line
                  type="monotone"
                  dataKey="sales2024"
                  stroke={colors.baseline}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-xs text-text-tertiary">2025</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full border-t border-dashed" style={{ borderColor: colors.baseline }} />
              <span className="text-xs text-text-tertiary">2024</span>
            </div>
          </div>
        </div>

        {/* Cumulative Orders */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Cumulative Orders</h3>
              <p className="text-xs text-text-muted">Running total through Q4</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary tabular-nums">
                {summary.totalOrders2025.toLocaleString()}
              </div>
              <div className="text-xs text-text-muted">Total</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="cumOrders2025" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.current} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={colors.current} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cumOrders2024" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.baseline} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={colors.baseline} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  axisLine={{ stroke: "#1E293B" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${(v/1000).toFixed(0)}K`}
                  width={35}
                />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine x={currentDay} stroke="#475569" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="cumOrders2024"
                  stroke={colors.baseline}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fill="url(#cumOrders2024)"
                />
                <Area
                  type="monotone"
                  dataKey="cumOrders2025"
                  stroke={colors.current}
                  strokeWidth={2}
                  fill="url(#cumOrders2025)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-xs text-text-tertiary">2025</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full border-t border-dashed" style={{ borderColor: colors.baseline }} />
              <span className="text-xs text-text-tertiary">2024</span>
            </div>
          </div>
        </div>

        {/* Cumulative Revenue */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Cumulative Revenue</h3>
              <p className="text-xs text-text-muted">Running total through Q4</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-text-primary tabular-nums">
                ${(summary.totalRevenue2025 / 1000000).toFixed(2)}M
              </div>
              <div className="text-xs text-text-muted">Total</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="cumSales2025" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.current} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={colors.current} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cumSales2024" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors.baseline} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={colors.baseline} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  axisLine={{ stroke: "#1E293B" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v/1000000).toFixed(1)}M`}
                  width={45}
                />
                <Tooltip content={<ChartTooltip prefix="$" />} />
                <ReferenceLine x={currentDay} stroke="#475569" strokeDasharray="3 3" />
                <Area
                  type="monotone"
                  dataKey="cumSales2024"
                  stroke={colors.baseline}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fill="url(#cumSales2024)"
                />
                <Area
                  type="monotone"
                  dataKey="cumSales2025"
                  stroke={colors.current}
                  strokeWidth={2}
                  fill="url(#cumSales2025)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: colors.current }} />
              <span className="text-xs text-text-tertiary">2025</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 rounded-full border-t border-dashed" style={{ borderColor: colors.baseline }} />
              <span className="text-xs text-text-tertiary">2024</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      {data.lastSynced && (
        <div className="text-xs text-text-muted text-center pt-4 border-t border-border/30">
          Data synced {formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true })}
        </div>
      )}
    </div>
  );
}

// Assembly Dashboard Component - Industrial Forge Aesthetic
function AssemblyDashboard({
  data,
  loading,
  onRefresh,
}: {
  data: AssemblyResponse | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  // Forge color palette
  const forge = {
    copper: "#D97706",
    ember: "#EA580C",
    iron: "#78716C",
    glow: "#FCD34D",
    heat: "#F59E0B",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-bg-tertiary" />
            <div
              className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent animate-spin"
              style={{ borderTopColor: forge.copper, borderRightColor: forge.ember }}
            />
          </div>
          <span className="text-sm text-text-tertiary tracking-widest uppercase">Firing up the forge...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Hammer className="w-16 h-16" style={{ color: forge.iron }} />
        <span className="text-text-tertiary tracking-wide">No assembly data available</span>
        <button
          onClick={onRefresh}
          className="px-6 py-2.5 text-sm font-medium tracking-wider uppercase transition-all border-2 rounded"
          style={{ borderColor: forge.copper, color: forge.copper }}
        >
          Refresh
        </button>
      </div>
    );
  }

  const { summary, daily, weeklyData, dayOfWeekAvg, config } = data;

  // Calculate progress percentage toward cutoff
  const cutoffDate = new Date(config.manufacturing_cutoff);
  const startDate = new Date(config.cutoff_start_date);
  const today = new Date();
  const totalDays = Math.ceil((cutoffDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const timeProgressPct = Math.min(100, Math.round((elapsedDays / totalDays) * 100));

  // Prepare chart data - last 30 days with 7-day rolling average
  const sortedDaily = [...daily].sort((a, b) => b.date.localeCompare(a.date));
  const recentDaily = sortedDaily.slice(0, 30).reverse();

  // T7 (trailing 7 days) calculations
  const t7Days = sortedDaily.slice(0, 7);
  const t7Total = t7Days.reduce((sum, d) => sum + d.daily_total, 0);
  const priorT7Days = sortedDaily.slice(7, 14);
  const priorT7Total = priorT7Days.reduce((sum, d) => sum + d.daily_total, 0);
  const t7Delta = priorT7Total > 0 ? ((t7Total - priorT7Total) / priorT7Total) * 100 : 0;

  const dailyChartData = recentDaily.map((d, idx, arr) => {
    // Calculate 7-day rolling average (use available days if less than 7)
    const windowStart = Math.max(0, idx - 6);
    const window = arr.slice(windowStart, idx + 1);
    const rollingAvg = window.reduce((sum, item) => sum + item.daily_total, 0) / window.length;
    const aboveAvg = d.daily_total >= rollingAvg;

    return {
      date: format(parseLocalDate(d.date), "M/d"),
      value: d.daily_total,
      rollingAvg: Math.round(rollingAvg),
      day: d.day_of_week,
      aboveAvg,
      fill: aboveAvg ? "url(#greenGradient)" : "url(#emberGradient)",
    };
  });

  // Weekly comparison data
  const WEEKLY_TARGET = 5000;
  const weeklyChartData = weeklyData.map((w) => ({
    week: `W${w.week_num}`,
    total: w.total,
    dailyAvg: w.daily_avg,
    daysWorked: w.days_worked,
    fill: w.total >= WEEKLY_TARGET ? "url(#weeklyGreenGradient)" : "url(#weeklyEmberGradient)",
  }));

  // Day of week data
  const dowChartData = dayOfWeekAvg.map((d) => ({
    day: d.day.slice(0, 3),
    avg: d.avg,
    count: d.count,
  }));

  const fmt = {
    number: (n: number) => n.toLocaleString(),
    delta: (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`,
  };

  // SVG arc for progress gauge
  const progressArc = (pct: number, radius: number, strokeWidth: number) => {
    const normalizedPct = Math.min(100, Math.max(0, pct));
    const circumference = 2 * Math.PI * radius;
    const arc = (normalizedPct / 100) * circumference * 0.75; // 270 degrees
    return {
      circumference: circumference * 0.75,
      offset: circumference * 0.75 - arc,
    };
  };

  const gaugeRadius = 80;
  const gaugeStroke = 12;
  const productionArc = progressArc(summary.progressPct, gaugeRadius, gaugeStroke);
  const timeArc = progressArc(timeProgressPct, gaugeRadius - 18, 6);

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <button
          onClick={onRefresh}
          aria-label="Refresh data"
          className="p-2 rounded-lg transition-all hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-copper focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
        >
          <RefreshCw className="w-4 h-4 text-text-tertiary" />
        </button>
      </div>

      {/* Production Stats Row */}
      {(() => {
        // Calculate MTD production (current month)
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const currentDay = now.getDate();

        // This year's MTD
        const mtdThisYear = daily
          .filter(d => {
            const date = new Date(d.date);
            return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
          })
          .reduce((sum, d) => sum + d.daily_total, 0);

        // Last month's same period (up to same day)
        const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        const mtdLastMonth = daily
          .filter(d => {
            const date = new Date(d.date);
            return date.getMonth() === lastMonth &&
                   date.getFullYear() === lastMonthYear &&
                   date.getDate() <= currentDay;
          })
          .reduce((sum, d) => sum + d.daily_total, 0);

        const mtdDelta = mtdLastMonth > 0
          ? ((mtdThisYear - mtdLastMonth) / mtdLastMonth) * 100
          : mtdThisYear > 0 ? 100 : 0;

        const lastMonthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][lastMonth];

        return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Yesterday's Production */}
        <div className="bg-bg-secondary rounded-xl p-3 sm:p-5 border border-border/30">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {summary.latestDate ? format(parseLocalDate(summary.latestDate), "MMM d").toUpperCase() : "LATEST"}
            </span>
            <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
            {fmt.number(summary.yesterdayProduction)}
          </div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${summary.yesterdayDelta >= 0 ? "text-status-good" : "text-status-bad"}`}>
            {summary.yesterdayDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmt.delta(summary.yesterdayDelta)} vs prior day
          </div>
        </div>

        {/* MTD Production */}
        <div className="bg-bg-secondary rounded-xl p-3 sm:p-5 border border-border/30">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">MTD</span>
            <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
            {fmt.number(mtdThisYear)}
          </div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${mtdDelta >= 0 ? "text-status-good" : "text-status-bad"}`}>
            {mtdDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmt.delta(mtdDelta)} vs {lastMonthName}
          </div>
        </div>

        {/* 7-Day Average */}
        <div className="bg-bg-secondary rounded-xl p-3 sm:p-5 border border-border/30">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">7-DAY AVG</span>
            <BarChart3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
            {fmt.number(summary.dailyAverage7d)}
          </div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${summary.dailyAverageDelta >= 0 ? "text-status-good" : "text-status-bad"}`}>
            {summary.dailyAverageDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmt.delta(summary.dailyAverageDelta)} vs prior week
          </div>
        </div>

        {/* T7 (Trailing 7 Days) */}
        <div className="bg-bg-secondary rounded-xl p-3 sm:p-5 border border-border/30">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">T7</span>
            <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-text-muted" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-primary">
            {fmt.number(t7Total)}
          </div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${t7Delta >= 0 ? "text-status-good" : "text-status-bad"}`}>
            {t7Delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmt.delta(t7Delta)} vs prior 7d
          </div>
        </div>
      </div>
        );
      })()}

      {/* Daily Production Chart - Full Width with Rolling Average */}
      <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            DAILY PRODUCTION
          </h3>
          <div className="flex items-center gap-4 text-[10px] text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#10B981" }} />
              Above Avg
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: forge.ember }} />
              Below Avg
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded" style={{ backgroundColor: forge.glow }} />
              7-Day Avg
            </span>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dailyChartData} margin={{ top: 20, right: 10, left: -10, bottom: 20 }}>
              <defs>
                <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#059669" stopOpacity={0.85} />
                </linearGradient>
                <linearGradient id="emberGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={forge.heat} stopOpacity={1} />
                  <stop offset="100%" stopColor={forge.ember} stopOpacity={0.85} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748B", fontSize: 10 }}
                interval={2}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748B", fontSize: 10 }}
                width={45}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                contentStyle={{
                  backgroundColor: "rgba(18, 21, 31, 0.98)",
                  border: `1px solid ${forge.copper}40`,
                  borderRadius: "8px",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                  padding: "10px 14px",
                }}
                labelStyle={{ color: "#94A3B8", fontSize: 11, marginBottom: 6 }}
                itemStyle={{ color: "#E2E8F0" }}
                formatter={(value: number, name: string) => {
                  if (name === "value") return [<span key="v" style={{ color: forge.glow, fontWeight: 600 }}>{fmt.number(value)}</span>, "Daily"];
                  if (name === "rollingAvg") return [<span key="a" style={{ color: "#FCD34D", fontWeight: 600 }}>{fmt.number(value)}</span>, "7-Day Avg"];
                  return [value, name];
                }}
              />
              <ReferenceLine
                y={summary.dailyTarget}
                stroke={forge.heat}
                strokeDasharray="6 4"
                label={{
                  value: `Target: ${fmt.number(summary.dailyTarget)}`,
                  position: "insideTopRight",
                  fill: forge.heat,
                  fontSize: 10,
                }}
              />
              <Bar
                dataKey="value"
                radius={[2, 2, 0, 0]}
                maxBarSize={14}
              >
                {dailyChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  fill="#94A3B8"
                  fontSize={9}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={(props: any) => {
                    const x = Number(props.x) || 0;
                    const y = Number(props.y) || 0;
                    const width = Number(props.width) || 0;
                    const value = Number(props.value) || 0;
                    return (
                      <text
                        x={x + width / 2}
                        y={y - 4}
                        textAnchor="middle"
                        fill="#94A3B8"
                        fontSize={9}
                        stroke="rgba(15, 23, 42, 0.8)"
                        strokeWidth={2}
                        paintOrder="stroke"
                      >
                        {value ? value.toLocaleString() : ''}
                      </text>
                    );
                  }}
                />
              </Bar>
              <Line
                type="monotone"
                dataKey="rollingAvg"
                stroke={forge.glow}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: forge.glow, stroke: "#0B0E1A", strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Secondary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Totals */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-5">
            WEEKLY PRODUCTION
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyChartData} margin={{ top: 10, right: 10, left: -10, bottom: 20 }}>
                <defs>
                  <linearGradient id="weeklyGreenGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                  <linearGradient id="weeklyEmberGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={forge.heat} />
                    <stop offset="100%" stopColor={forge.ember} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="week"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  width={50}
                  tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  contentStyle={{
                    backgroundColor: "rgba(18, 21, 31, 0.98)",
                    border: "1px solid rgba(234, 88, 12, 0.3)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    padding: "10px 14px",
                  }}
                  labelStyle={{ color: "#94A3B8", fontSize: 11, marginBottom: 4 }}
                  itemStyle={{ color: "#E2E8F0" }}
                  formatter={(value: number, name: string) => {
                    if (name === "total") return [
                      <span key="v" style={{ color: "#FCD34D", fontWeight: 600 }}>{fmt.number(value)}</span>,
                      "Total"
                    ];
                    return [value, name];
                  }}
                />
                <ReferenceLine
                  y={5000}
                  stroke="#94A3B8"
                  strokeDasharray="6 4"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
                <Bar
                  dataKey="total"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                >
                  {weeklyChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Day of Week Pattern */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-5">
            AVERAGE BY WEEKDAY
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowChartData} margin={{ top: 20, right: 10, left: -10, bottom: 20 }}>
                <defs>
                  <linearGradient id="dowGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.85} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748B", fontSize: 10 }}
                  width={45}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  contentStyle={{
                    backgroundColor: "rgba(18, 21, 31, 0.98)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    padding: "10px 14px",
                  }}
                  labelStyle={{ color: "#94A3B8", fontSize: 11, marginBottom: 4 }}
                  itemStyle={{ color: "#E2E8F0" }}
                  formatter={(value: number, name: string) => {
                    if (name === "avg") return [
                      <span key="v" style={{ color: "#10B981", fontWeight: 600 }}>{fmt.number(value)}</span>,
                      "Avg"
                    ];
                    return [value, name];
                  }}
                />
                <Bar
                  dataKey="avg"
                  fill="url(#dowGradient)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                >
                  <LabelList
                    dataKey="avg"
                    position="top"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(props: any) => {
                      const x = Number(props.x) || 0;
                      const y = Number(props.y) || 0;
                      const width = Number(props.width) || 0;
                      const value = Number(props.value) || 0;
                      return (
                        <text
                          x={x + width / 2}
                          y={y - 6}
                          textAnchor="middle"
                          fill="#94A3B8"
                          fontSize={11}
                          fontWeight={500}
                        >
                          {value ? value.toLocaleString() : ''}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Section: SKU Progress + Monthly Summary */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
        {/* SKU Progress Table */}
        {data.targets && data.targets.length > 0 && (() => {
        // display_name comes from API (joined with products table)
        const sortedTargets = data.targets
          .filter(t => t.revised_plan > 0)
          .sort((a, b) => {
            const pctA = a.revised_plan > 0 ? (a.assembled_since_cutoff / a.revised_plan) : 0;
            const pctB = b.revised_plan > 0 ? (b.assembled_since_cutoff / b.revised_plan) : 0;
            return pctA - pctB;
          });

        return (
          <div className="bg-bg-secondary rounded-xl p-4 border border-border/30 w-full lg:w-fit overflow-x-auto">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-3">
              SKU PROGRESS
            </h3>
            <table className="text-[11px]">
              <thead>
                <tr className="text-[9px] text-text-muted uppercase tracking-wide">
                  <th className="text-left pb-1.5 pr-6 font-medium border-b border-white/5">SKU</th>
                  <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Target</th>
                  <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Built</th>
                  <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5" style={{ color: forge.glow }}>T7</th>
                  <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Left</th>
                  <th className="pb-1.5 pl-3 border-b border-white/5"></th>
                </tr>
              </thead>
              <tbody>
                {sortedTargets.map((target) => {
                  const progress = target.revised_plan > 0
                    ? (target.assembled_since_cutoff / target.revised_plan) * 100
                    : 0;
                  const isComplete = progress >= 100;
                  return (
                    <tr key={target.sku} className="border-b border-white/[0.02]">
                      <td className="py-1 pr-6 text-text-primary">{target.display_name}</td>
                      <td className="py-1 px-3 text-right text-text-tertiary tabular-nums">{fmt.number(target.revised_plan)}</td>
                      <td className="py-1 px-3 text-right text-text-secondary tabular-nums">{fmt.number(target.assembled_since_cutoff)}</td>
                      <td className="py-1 px-3 text-right tabular-nums" style={{ color: forge.glow }}>{target.t7 ? fmt.number(target.t7) : "—"}</td>
                      <td className={`py-1 px-3 text-right tabular-nums font-medium ${isComplete ? "text-status-good" : "text-text-primary"}`}>
                        {isComplete ? "—" : fmt.number(target.deficit)}
                      </td>
                      <td className="py-1 pl-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-10 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, progress)}%`,
                                background: isComplete
                                  ? "#10B981"
                                  : progress >= 80
                                    ? `linear-gradient(90deg, ${forge.copper}, ${forge.heat})`
                                    : `linear-gradient(90deg, ${forge.copper}, ${forge.ember})`,
                              }}
                            />
                          </div>
                          <span className={`text-[10px] tabular-nums ${isComplete ? "text-status-good" : "text-text-muted"}`}>
                            {progress.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

        {/* Monthly Production Summary */}
        {(() => {
          // Calculate monthly totals from daily data
          const monthlyData = new Map<string, { total: number; days: number }>();
          const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

          for (const d of daily) {
            if (d.month && d.year) {
              const key = `${d.year}-${String(d.month).padStart(2, "0")}`;
              const existing = monthlyData.get(key) || { total: 0, days: 0 };
              monthlyData.set(key, { total: existing.total + d.daily_total, days: existing.days + 1 });
            }
          }

          // Convert to array and sort descending (most recent first)
          const monthlyArray = Array.from(monthlyData.entries())
            .map(([key, val]) => {
              const [year, month] = key.split("-");
              return {
                key,
                month: parseInt(month),
                year: parseInt(year),
                monthName: monthNames[parseInt(month)],
                total: val.total,
                days: val.days,
                dailyAvg: Math.round(val.total / val.days),
              };
            })
            .sort((a, b) => b.key.localeCompare(a.key));

          // Calculate MoM %
          const withMoM = monthlyArray.map((m, idx) => {
            const prevMonth = monthlyArray[idx + 1];
            const momPct = prevMonth ? ((m.dailyAvg - prevMonth.dailyAvg) / prevMonth.dailyAvg) * 100 : null;
            return { ...m, momPct };
          });

          return (
            <div className="bg-bg-secondary rounded-xl p-4 border border-border/30 flex-1 overflow-x-auto">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-3">
                MONTHLY SUMMARY
              </h3>
              <table className="w-full text-[11px] min-w-[300px]">
                <thead>
                  <tr className="text-[9px] text-text-muted uppercase tracking-wide">
                    <th className="text-left pb-1.5 pr-4 font-medium border-b border-white/5">Month</th>
                    <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Total</th>
                    <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Days</th>
                    <th className="text-right pb-1.5 px-3 font-medium border-b border-white/5">Daily Avg</th>
                    <th className="text-right pb-1.5 pl-3 font-medium border-b border-white/5">MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {withMoM.slice(0, 6).map((m) => (
                    <tr key={m.key} className="border-b border-white/[0.02]">
                      <td className="py-1.5 pr-4 text-text-primary">{m.monthName}</td>
                      <td className="py-1.5 px-3 text-right text-text-secondary tabular-nums">{fmt.number(m.total)}</td>
                      <td className="py-1.5 px-3 text-right text-text-tertiary tabular-nums">{m.days}</td>
                      <td className="py-1.5 px-3 text-right text-text-primary tabular-nums font-medium">{fmt.number(m.dailyAvg)}</td>
                      <td className={`py-1.5 pl-3 text-right tabular-nums ${
                        m.momPct === null ? "text-text-muted" : m.momPct >= 0 ? "text-status-good" : "text-status-bad"
                      }`}>
                        {m.momPct !== null ? `${m.momPct >= 0 ? "+" : ""}${m.momPct.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Footer */}
      {data.lastSynced && (
        <div className="text-[10px] text-text-muted text-center pt-4 tracking-wide">
          Last synced {formatDistanceToNow(new Date(data.lastSynced), { addSuffix: true })}
        </div>
      )}
    </div>
  );
}

// Budget Dashboard Component
function BudgetDashboard({
  data,
  loading,
  dateRange,
  onDateRangeChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  onRefresh,
  expandedCategories,
  onToggleCategory,
}: {
  data: BudgetResponse | null;
  loading: boolean;
  dateRange: BudgetDateRange;
  onDateRangeChange: (range: BudgetDateRange) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (date: string) => void;
  onCustomEndChange: (date: string) => void;
  onRefresh: () => void;
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
}) {
  // Design system colors (matches globals.css)
  const colors = {
    emerald: "#10B981",      // status-good
    emeraldDark: "#059669",  // status-good-dim
    amber: "#F59E0B",        // status-warning
    amberDark: "#D97706",    // status-warning-dim
    rose: "#DC2626",         // status-bad (was rose, now consistent)
    roseDark: "#B91C1C",     // status-bad-dim
    slate: "#64748B",        // text-tertiary
    accent: "#0EA5E9",       // accent-blue
  };

  // Date range options
  const dateRangeOptions: { value: BudgetDateRange; label: string; short: string }[] = [
    { value: "mtd", label: "Month to Date", short: "MTD" },
    { value: "last_month", label: "Last Month", short: "LM" },
    { value: "qtd", label: "Quarter to Date", short: "QTD" },
    { value: "ytd", label: "Year to Date", short: "YTD" },
    { value: "6months", label: "6 Months", short: "6Mo" },
    { value: "custom", label: "Custom", short: "Custom" },
  ];


  // Get delta color (green for positive, red for negative)
  const getDeltaColor = (delta: number) => {
    if (delta > 0) return colors.emerald;
    if (delta < 0) return colors.rose;
    return colors.slate;
  };

  // Format delta as string with +/- sign
  const formatDelta = (delta: number, isPct: boolean = false) => {
    const sign = delta > 0 ? "+" : "";
    if (isPct) {
      return `${sign}${delta.toFixed(1)}%`;
    }
    return `${sign}${formatNumber(delta)}`;
  };

  // Get color based on PACE (all calculations use EST timezone)
  // pace >= 100 = super hot (bright green)
  // pace 90-99 = on track (green)
  // pace 80-89 = needs attention (amber)
  // pace < 80 = behind (red)
  const getPaceColor = (pace: number) => {
    if (pace >= 100) return "#22C55E"; // Super green (brighter)
    if (pace >= 90) return colors.emerald;
    if (pace >= 80) return colors.amber;
    return colors.rose;
  };

  const getPaceColorDark = (pace: number) => {
    if (pace >= 100) return "#16A34A"; // Super green dark
    if (pace >= 90) return colors.emeraldDark;
    if (pace >= 80) return colors.amberDark;
    return colors.roseDark;
  };

  const getPaceTextClass = (pace: number) => {
    if (pace >= 90) return "text-status-good"; // 90+ is green
    if (pace >= 80) return "text-status-warning";
    return "text-status-bad";
  };

  const getPaceBgClass = (pace: number) => {
    if (pace >= 90) return "bg-status-good/10";
    if (pace >= 80) return "bg-status-warning/10";
    return "bg-status-bad/10";
  };

  // Export to CSV function
  const exportToCSV = () => {
    if (!data) return;

    const rows: string[] = [];
    rows.push("Category,Product,SKU,Budget,Actual,Variance,Variance %");

    for (const cat of data.categories) {
      for (const sku of cat.skus) {
        rows.push(
          `"${cat.displayName}","${sku.displayName}","${sku.sku}",${sku.budget},${sku.actual},${sku.variance},${sku.variancePct.toFixed(1)}%`
        );
      }
      rows.push(
        `"${cat.displayName} Total","","",${cat.totals.budget},${cat.totals.actual},${cat.totals.variance},${cat.totals.variancePct.toFixed(1)}%`
      );
    }
    rows.push(
      `"Cookware Total","","",${data.cookwareTotal.budget},${data.cookwareTotal.actual},${data.cookwareTotal.variance},${data.cookwareTotal.variancePct.toFixed(1)}%`
    );
    rows.push(
      `"Grand Total","","",${data.grandTotal.budget},${data.grandTotal.actual},${data.grandTotal.variance},${data.grandTotal.variancePct.toFixed(1)}%`
    );

    const csvContent = rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-vs-actual-${dateRange}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-bg-tertiary" />
            <div
              className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent animate-spin"
              style={{ borderTopColor: colors.accent, borderRightColor: colors.emerald }}
            />
          </div>
          <span className="text-sm text-text-tertiary tracking-widest uppercase">Analyzing sales...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Target className="w-16 h-16 text-text-muted" />
        <span className="text-text-tertiary tracking-wide">No budget data available</span>
        <button
          onClick={onRefresh}
          className="px-6 py-2.5 text-sm font-medium tracking-wider uppercase transition-all border-2 rounded hover:bg-accent-blue/10"
          style={{ borderColor: colors.accent, color: colors.accent }}
        >
          Refresh
        </button>
      </div>
    );
  }

  const pctThroughPeriod = Math.round((data.daysElapsed / data.daysInPeriod) * 100);
  const grandPctOfBudget = data.grandTotal.budget > 0
    ? Math.round((data.grandTotal.actual / data.grandTotal.budget) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header Row with Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-sm text-text-muted">
          {data.periodLabel}
        </div>
        <div className="flex items-center gap-2">
          {/* Date Range Buttons */}
          <div className="flex bg-bg-tertiary rounded-lg p-1">
            {dateRangeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onDateRangeChange(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                  dateRange === opt.value
                    ? "bg-accent-blue text-white"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {opt.short}
              </button>
            ))}
          </div>
          {/* Custom Date Inputs */}
          {dateRange === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => onCustomStartChange(e.target.value)}
                className="px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:border-accent-blue focus:outline-none"
              />
              <span className="text-text-muted text-xs">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => onCustomEndChange(e.target.value)}
                className="px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:border-accent-blue focus:outline-none"
              />
            </div>
          )}
          {/* Export Button */}
          <button
            onClick={exportToCSV}
            className="p-2 text-text-tertiary hover:text-text-secondary transition-colors"
            title="Export to CSV"
          >
            <Download className="w-4 h-4" />
          </button>
          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            className="p-2 rounded-lg transition-all hover:bg-white/5"
            aria-label="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 text-text-tertiary ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary Cards - Cookware Total and Grand Total */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cookware Total */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">COOKWARE TOTAL</span>
            </div>
          </div>
          <div className="flex items-baseline gap-3 mb-1">
            <span
              className={`text-3xl sm:text-4xl font-bold tabular-nums`}
              style={{ color: getPaceColor(data.cookwareTotal.pace) }}
            >
              {Math.round((data.cookwareTotal.actual / data.cookwareTotal.budget) * 100)}%
            </span>
            <span className="text-xs text-text-muted">of budget</span>
          </div>
          <div className="text-sm text-text-muted mb-2">
            {formatNumber(data.cookwareTotal.actual)} / {formatNumber(data.cookwareTotal.budget)}
          </div>
          {/* Delta indicator when comparison is active */}
          {data.comparison && (
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-sm font-medium tabular-nums"
                style={{ color: getDeltaColor(data.comparison.cookwareTotal.delta) }}
              >
                {formatDelta(data.comparison.cookwareTotal.deltaPct, true)}
              </span>
              <span className="text-xs text-text-tertiary">
                vs {data.comparison.periodLabel.split("(")[0].trim()}
              </span>
            </div>
          )}
          {/* Progress Bar */}
          <div className="relative h-2 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (data.cookwareTotal.actual / data.cookwareTotal.budget) * 100)}%`,
                background: `linear-gradient(90deg, ${getPaceColor(data.cookwareTotal.pace)}, ${getPaceColorDark(data.cookwareTotal.pace)})`,
              }}
            />
            {dateRange === "mtd" && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/50"
                style={{ left: `${pctThroughPeriod}%` }}
                title={`${pctThroughPeriod}% through period`}
              />
            )}
          </div>
          <div className="text-xs text-text-tertiary mt-2">
            Cast Iron + Carbon Steel{dateRange === "mtd" && data.cookwareTotal.pace < 100 && <> • Pace: <span className="tabular-nums" style={{ color: getPaceColor(data.cookwareTotal.pace) }}>{data.cookwareTotal.pace}%</span></>}
          </div>
        </div>

        {/* Grand Total */}
        <div className="bg-bg-secondary rounded-xl p-5 border border-border/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-text-muted">GRAND TOTAL</span>
            </div>
          </div>
          <div className="flex items-baseline gap-3 mb-1">
            <span
              className={`text-3xl sm:text-4xl font-bold tabular-nums`}
              style={{ color: getPaceColor(data.grandTotal.pace) }}
            >
              {grandPctOfBudget}%
            </span>
            <span className="text-xs text-text-muted">of budget</span>
          </div>
          <div className="text-sm text-text-muted mb-2">
            {formatNumber(data.grandTotal.actual)} / {formatNumber(data.grandTotal.budget)}
          </div>
          {/* Delta indicator when comparison is active */}
          {data.comparison && (
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-sm font-medium tabular-nums"
                style={{ color: getDeltaColor(data.comparison.grandTotal.delta) }}
              >
                {formatDelta(data.comparison.grandTotal.deltaPct, true)}
              </span>
              <span className="text-xs text-text-tertiary">
                vs {data.comparison.periodLabel.split("(")[0].trim()}
              </span>
            </div>
          )}
          {/* Progress Bar */}
          <div className="relative h-2 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, grandPctOfBudget)}%`,
                background: `linear-gradient(90deg, ${getPaceColor(data.grandTotal.pace)}, ${getPaceColorDark(data.grandTotal.pace)})`,
              }}
            />
            {dateRange === "mtd" && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/50"
                style={{ left: `${pctThroughPeriod}%` }}
                title={`${pctThroughPeriod}% through period`}
              />
            )}
          </div>
          <div className="text-xs text-text-tertiary mt-2">
            All Categories{dateRange === "mtd" && data.grandTotal.pace < 100 && <> • Pace: <span className="tabular-nums" style={{ color: getPaceColor(data.grandTotal.pace) }}>{data.grandTotal.pace}%</span></>}
          </div>
        </div>
      </div>

      {/* Category Details - Unified Cards with Progress + Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.categories.map((cat) => {
          const pctOfBudget = cat.totals.budget > 0
            ? Math.round((cat.totals.actual / cat.totals.budget) * 100)
            : 0;
          const pctThroughPeriod = Math.round((data.daysElapsed / data.daysInPeriod) * 100);
          const isExpanded = expandedCategories.has(cat.category);
          // Use pace from API for consistent color logic
          const statusColor = getPaceColor(cat.totals.pace);
          const statusColorDark = getPaceColorDark(cat.totals.pace);

          return (
            <div key={cat.category} className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
              {/* Rich Header with Progress */}
              <button
                onClick={() => onToggleCategory(cat.category)}
                className="w-full text-left hover:bg-bg-tertiary/30 transition-colors"
              >
                <div className="p-4 pb-3">
                  {/* Top row: Category name + pace badge */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        style={{ color: statusColor }}
                      >
                        ▶
                      </span>
                      <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                        {cat.displayName}
                      </span>
                      <span className="text-[10px] text-text-tertiary">({cat.skus.length})</span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-2xl font-bold tabular-nums"
                        style={{ color: statusColor }}
                      >
                        {pctOfBudget}%
                      </span>
                      <span className="text-xs text-text-muted">of budget</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm text-text-primary tabular-nums font-medium">
                        {formatNumber(cat.totals.actual)}
                      </span>
                      <span className="text-sm text-text-muted"> / </span>
                      <span className="text-sm text-text-tertiary tabular-nums">
                        {formatNumber(cat.totals.budget)}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="relative h-1.5 bg-bg-tertiary rounded-full overflow-hidden mt-3">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, pctOfBudget)}%`,
                        background: `linear-gradient(90deg, ${statusColor}, ${statusColorDark})`,
                      }}
                    />
                    {dateRange === "mtd" && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-white/60"
                        style={{ left: `${pctThroughPeriod}%` }}
                        title={`${pctThroughPeriod}% through period`}
                      />
                    )}
                  </div>
                </div>
              </button>

              {/* SKU Table - Expanded by default, no scroll */}
              {isExpanded && (
                <div className="border-t border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50 text-text-muted text-xs uppercase tracking-wider bg-bg-tertiary/30">
                        <th className="text-left py-2 px-3 font-medium">Product</th>
                        <th className="text-right py-2 px-2 font-medium">Budget</th>
                        <th className="text-right py-2 px-2 font-medium">Actual</th>
                        <th className="text-right py-2 px-3 font-medium">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.skus.map((sku, idx) => {
                        // Display: raw % to monthly budget
                        // Color: based on pace (are we on track?)
                        const pctOfBudget = sku.budget > 0
                          ? Math.round((sku.actual / sku.budget) * 100)
                          : 0;
                        const skuColor = getPaceColor(sku.pace);

                        return (
                          <tr
                            key={sku.sku}
                            className={`border-b border-border/20 hover:bg-bg-tertiary/40 transition-colors ${
                              idx % 2 === 1 ? "bg-bg-tertiary/10" : ""
                            }`}
                          >
                            <td className="py-1.5 px-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: skuColor }}
                                />
                                <div>
                                  <div className="text-text-primary text-xs font-medium">{sku.displayName}</div>
                                  <div className="text-text-muted text-[10px]">{sku.sku}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-1.5 px-2 text-right text-text-muted tabular-nums text-xs">
                              {formatNumber(sku.budget)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-text-primary tabular-nums text-xs font-medium">
                              {formatNumber(sku.actual)}
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              <span
                                className="inline-block text-xs font-semibold tabular-nums px-2 py-0.5 rounded"
                                style={{
                                  backgroundColor: `${skuColor}20`,
                                  color: skuColor
                                }}
                              >
                                {pctOfBudget}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

