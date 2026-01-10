"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { useDashboard } from "../layout";
import { getAuthHeaders } from "@/lib/auth";
import type { BudgetResponse, BudgetDateRange, BudgetChannel } from "@/lib/types";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface BudgetContextType {
  data: BudgetResponse | null;
  loading: boolean;
  dateRange: BudgetDateRange;
  setDateRange: (dateRange: BudgetDateRange) => void;
  channel: BudgetChannel;
  setChannel: (channel: BudgetChannel) => void;
  customStart: string;
  setCustomStart: (start: string) => void;
  customEnd: string;
  setCustomEnd: (end: string) => void;
  expandedCategories: Set<string>;
  toggleCategory: (category: string) => void;
  refresh: () => void;
}

const BudgetContext = createContext<BudgetContextType | null>(null);

export function useBudget() {
  const context = useContext(BudgetContext);
  if (!context) {
    throw new Error("useBudget must be used within BudgetLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function BudgetLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<BudgetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<BudgetDateRange>("mtd");
  const [channel, setChannel] = useState<BudgetChannel>("combined");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["cast_iron", "carbon_steel", "glass_lid", "accessories"])
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

  const fetchBudget = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);

      const params = new URLSearchParams();
      params.set("range", dateRange);
      if (dateRange === "custom" && customStart && customEnd) {
        params.set("start", customStart);
        params.set("end", customEnd);
      }

      const res = await fetch(`/api/budget?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch budget data");
      const result: BudgetResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Budget fetch error:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [dateRange, customStart, customEnd, setLastRefresh, setIsRefreshing]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchBudget);
    return () => setTriggerRefresh(null);
  }, [fetchBudget, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchBudget();
    }
  }, [data, loading, fetchBudget]);

  // Refetch when filters change
  useEffect(() => {
    if (data) {
      fetchBudget();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customStart, customEnd]);

  // Context value
  const contextValue: BudgetContextType = {
    data,
    loading,
    dateRange,
    setDateRange,
    channel,
    setChannel,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    expandedCategories,
    toggleCategory,
    refresh: fetchBudget,
  };

  return (
    <BudgetContext.Provider value={contextValue}>
      {children}
    </BudgetContext.Provider>
  );
}
