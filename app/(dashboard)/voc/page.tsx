"use client";

import { useState, useEffect, useCallback } from "react";
import { VoiceOfCustomerDashboard } from "@/components/VoiceOfCustomerDashboard";
import { useDashboard } from "../layout";
import type { TicketsResponse, TicketCategory } from "@/lib/types";
import type { DateRangeOption } from "@/lib/dashboard-utils";

// VOC uses a subset of DateRangeOption (no yesterday or 3days)
type VOCDateRange = Extract<DateRangeOption, "today" | "7days" | "30days" | "90days" | "custom">;
type SentimentFilter = "all" | "Positive" | "Negative" | "Neutral" | "Mixed";

export default function VOCPage() {
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

      const res = await fetch(`/api/tickets?${params}`);
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

  // Register refresh handler with layout
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

  return (
    <>
      {error && (
        <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm mb-4">
          <strong>Error:</strong> {error}
          <button
            onClick={fetchTickets}
            className="ml-4 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      <VoiceOfCustomerDashboard
      data={data}
      loading={loading}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      customStart={customStart}
      customEnd={customEnd}
      onCustomStartChange={setCustomStart}
      onCustomEndChange={setCustomEnd}
      categoryFilter={categoryFilter}
      onCategoryFilterChange={setCategoryFilter}
      sentimentFilter={sentimentFilter}
      onSentimentFilterChange={setSentimentFilter}
      search={search}
      onSearchChange={setSearch}
      page={page}
      onPageChange={setPage}
      />
    </>
  );
}
