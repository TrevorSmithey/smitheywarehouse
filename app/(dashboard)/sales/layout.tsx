"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboard } from "../layout";
import { getAuthHeaders } from "@/lib/auth";
import type { WholesaleResponse, WholesalePeriod, LeadsResponse, DoorHealthResponse } from "@/lib/types";

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface SalesContextType {
  // Wholesale data
  wholesaleData: WholesaleResponse | null;
  wholesaleLoading: boolean;
  wholesaleError: string | null;
  // Leads data
  leadsData: LeadsResponse | null;
  leadsLoading: boolean;
  leadsError: string | null;
  // Door Health data
  doorHealthData: DoorHealthResponse | null;
  doorHealthLoading: boolean;
  doorHealthError: string | null;
  // Period selector (shared for wholesale)
  period: WholesalePeriod;
  setPeriod: (period: WholesalePeriod) => void;
  // Actions
  refreshWholesale: () => void;
  refreshLeads: () => void;
  refreshDoorHealth: () => void;
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
  const isDoorHealth = pathname === "/sales/door-health";
  const isWholesale = !isLeads && !isDoorHealth;
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  // Wholesale state
  const [wholesaleData, setWholesaleData] = useState<WholesaleResponse | null>(null);
  const [wholesaleLoading, setWholesaleLoading] = useState(false);
  const [wholesaleError, setWholesaleError] = useState<string | null>(null);
  const [period, setPeriod] = useState<WholesalePeriod>("12m");

  // Leads state
  const [leadsData, setLeadsData] = useState<LeadsResponse | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);

  // Door Health state
  const [doorHealthData, setDoorHealthData] = useState<DoorHealthResponse | null>(null);
  const [doorHealthLoading, setDoorHealthLoading] = useState(false);
  const [doorHealthError, setDoorHealthError] = useState<string | null>(null);

  // Fetch wholesale data
  const fetchWholesale = useCallback(async () => {
    try {
      setWholesaleLoading(true);
      setWholesaleError(null);
      setIsRefreshing(true);
      const res = await fetch(`/api/wholesale?period=${period}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch wholesale data (${res.status})`);
      }
      const result: WholesaleResponse = await res.json();
      setWholesaleData(result);
      setLastRefresh(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error loading wholesale data";
      console.error("Wholesale fetch error:", message);
      setWholesaleError(message);
    } finally {
      setWholesaleLoading(false);
      setIsRefreshing(false);
    }
  }, [period, setLastRefresh, setIsRefreshing]);

  // Fetch leads data
  const fetchLeads = useCallback(async () => {
    try {
      setLeadsLoading(true);
      setLeadsError(null);
      setIsRefreshing(true);
      const res = await fetch("/api/leads", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch leads data (${res.status})`);
      }
      const result: LeadsResponse = await res.json();
      setLeadsData(result);
      setLastRefresh(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error loading leads data";
      console.error("Leads fetch error:", message);
      setLeadsError(message);
    } finally {
      setLeadsLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Fetch door health data
  const fetchDoorHealth = useCallback(async () => {
    try {
      setDoorHealthLoading(true);
      setDoorHealthError(null);
      setIsRefreshing(true);
      const res = await fetch("/api/door-health", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch door health data (${res.status})`);
      }
      const result: DoorHealthResponse = await res.json();
      setDoorHealthData(result);
      setLastRefresh(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error loading door health data";
      console.error("Door health fetch error:", message);
      setDoorHealthError(message);
    } finally {
      setDoorHealthLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Combined refresh for the current tab
  const refresh = useCallback(() => {
    if (isLeads) {
      fetchLeads();
    } else if (isDoorHealth) {
      fetchDoorHealth();
    } else {
      fetchWholesale();
    }
  }, [isLeads, isDoorHealth, fetchLeads, fetchDoorHealth, fetchWholesale]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => refresh);
    return () => setTriggerRefresh(null);
  }, [refresh, setTriggerRefresh]);

  // Initial data fetch for current tab
  useEffect(() => {
    if (isLeads && !leadsData && !leadsLoading) {
      fetchLeads();
    } else if (isDoorHealth) {
      // Door Health needs its own data AND wholesale data for growth chart
      if (!doorHealthData && !doorHealthLoading) {
        fetchDoorHealth();
      }
      if (!wholesaleData && !wholesaleLoading) {
        fetchWholesale();
      }
    } else if (isWholesale && !wholesaleData && !wholesaleLoading) {
      fetchWholesale();
    }
  }, [
    isLeads, isWholesale, isDoorHealth,
    leadsData, leadsLoading,
    wholesaleData, wholesaleLoading,
    doorHealthData, doorHealthLoading,
    fetchLeads, fetchWholesale, fetchDoorHealth,
  ]);

  // Refetch wholesale when period changes
  useEffect(() => {
    if (isWholesale && wholesaleData) {
      fetchWholesale();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Context value - memoized to prevent unnecessary re-renders of consumers
  const contextValue = useMemo<SalesContextType>(() => ({
    wholesaleData,
    wholesaleLoading,
    wholesaleError,
    leadsData,
    leadsLoading,
    leadsError,
    doorHealthData,
    doorHealthLoading,
    doorHealthError,
    period,
    setPeriod,
    refreshWholesale: fetchWholesale,
    refreshLeads: fetchLeads,
    refreshDoorHealth: fetchDoorHealth,
  }), [
    wholesaleData, wholesaleLoading, wholesaleError,
    leadsData, leadsLoading, leadsError,
    doorHealthData, doorHealthLoading, doorHealthError,
    period, fetchWholesale, fetchLeads, fetchDoorHealth,
  ]);

  return (
    <SalesContext.Provider value={contextValue}>
      <div className="space-y-4">
        {/* Sub-navigation tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-4 border-b border-border/30 pb-2">
            <Link
              href="/sales"
              className={`text-sm font-medium transition-all pb-2 border-b-2 ${
                isWholesale
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
            <Link
              href="/sales/door-health"
              className={`text-sm font-medium transition-all pb-2 border-b-2 ${
                isDoorHealth
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Door Health
            </Link>
          </div>
        </div>

        {children}
      </div>
    </SalesContext.Provider>
  );
}
