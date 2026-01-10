"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../layout";
import { getAuthHeaders } from "@/lib/auth";
import type { TicketsResponse, TicketCategory } from "@/lib/types";
import type { DateRangeOption } from "@/lib/dashboard-utils";

// VOC uses a subset of DateRangeOption (no yesterday or 3days)
type VOCDateRange = Extract<DateRangeOption, "today" | "7days" | "30days" | "90days" | "custom">;
type SentimentFilter = "all" | "Positive" | "Negative" | "Neutral" | "Mixed";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface VOCContextType {
  data: TicketsResponse | null;
  loading: boolean;
  error: string | null;
  dateRange: VOCDateRange;
  setDateRange: (dateRange: VOCDateRange) => void;
  customStart: string;
  setCustomStart: (start: string) => void;
  customEnd: string;
  setCustomEnd: (end: string) => void;
  categoryFilter: TicketCategory | "all";
  setCategoryFilter: (category: TicketCategory | "all") => void;
  sentimentFilter: SentimentFilter;
  setSentimentFilter: (sentiment: SentimentFilter) => void;
  search: string;
  setSearch: (search: string) => void;
  page: number;
  setPage: (page: number) => void;
  refresh: () => void;
}

const VOCContext = createContext<VOCContextType | null>(null);

export function useVOC() {
  const context = useContext(VOCContext);
  if (!context) {
    throw new Error("useVOC must be used within VOCLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function VOCLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<TicketsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [dateRange, setDateRange] = useState<VOCDateRange>("7days");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<TicketCategory | "all">("all");
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("all");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState(1);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("page", page.toString());

      // Date range
      const now = new Date();
      let startDate: Date;
      if (dateRange === "today") {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      } else if (dateRange === "7days") {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (dateRange === "30days") {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (dateRange === "90days") {
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      } else if (dateRange === "custom" && customStart && customEnd) {
        startDate = new Date(customStart);
        params.set("end", customEnd);
      } else {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      params.set("start", startDate.toISOString());
      if (dateRange !== "custom") {
        params.set("end", now.toISOString());
      }

      if (categoryFilter !== "all") {
        params.set("category", categoryFilter);
      }
      if (sentimentFilter !== "all") {
        params.set("sentiment", sentimentFilter);
      }
      if (search) {
        params.set("search", search);
      }

      const res = await fetch(`/api/tickets?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch tickets");
      const result: TicketsResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Tickets fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch tickets");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [
    dateRange,
    customStart,
    customEnd,
    categoryFilter,
    sentimentFilter,
    search,
    page,
    setLastRefresh,
    setIsRefreshing,
  ]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchTickets);
    return () => setTriggerRefresh(null);
  }, [fetchTickets, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchTickets();
    }
  }, [data, loading, fetchTickets]);

  // Refetch when filters change
  useEffect(() => {
    if (data) {
      fetchTickets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customStart, customEnd, categoryFilter, sentimentFilter, search, page]);

  // Context value
  const contextValue: VOCContextType = {
    data,
    loading,
    error,
    dateRange,
    setDateRange,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    categoryFilter,
    setCategoryFilter,
    sentimentFilter,
    setSentimentFilter,
    search,
    setSearch,
    page,
    setPage,
    refresh: fetchTickets,
  };

  return (
    <VOCContext.Provider value={contextValue}>
      {children}
    </VOCContext.Provider>
  );
}
