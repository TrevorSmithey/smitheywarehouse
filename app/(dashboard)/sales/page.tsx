"use client";

import { useState, useEffect, useCallback } from "react";
import { WholesaleDashboard } from "@/components/WholesaleDashboard";
import { useDashboard } from "../layout";
import type { WholesaleResponse, WholesalePeriod } from "@/lib/types";

export default function SalesPage() {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<WholesaleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<WholesalePeriod>("ytd");

  const fetchWholesale = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      const res = await fetch(`/api/wholesale?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch wholesale data");
      const result: WholesaleResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Wholesale fetch error:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [period, setLastRefresh, setIsRefreshing]);

  // Register refresh handler with layout
  useEffect(() => {
    setTriggerRefresh(() => fetchWholesale);
    return () => setTriggerRefresh(null);
  }, [fetchWholesale, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchWholesale();
    }
  }, [data, loading, fetchWholesale]);

  // Refetch when period changes
  useEffect(() => {
    if (data) {
      fetchWholesale();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  return (
    <WholesaleDashboard
      data={data}
      loading={loading}
      period={period}
      onPeriodChange={setPeriod}
      onRefresh={fetchWholesale}
    />
  );
}
