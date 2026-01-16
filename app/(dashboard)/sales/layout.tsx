"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboard } from "../layout";
import { getAuthHeaders } from "@/lib/auth";
import type { WholesaleResponse, WholesalePeriod, LeadsResponse, DoorHealthResponse, ForecastResponse } from "@/lib/types";

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
  // Forecast data
  forecastData: ForecastResponse | null;
  forecastLoading: boolean;
  forecastError: string | null;
  // Period selector (shared for wholesale)
  period: WholesalePeriod;
  setPeriod: (period: WholesalePeriod) => void;
  // Actions
  refreshWholesale: () => void;
  refreshLeads: () => void;
  refreshDoorHealth: () => void;
  refreshForecast: () => Promise<void>; // MED-3: Returns promise for awaiting
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
  const isDriver = pathname === "/sales/driver";
  const isWholesale = !isLeads && !isDoorHealth && !isDriver;
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

  // Forecast state
  const [forecastData, setForecastData] = useState<ForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

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

  // Fetch forecast data
  const fetchForecast = useCallback(async () => {
    try {
      setForecastLoading(true);
      setForecastError(null);
      setIsRefreshing(true);
      const year = new Date().getFullYear();
      const res = await fetch(`/api/wholesale/forecast?year=${year}&history=true`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch forecast data (${res.status})`);
      }
      const result: ForecastResponse = await res.json();
      setForecastData(result);
      setLastRefresh(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error loading forecast data";
      console.error("Forecast fetch error:", message);
      setForecastError(message);
    } finally {
      setForecastLoading(false);
      setIsRefreshing(false);
    }
  }, [setLastRefresh, setIsRefreshing]);

  // Combined refresh for the current tab
  const refresh = useCallback(() => {
    if (isLeads) {
      fetchLeads();
    } else if (isDoorHealth) {
      fetchDoorHealth();
    } else if (isDriver) {
      fetchForecast();
    } else {
      fetchWholesale();
    }
  }, [isLeads, isDoorHealth, isDriver, fetchLeads, fetchDoorHealth, fetchForecast, fetchWholesale]);

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
    } else if (isDriver && !forecastData && !forecastLoading) {
      fetchForecast();
    } else if (isWholesale && !wholesaleData && !wholesaleLoading) {
      fetchWholesale();
    }
  }, [
    isLeads, isWholesale, isDoorHealth, isDriver,
    leadsData, leadsLoading,
    wholesaleData, wholesaleLoading,
    doorHealthData, doorHealthLoading,
    forecastData, forecastLoading,
    fetchLeads, fetchWholesale, fetchDoorHealth, fetchForecast,
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
    forecastData,
    forecastLoading,
    forecastError,
    period,
    setPeriod,
    refreshWholesale: fetchWholesale,
    refreshLeads: fetchLeads,
    refreshDoorHealth: fetchDoorHealth,
    refreshForecast: fetchForecast,
  }), [
    wholesaleData, wholesaleLoading, wholesaleError,
    leadsData, leadsLoading, leadsError,
    doorHealthData, doorHealthLoading, doorHealthError,
    forecastData, forecastLoading, forecastError,
    period, fetchWholesale, fetchLeads, fetchDoorHealth, fetchForecast,
  ]);

  return (
    <SalesContext.Provider value={contextValue}>
      <div className="space-y-4">
        {/* Sub-navigation tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-4 border-b border-border/30 pb-2">
            <Link
              href="/sales"
              className={`text-sm font-medium transition-all pb-2 border-b-2 -mb-[10px] ${
                isWholesale
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Wholesale
            </Link>
            <Link
              href="/sales/leads"
              className={`text-sm font-medium transition-all pb-2 border-b-2 -mb-[10px] ${
                isLeads
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Leads
            </Link>
            <Link
              href="/sales/door-health"
              className={`text-sm font-medium transition-all pb-2 border-b-2 -mb-[10px] ${
                isDoorHealth
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Doors
            </Link>
            <Link
              href="/sales/driver"
              className={`text-sm font-medium transition-all pb-2 border-b-2 -mb-[10px] ${
                isDriver
                  ? "text-text-primary border-accent-blue"
                  : "text-text-muted hover:text-text-secondary border-transparent"
              }`}
            >
              Driver
            </Link>
          </div>
        </div>

        {children}
      </div>
    </SalesContext.Provider>
  );
}
