"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../layout";
import { getAuthHeaders } from "@/lib/auth";
import type { InventoryResponse } from "@/lib/types";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface InventoryContextType {
  data: InventoryResponse | null;
  loading: boolean;
  error: string | null;
  expandedCategories: Set<string>;
  toggleCategory: (category: string) => void;
  refresh: () => void;
}

const InventoryContext = createContext<InventoryContextType | null>(null);

export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error("useInventory must be used within InventoryLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function InventoryLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["cast_iron", "carbon_steel", "accessory"]) // factory_second collapsed by default
  );

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const fetchInventory = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);
      const res = await fetch("/api/inventory", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch inventory");
      const result: InventoryResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Inventory fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch inventory");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchInventory);
    return () => setTriggerRefresh(null);
  }, [fetchInventory, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchInventory();
    }
  }, [data, loading, fetchInventory]);

  // Context value
  const contextValue: InventoryContextType = {
    data,
    loading,
    error,
    expandedCategories,
    toggleCategory,
    refresh: fetchInventory,
  };

  return (
    <InventoryContext.Provider value={contextValue}>
      {children}
    </InventoryContext.Provider>
  );
}
