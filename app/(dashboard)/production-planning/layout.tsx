"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../layout";
import type { ProductionPlanningResponse } from "@/app/api/production-planning/route";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface ProductionPlanningContextType {
  data: ProductionPlanningResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  fetchPeriod: (year: number, month: number) => void;
}

const ProductionPlanningContext = createContext<ProductionPlanningContextType | null>(null);

export function useProductionPlanning() {
  const context = useContext(ProductionPlanningContext);
  if (!context) {
    throw new Error("useProductionPlanning must be used within ProductionPlanningLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function ProductionPlanningLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<ProductionPlanningResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (period?: { year: number; month: number }) => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);

      // Build URL with optional demo parameter for specific period
      let url = "/api/production-planning";
      if (period) {
        const monthStr = String(period.month).padStart(2, "0");
        url += `?demo=${period.year}-${monthStr}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch production planning data");
      const result: ProductionPlanningResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Production planning fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch production planning data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  const fetchPeriod = useCallback((year: number, month: number) => {
    fetchData({ year, month });
  }, [fetchData]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchData);
    return () => setTriggerRefresh(null);
  }, [fetchData, setTriggerRefresh]);

  // Initial data fetch - default to January 2026 (start of new production year)
  useEffect(() => {
    if (!data && !loading) {
      fetchData({ year: 2026, month: 1 });
    }
  }, [data, loading, fetchData]);

  // Context value
  const contextValue: ProductionPlanningContextType = {
    data,
    loading,
    error,
    refresh: () => fetchData(),
    fetchPeriod,
  };

  return (
    <ProductionPlanningContext.Provider value={contextValue}>
      {children}
    </ProductionPlanningContext.Provider>
  );
}
