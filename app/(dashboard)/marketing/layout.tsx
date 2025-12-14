"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../layout";
import type { KlaviyoResponse } from "@/lib/types";

type KlaviyoPeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface MarketingContextType {
  data: KlaviyoResponse | null;
  loading: boolean;
  period: KlaviyoPeriod;
  setPeriod: (period: KlaviyoPeriod) => void;
  refresh: () => void;
}

const MarketingContext = createContext<MarketingContextType | null>(null);

export function useMarketing() {
  const context = useContext(MarketingContext);
  if (!context) {
    throw new Error("useMarketing must be used within MarketingLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
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

  // Register refresh handler with parent layout
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

  // Context value
  const contextValue: MarketingContextType = {
    data,
    loading,
    period,
    setPeriod,
    refresh: fetchKlaviyo,
  };

  return (
    <MarketingContext.Provider value={contextValue}>
      {children}
    </MarketingContext.Provider>
  );
}
