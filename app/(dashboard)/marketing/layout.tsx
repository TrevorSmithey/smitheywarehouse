"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useDashboard } from "../layout";
import { Mail, TrendingUp } from "lucide-react";
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
// SUB-TABS
// ============================================================================

function MarketingTabs() {
  const pathname = usePathname();

  const tabs = [
    { name: "Email", href: "/marketing", icon: Mail },
    { name: "Paid", href: "/marketing/paid", icon: TrendingUp },
  ];

  return (
    <div className="flex items-center gap-1 mb-6 bg-bg-secondary/50 rounded-lg p-1 w-fit">
      {tabs.map((tab) => {
        const isActive = tab.href === "/marketing"
          ? pathname === "/marketing"
          : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.name}
            href={tab.href}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? "bg-bg-secondary text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.name}
          </Link>
        );
      })}
    </div>
  );
}

// ============================================================================
// LAYOUT COMPONENT
// ============================================================================

export default function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isPaidPage = pathname.startsWith("/marketing/paid");
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

  // Only register Klaviyo refresh handler when on email page
  useEffect(() => {
    if (!isPaidPage) {
      setTriggerRefresh(() => fetchKlaviyo);
      return () => setTriggerRefresh(null);
    }
  }, [fetchKlaviyo, setTriggerRefresh, isPaidPage]);

  // Initial data fetch (only for email page)
  useEffect(() => {
    if (!isPaidPage && !data && !loading) {
      fetchKlaviyo();
    }
  }, [data, loading, fetchKlaviyo, isPaidPage]);

  // Refetch when period changes (only for email page)
  useEffect(() => {
    if (!isPaidPage && data) {
      fetchKlaviyo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, isPaidPage]);

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
      <MarketingTabs />
      {children}
    </MarketingContext.Provider>
  );
}
