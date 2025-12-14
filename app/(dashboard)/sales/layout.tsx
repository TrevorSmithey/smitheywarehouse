"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboard } from "../layout";
import type { WholesaleResponse, WholesalePeriod, LeadsResponse } from "@/lib/types";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface SalesContextType {
  // Wholesale data
  wholesaleData: WholesaleResponse | null;
  wholesaleLoading: boolean;
  // Leads data
  leadsData: LeadsResponse | null;
  leadsLoading: boolean;
  // Period selector (shared for wholesale)
  period: WholesalePeriod;
  setPeriod: (period: WholesalePeriod) => void;
  // Actions
  refreshWholesale: () => void;
  refreshLeads: () => void;
}

const SalesContext = createContext<SalesContextType | null>(null);

export function useSales() {
  const context = useContext(SalesContext);
  if (!context) {
    throw new Error("useSales must be used within SalesLayout");
  }
  return context;
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function SalesLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isLeads = pathname === "/sales/leads";
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  // Wholesale state
  const [wholesaleData, setWholesaleData] = useState<WholesaleResponse | null>(null);
  const [wholesaleLoading, setWholesaleLoading] = useState(false);
  const [period, setPeriod] = useState<WholesalePeriod>("ytd");

  // Leads state
  const [leadsData, setLeadsData] = useState<LeadsResponse | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(false);

  // Fetch wholesale data
  const fetchWholesale = useCallback(async () => {
    try {
      setWholesaleLoading(true);
      setIsRefreshing(true);
      const res = await fetch(`/api/wholesale?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch wholesale data");
      const result: WholesaleResponse = await res.json();
      setWholesaleData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Wholesale fetch error:", err);
    } finally {
      setWholesaleLoading(false);
      setIsRefreshing(false);
    }
  }, [period, setLastRefresh, setIsRefreshing]);

  // Fetch leads data
  const fetchLeads = useCallback(async () => {
    try {
      setLeadsLoading(true);
      setIsRefreshing(true);
      const res = await fetch("/api/leads");
      if (!res.ok) throw new Error("Failed to fetch leads data");
      const result: LeadsResponse = await res.json();
      setLeadsData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Leads fetch error:", err);
    } finally {
      setLeadsLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Combined refresh for the current tab
  const refresh = useCallback(() => {
    if (isLeads) {
      fetchLeads();
    } else {
      fetchWholesale();
    }
  }, [isLeads, fetchLeads, fetchWholesale]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => refresh);
    return () => setTriggerRefresh(null);
  }, [refresh, setTriggerRefresh]);

  // Initial data fetch for current tab
  useEffect(() => {
    if (isLeads && !leadsData && !leadsLoading) {
      fetchLeads();
    } else if (!isLeads && !wholesaleData && !wholesaleLoading) {
      fetchWholesale();
    }
  }, [isLeads, leadsData, leadsLoading, wholesaleData, wholesaleLoading, fetchLeads, fetchWholesale]);

  // Refetch wholesale when period changes
  useEffect(() => {
    if (!isLeads && wholesaleData) {
      fetchWholesale();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Context value
  const contextValue: SalesContextType = {
    wholesaleData,
    wholesaleLoading,
    leadsData,
    leadsLoading,
    period,
    setPeriod,
    refreshWholesale: fetchWholesale,
    refreshLeads: fetchLeads,
  };

  return (
    <SalesContext.Provider value={contextValue}>
      <div className="space-y-4">
        {/* Sub-navigation tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-4 border-b border-border/30 pb-2">
            <Link
              href="/sales"
              className={`text-sm font-medium transition-all pb-2 border-b-2 ${
                !isLeads
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Wholesale
            </Link>
            <Link
              href="/sales/leads"
              className={`text-sm font-medium transition-all pb-2 border-b-2 ${
                isLeads
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Leads
            </Link>
          </div>
        </div>

        {children}
      </div>
    </SalesContext.Provider>
  );
}
