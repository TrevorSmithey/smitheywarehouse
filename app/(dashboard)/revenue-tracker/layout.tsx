"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../layout";
import type { RevenueTrackerResponse, RevenueTrackerChannel } from "@/lib/types";

// ============================================================================
// TYPES
// ============================================================================

type PeriodMode = "calendar" | "trailing";
type TrailingPeriod = 7 | 30 | 90 | 365;

interface RevenueTrackerContextType {
  data: RevenueTrackerResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  availableYears: number[];
  periodMode: PeriodMode;
  trailingDays: TrailingPeriod;
  setPeriodMode: (mode: PeriodMode, trailingDays?: TrailingPeriod) => void;
  channel: RevenueTrackerChannel;
  setChannel: (channel: RevenueTrackerChannel) => void;
}

const RevenueTrackerContext = createContext<RevenueTrackerContextType | null>(null);

export function useRevenueTracker() {
  const context = useContext(RevenueTrackerContext);
  if (!context) {
    throw new Error("useRevenueTracker must be used within RevenueTrackerLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function RevenueTrackerLayout({ children }: { children: ReactNode }) {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const currentYear = new Date().getFullYear();
  const [data, setData] = useState<RevenueTrackerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [periodMode, setPeriodModeState] = useState<PeriodMode>("calendar");
  const [trailingDays, setTrailingDays] = useState<TrailingPeriod>(365);
  const [channel, setChannelState] = useState<RevenueTrackerChannel>("total");

  // Available years: current year back to 2024
  const availableYears = Array.from(
    { length: currentYear - 2024 + 1 },
    (_, i) => currentYear - i
  );

  // Fetch calendar year data
  const fetchCalendarData = useCallback(async (year: number, ch: RevenueTrackerChannel) => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);
      const res = await fetch(`/api/revenue-tracker?year=${year}&channel=${ch}`);
      if (!res.ok) throw new Error("Failed to fetch revenue data");
      const result: RevenueTrackerResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Revenue tracker fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch revenue data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Fetch trailing period data
  const fetchTrailingData = useCallback(async (days: TrailingPeriod, ch: RevenueTrackerChannel) => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);
      const res = await fetch(`/api/revenue-tracker?trailing=${days}&channel=${ch}`);
      if (!res.ok) throw new Error("Failed to fetch revenue data");
      const result: RevenueTrackerResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Revenue tracker fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch revenue data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Handle year change (calendar mode)
  const handleYearChange = useCallback((year: number) => {
    setSelectedYear(year);
    setPeriodModeState("calendar");
    fetchCalendarData(year, channel);
  }, [fetchCalendarData, channel]);

  // Handle period mode change
  const handlePeriodModeChange = useCallback((mode: PeriodMode, days?: TrailingPeriod) => {
    setPeriodModeState(mode);
    if (mode === "trailing") {
      const trailingPeriod = days || trailingDays;
      setTrailingDays(trailingPeriod);
      fetchTrailingData(trailingPeriod, channel);
    } else {
      fetchCalendarData(selectedYear, channel);
    }
  }, [fetchCalendarData, fetchTrailingData, selectedYear, trailingDays, channel]);

  // Handle channel change
  const handleChannelChange = useCallback((ch: RevenueTrackerChannel) => {
    setChannelState(ch);
    if (periodMode === "trailing") {
      fetchTrailingData(trailingDays, ch);
    } else {
      fetchCalendarData(selectedYear, ch);
    }
  }, [fetchCalendarData, fetchTrailingData, selectedYear, trailingDays, periodMode]);

  // Register refresh handler with parent layout
  useEffect(() => {
    const refreshHandler = () => {
      if (periodMode === "trailing") {
        fetchTrailingData(trailingDays, channel);
      } else {
        fetchCalendarData(selectedYear, channel);
      }
    };
    setTriggerRefresh(() => refreshHandler);
    return () => setTriggerRefresh(null);
  }, [fetchCalendarData, fetchTrailingData, selectedYear, periodMode, trailingDays, channel, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchCalendarData(selectedYear, channel);
    }
  }, [data, loading, selectedYear, channel, fetchCalendarData]);

  // Context value
  const contextValue: RevenueTrackerContextType = {
    data,
    loading,
    error,
    refresh: () => {
      if (periodMode === "trailing") {
        fetchTrailingData(trailingDays, channel);
      } else {
        fetchCalendarData(selectedYear, channel);
      }
    },
    selectedYear,
    setSelectedYear: handleYearChange,
    availableYears,
    periodMode,
    trailingDays,
    setPeriodMode: handlePeriodModeChange,
    channel,
    setChannel: handleChannelChange,
  };

  return (
    <RevenueTrackerContext.Provider value={contextValue}>
      {children}
    </RevenueTrackerContext.Provider>
  );
}
