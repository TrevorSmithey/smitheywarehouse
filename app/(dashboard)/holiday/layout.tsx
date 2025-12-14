"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../layout";
import type { HolidayResponse } from "@/lib/types";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface HolidayContextType {
  data: HolidayResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const HolidayContext = createContext<HolidayContextType | null>(null);

export function useHoliday() {
  const context = useContext(HolidayContext);
  if (!context) {
    throw new Error("useHoliday must be used within HolidayLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function HolidayLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<HolidayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHoliday = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);
      const res = await fetch("/api/holiday");
      if (!res.ok) throw new Error("Failed to fetch holiday data");
      const result: HolidayResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Holiday fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch holiday data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchHoliday);
    return () => setTriggerRefresh(null);
  }, [fetchHoliday, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchHoliday();
    }
  }, [data, loading, fetchHoliday]);

  // Context value
  const contextValue: HolidayContextType = {
    data,
    loading,
    error,
    refresh: fetchHoliday,
  };

  return (
    <HolidayContext.Provider value={contextValue}>
      {children}
    </HolidayContext.Provider>
  );
}
