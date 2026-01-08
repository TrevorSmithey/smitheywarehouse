"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useDashboard } from "../layout";
import type { RestorationResponse } from "@/app/api/restorations/route";
import { BarChart3, Wrench } from "lucide-react";

// ============================================================================
// DATE RANGE OPTIONS
// ============================================================================

export type RestorationDateRange = "30" | "90" | "365" | "730" | "all";

export const DATE_RANGE_OPTIONS: { value: RestorationDateRange; label: string; days: number | null }[] = [
  { value: "30", label: "30D", days: 30 },
  { value: "90", label: "90D", days: 90 },
  { value: "365", label: "1Y", days: 365 },
  { value: "730", label: "2Y", days: 730 },
  { value: "all", label: "All", days: null },
];

// ============================================================================
// CONTEXT FOR SHARED STATE
// ============================================================================

interface RestorationContextType {
  data: RestorationResponse | null;
  loading: boolean;
  error: string | null;
  dateRange: RestorationDateRange;
  setDateRange: (range: RestorationDateRange) => void;
  refresh: () => void;
}

const RestorationContext = createContext<RestorationContextType | null>(null);

export function useRestoration() {
  const context = useContext(RestorationContext);
  if (!context) {
    throw new Error("useRestoration must be used within RestorationLayout");
  }
  return context;
}

// ============================================================================
// TAB NAVIGATION
// ============================================================================

const TABS = [
  { href: "/restoration", label: "Operations", icon: Wrench },
  { href: "/restoration/analytics", label: "Analytics", icon: BarChart3 },
] as const;

function TabNavigation() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 border-b border-border mb-6">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? "text-accent-blue border-accent-blue"
                : "text-text-secondary border-transparent hover:text-text-primary hover:border-border"
            }`}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function RestorationLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<RestorationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<RestorationDateRange>("all");

  const fetchRestorations = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);

      // Build query params with date range
      const params = new URLSearchParams();
      const option = DATE_RANGE_OPTIONS.find((o) => o.value === dateRange);
      if (option && option.days !== null) {
        const start = new Date();
        start.setDate(start.getDate() - option.days);
        params.set("start", start.toISOString());
      }

      const url = params.toString() ? `/api/restorations?${params}` : "/api/restorations";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch restoration data");
      const result: RestorationResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Restoration fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch restoration data");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [dateRange, setLastRefresh, setIsRefreshing]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchRestorations);
    return () => setTriggerRefresh(null);
  }, [fetchRestorations, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchRestorations();
    }
  }, [data, loading, fetchRestorations]);

  // Refetch when date range changes
  useEffect(() => {
    if (data) {
      fetchRestorations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  // Context value
  const contextValue: RestorationContextType = {
    data,
    loading,
    error,
    dateRange,
    setDateRange,
    refresh: fetchRestorations,
  };

  return (
    <RestorationContext.Provider value={contextValue}>
      <TabNavigation />
      {children}
    </RestorationContext.Provider>
  );
}
