"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../layout";
import { getAuthHeaders } from "@/lib/auth";
import type { AssemblyResponse } from "@/lib/types";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface ProductionContextType {
  data: AssemblyResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const ProductionContext = createContext<ProductionContextType | null>(null);

export function useProduction() {
  const context = useContext(ProductionContext);
  if (!context) {
    throw new Error("useProduction must be used within ProductionLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function ProductionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<AssemblyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAssembly = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);
      const res = await fetch("/api/assembly", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch assembly data");
      const result: AssemblyResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Assembly fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch assembly data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchAssembly);
    return () => setTriggerRefresh(null);
  }, [fetchAssembly, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchAssembly();
    }
  }, [data, loading, fetchAssembly]);

  // Context value
  const contextValue: ProductionContextType = {
    data,
    loading,
    error,
    refresh: fetchAssembly,
  };

  return (
    <ProductionContext.Provider value={contextValue}>
      {children}
    </ProductionContext.Provider>
  );
}
