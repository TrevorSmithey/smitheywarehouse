"use client";

import { useState, useEffect, useCallback } from "react";
import { useDashboard } from "../../layout";
import { getAuthHeaders } from "@/lib/auth";
import { PaidMediaDashboard, type AdsResponse } from "@/components/PaidMediaDashboard";

type AdsPeriod = "ttm" | "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d";

export default function PaidMediaPage() {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<AdsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<AdsPeriod>("ttm");

  const fetchAdsData = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null); // Clear previous errors

      const res = await fetch(`/api/ads?period=${period}`, { headers: getAuthHeaders() });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to fetch ads data (HTTP ${res.status})`);
      }

      const result: AdsResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Ads fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to load ads data. Please try again.");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [period, setLastRefresh, setIsRefreshing]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchAdsData);
    return () => setTriggerRefresh(null);
  }, [fetchAdsData, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading && !error) {
      fetchAdsData();
    }
  }, [data, loading, error, fetchAdsData]);

  // Refetch when period changes
  useEffect(() => {
    if (data) {
      fetchAdsData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  return (
    <PaidMediaDashboard
      data={data}
      loading={loading}
      error={error}
      period={period}
      onPeriodChange={setPeriod}
      onRefresh={fetchAdsData}
    />
  );
}
