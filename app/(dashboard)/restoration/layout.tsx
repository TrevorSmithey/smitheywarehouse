"use client";

import { ReactNode, createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useDashboard } from "../layout";
import { getAuthHeaders } from "@/lib/auth";
import type { RestorationResponse, RestorationRecord } from "@/app/api/restorations/route";
import { RestorationDetailModal } from "@/components/restorations/RestorationDetailModal";
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
  // Modal state - lifted to layout for shared deep linking
  selectedRestoration: RestorationRecord | null;
  openRestoration: (restoration: RestorationRecord) => void;
  closeRestoration: () => void;
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

  // Modal state - single source of truth for both pages
  const [selectedRestoration, setSelectedRestoration] = useState<RestorationRecord | null>(null);

  // Deep linking support
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const idParam = searchParams.get("id");

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
        params.set("periodStart", start.toISOString());
      }

      // Always include archived items - analytics needs all data
      // Ops board filters out archived items client-side
      params.set("includeArchived", "true");
      const url = `/api/restorations?${params}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
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

  // Refetch when date range changes (only after initial load)
  // Using a ref to track the previous value avoids re-fetch on every fetchRestorations change
  const prevDateRangeRef = useRef(dateRange);
  useEffect(() => {
    // Skip if this is the initial mount (no previous value to compare)
    if (prevDateRangeRef.current === dateRange) return;

    // Only refetch if we already have data (not during initial load)
    if (data) {
      prevDateRangeRef.current = dateRange;
      fetchRestorations();
    }
  }, [dateRange, data, fetchRestorations]);

  // Track processed deep link IDs to prevent re-opening after save
  const processedDeepLinkRef = useRef<string | null>(null);

  // Auto-open modal when URL has ?id= parameter (deep linking)
  useEffect(() => {
    // Skip if no ID param or already processing this ID
    if (!idParam || processedDeepLinkRef.current === idParam) return;
    // Skip if data hasn't loaded yet
    if (!data?.restorations) return;
    // Skip if modal is already open
    if (selectedRestoration) return;

    const restoration = data.restorations.find(
      (r) => String(r.id) === idParam
    );

    if (restoration) {
      // Mark as processed and open modal
      processedDeepLinkRef.current = idParam;
      setSelectedRestoration(restoration);
    } else {
      // ID not found - clear the stale URL param
      console.warn(`[RESTORATION] Deep link ID ${idParam} not found in data`);
      router.replace(pathname, { scroll: false });
    }
  }, [idParam, data?.restorations, selectedRestoration, router, pathname]);

  // Reset processed ID tracking when URL param is cleared
  useEffect(() => {
    if (!idParam) {
      processedDeepLinkRef.current = null;
    }
  }, [idParam]);

  // Handler: Open restoration modal (updates URL for shareability)
  const openRestoration = useCallback((restoration: RestorationRecord) => {
    setSelectedRestoration(restoration);
    router.replace(`${pathname}?id=${restoration.id}`, { scroll: false });
  }, [pathname, router]);

  // Handler: Close modal and clear URL param
  // IMPORTANT: Update URL first, THEN clear state, to avoid race condition
  // where the deep-link effect sees stale idParam and re-opens the modal
  const closeRestoration = useCallback(() => {
    // Mark this ID as "closing" so deep-link effect won't re-open it
    // even if there's a race between URL update and state update
    const closingId = selectedRestoration?.id ? String(selectedRestoration.id) : null;
    if (closingId) {
      processedDeepLinkRef.current = closingId;
    }
    setSelectedRestoration(null);
    if (idParam) {
      router.replace(pathname, { scroll: false });
    }
  }, [idParam, pathname, router, selectedRestoration?.id]);

  // Handler: After save, refresh data and close modal
  const handleSave = useCallback(() => {
    fetchRestorations();
    closeRestoration();
  }, [fetchRestorations, closeRestoration]);

  // Context value
  const contextValue: RestorationContextType = {
    data,
    loading,
    error,
    dateRange,
    setDateRange,
    refresh: fetchRestorations,
    selectedRestoration,
    openRestoration,
    closeRestoration,
  };

  return (
    <RestorationContext.Provider value={contextValue}>
      <TabNavigation />
      {children}
      {/* Modal rendered at layout level - shared by Operations and Analytics */}
      <RestorationDetailModal
        isOpen={!!selectedRestoration}
        onClose={closeRestoration}
        restoration={selectedRestoration}
        onSave={handleSave}
      />
    </RestorationContext.Provider>
  );
}
