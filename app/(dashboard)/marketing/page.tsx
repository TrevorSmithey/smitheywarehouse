"use client";

import { useState, useEffect, useCallback } from "react";
import { KlaviyoDashboard } from "@/components/KlaviyoDashboard";
import { useDashboard } from "../layout";
import type { KlaviyoResponse } from "@/lib/types";

type KlaviyoPeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d";

export default function MarketingPage() {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<KlaviyoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<KlaviyoPeriod>("mtd");

  const fetchKlaviyo = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      const res = await fetch(`/api/klaviyo?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch Klaviyo data");
      const result: KlaviyoResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Klaviyo fetch error:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [period, setLastRefresh, setIsRefreshing]);

  // Register refresh handler with layout
  useEffect(() => {
    setTriggerRefresh(() => fetchKlaviyo);
    return () => setTriggerRefresh(null);
  }, [fetchKlaviyo, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchKlaviyo();
    }
  }, [data, loading, fetchKlaviyo]);

  // Refetch when period changes
  useEffect(() => {
    if (data) {
      fetchKlaviyo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  return (
    <KlaviyoDashboard
      data={data}
      loading={loading}
      period={period}
      onPeriodChange={setPeriod}
      onRefresh={fetchKlaviyo}
    />
  );
}
