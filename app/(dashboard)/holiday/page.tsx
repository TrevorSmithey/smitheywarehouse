"use client";

import { useState, useEffect, useCallback } from "react";
import { HolidayDashboard } from "@/components/HolidayDashboard";
import { useDashboard } from "../layout";
import type { HolidayResponse } from "@/lib/types";

export default function HolidayPage() {
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

  // Register refresh handler with layout
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

  return (
    <>
      {error && (
        <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm mb-4">
          <strong>Error:</strong> {error}
          <button
            onClick={fetchHoliday}
            className="ml-4 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
      <HolidayDashboard
        data={data}
        loading={loading}
        onRefresh={fetchHoliday}
      />
    </>
  );
}
