"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  MessageCircle,
  Target,
  Hammer,
  Package,
  Gift,
  Mail,
  TrendingUp,
  ShoppingCart,
  Calculator,
  ChevronRight,
  DollarSign,
  Settings,
  LogOut,
  FileText,
} from "lucide-react";
import { SyncHealthBanner } from "@/components/SyncHealthBanner";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { NotificationBell } from "@/components/NotificationBell";
import { AnnouncementProvider } from "@/lib/announcements";
import { useAuth } from "@/lib/auth";
import type { DashboardTab } from "@/lib/auth/permissions";

/**
 * Dashboard Context
 *
 * Provides shared state across all dashboard pages:
 * - lastRefresh: timestamp of last data refresh
 * - setLastRefresh: update the timestamp
 * - isRefreshing: whether any page is currently refreshing
 * - setIsRefreshing: set refresh state
 * - triggerRefresh: function pages can call to request a refresh (set by each page)
 */
interface DashboardContextType {
  lastRefresh: Date | null;
  setLastRefresh: (date: Date) => void;
  isRefreshing: boolean;
  setIsRefreshing: (loading: boolean) => void;
  triggerRefresh: (() => void) | null;
  setTriggerRefresh: (fn: (() => void) | null) => void;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error("useDashboard must be used within DashboardLayout");
  }
  return ctx;
}

/**
 * Tab icon mapping
 */
const TAB_ICONS: Record<DashboardTab, React.ComponentType<{ className?: string }>> = {
  inventory: BarChart3,
  production: Hammer,
  fulfillment: Package,
  "production-planning": Calculator,
  budget: Target,
  "revenue-tracker": DollarSign,
  holiday: Gift,
  pl: FileText,
  voc: MessageCircle,
  marketing: Mail,
  sales: TrendingUp,
  ecommerce: ShoppingCart,
};

/**
 * Tab labels
 */
const TAB_LABELS: Record<DashboardTab, string> = {
  inventory: "INVENTORY",
  production: "PRODUCTION",
  fulfillment: "FULFILLMENT",
  "production-planning": "PLANNING",
  budget: "BUDGET V ACTUAL",
  "revenue-tracker": "REVENUE",
  holiday: "Q4 PACE",
  pl: "EXEC REVENUE REPORT",
  voc: "CUSTOMER SERVICE",
  marketing: "MARKETING",
  sales: "SALES",
  ecommerce: "ECOMMERCE",
};

/**
 * Tab groups for visual separation
 */
const TAB_GROUPS: Record<DashboardTab, string> = {
  inventory: "operations",
  production: "operations",
  fulfillment: "operations",
  "production-planning": "operations",
  budget: "analytics",
  "revenue-tracker": "analytics",
  holiday: "analytics",
  pl: "analytics",
  voc: "engagement",
  marketing: "engagement",
  sales: "engagement",
  ecommerce: "engagement",
};

// Routes that belong to parent tabs (for sub-tab display)
const INVENTORY_ROUTES = ["/inventory", "/fulfillment"];
const PRODUCTION_ROUTES = ["/production", "/production-planning"];

// Sub-tabs configuration
const INVENTORY_SUB_TABS: DashboardTab[] = ["inventory", "fulfillment"];
const PRODUCTION_SUB_TABS: DashboardTab[] = ["production-planning"];

// Sub-tabs that appear under parent tabs (not in main nav)
const SUB_TABS: DashboardTab[] = ["fulfillment", "production-planning"];

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, isLoading, logout, isAdmin, accessibleTabs, canAccess, isImpersonating } = useAuth();

  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [triggerRefresh, setTriggerRefresh] = useState<(() => void) | null>(null);

  // Track previous pathname to avoid duplicate logs
  const prevPathnameRef = useRef<string | null>(null);

  // Check if current route is in a group with sub-tabs
  const isInventoryRoute = INVENTORY_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isProductionRoute = PRODUCTION_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  // Get main tabs from accessibleTabs (respects database tab order)
  // Filter out sub-tabs (fulfillment, production-planning) which appear under parents
  const visibleMainTabs = accessibleTabs.filter((tab) => !SUB_TABS.includes(tab));

  // Filter sub-tabs based on role permissions
  const visibleInventorySubTabs = INVENTORY_SUB_TABS.filter((tab) => canAccess(tab));
  const visibleProductionSubTabs = PRODUCTION_SUB_TABS.filter((tab) => canAccess(tab));

  // Show planning sub-tabs if user has access to production-planning
  const showPlanningSubTabs = canAccess("production-planning");

  // URL-based access control: redirect if user tries to access restricted tab via direct URL
  useEffect(() => {
    if (isLoading || !session) return;

    // Extract the main tab from pathname
    const pathParts = pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return;

    const currentTab = pathParts[0] as DashboardTab;

    // Check if it's a valid dashboard tab (not admin or other routes)
    const allValidTabs: DashboardTab[] = [
      "inventory", "production", "fulfillment", "production-planning",
      "budget", "revenue-tracker", "holiday", "pl", "voc", "marketing", "sales", "ecommerce"
    ];

    if (!allValidTabs.includes(currentTab)) return;

    // Check if user has access
    if (!canAccess(currentTab)) {
      // Redirect to first accessible tab or inventory
      const defaultTab = accessibleTabs[0] || "inventory";
      router.replace(`/${defaultTab}`);
    }
  }, [pathname, session, isLoading, canAccess, accessibleTabs, router]);

  // Log page views for activity tracking
  useEffect(() => {
    // Don't log if not authenticated or still loading
    if (isLoading || !session) return;

    // Don't log if pathname hasn't changed (prevents duplicate on mount)
    if (prevPathnameRef.current === pathname) return;

    // Update ref to current path
    prevPathnameRef.current = pathname;

    // Extract the tab from pathname (e.g., "/inventory/details" -> "inventory")
    const pathParts = pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return;

    const currentTab = pathParts[0];

    // Fire-and-forget activity log - don't await to avoid blocking navigation
    fetch("/api/activity/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.userId,
        action: "page_view",
        tab: currentTab,
      }),
    }).catch((err) => {
      // Silent fail - activity logging shouldn't break navigation
      console.error("Failed to log activity:", err);
    });
  }, [pathname, session, isLoading]);

  /**
   * Determine which main tab is active based on current pathname
   */
  const getActiveTab = useCallback(() => {
    // If on an inventory route, return /inventory as the active main tab
    if (INVENTORY_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"))) {
      return "/inventory";
    }
    // If on a production route, return /production as the active main tab
    if (PRODUCTION_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"))) {
      return "/production";
    }
    // Find matching tab from user's visible tabs (respects DB order)
    for (const tab of visibleMainTabs) {
      if (pathname === `/${tab}` || pathname.startsWith(`/${tab}/`)) {
        return `/${tab}`;
      }
    }
    return "/inventory";
  }, [pathname, visibleMainTabs]);

  /**
   * Determine which sub-tab is active for Inventory group
   */
  const getActiveInventorySubTab = useCallback(() => {
    for (const tab of INVENTORY_SUB_TABS) {
      if (pathname === `/${tab}` || pathname.startsWith(`/${tab}/`)) {
        return `/${tab}`;
      }
    }
    return "/inventory";
  }, [pathname]);

  /**
   * Determine which sub-tab is active for Production group
   */
  const getActiveProductionSubTab = useCallback(() => {
    for (const tab of PRODUCTION_SUB_TABS) {
      if (pathname === `/${tab}` || pathname.startsWith(`/${tab}/`)) {
        return `/${tab}`;
      }
    }
    return "/production";
  }, [pathname]);

  const activeTab = getActiveTab();

  // Auth loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated - AuthContext will redirect, but show loading
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <p className="text-text-secondary">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <DashboardContext.Provider
      value={{
        lastRefresh,
        setLastRefresh,
        isRefreshing,
        setIsRefreshing,
        triggerRefresh,
        setTriggerRefresh,
      }}
    >
      <AnnouncementProvider>
        {/* Impersonation Banner - fixed at top when admin is viewing as another user */}
        <ImpersonationBanner />

      <div
        className={`min-h-screen bg-bg-primary text-text-primary p-4 sm:p-6 overscroll-none ${
          isImpersonating ? "pt-14 sm:pt-14" : ""
        }`}
      >
        {/* System Announcements - full-width banner at top */}
        <AnnouncementBanner />

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Image
                src="/smithey-logo-white.png"
                alt="Smithey"
                width={40}
                height={40}
                className="object-contain"
              />
              <p className="text-sm text-text-secondary uppercase tracking-wide">
                SMITHEY OPERATIONS
              </p>
            </div>

            {/* User info + Admin + Notifications + Logout */}
            <div className="flex items-center gap-4">
              {isAdmin && (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-accent-blue transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:inline uppercase tracking-wider">Admin</span>
                </Link>
              )}
              <NotificationBell />
              <span className="text-xs text-text-secondary uppercase tracking-wider hidden sm:inline">
                {session.name}
              </span>
              <button
                onClick={logout}
                className="flex items-center gap-1 text-xs text-text-tertiary hover:text-status-warning transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Primary Tab Navigation */}
          <nav className="flex gap-1 mt-4 border-b border-border overflow-x-auto touch-pan-x">
            {visibleMainTabs.map((tab, index) => {
              const Icon = TAB_ICONS[tab];
              const isActive = activeTab === `/${tab}`;
              const prevTab = index > 0 ? visibleMainTabs[index - 1] : null;
              const isNewGroup = prevTab && TAB_GROUPS[prevTab] !== TAB_GROUPS[tab];

              return (
                <div key={tab} className="flex items-center">
                  {/* Group separator - subtle vertical divider */}
                  {isNewGroup && <div className="w-px h-4 bg-border/50 mx-2 flex-shrink-0" />}
                  <Link
                    href={`/${tab}`}
                    className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
                      isActive
                        ? "text-accent-blue border-accent-blue"
                        : "text-text-tertiary border-transparent hover:text-text-secondary"
                    }`}
                  >
                    <Icon className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
                    {TAB_LABELS[tab]}
                    {/* Show chevron only if sub-tabs are visible */}
                    {tab === "inventory" && isActive && visibleInventorySubTabs.length > 1 && (
                      <ChevronRight className="w-3 h-3 inline-block ml-1 -mt-0.5 opacity-50" />
                    )}
                    {tab === "production" && isActive && showPlanningSubTabs && (
                      <ChevronRight className="w-3 h-3 inline-block ml-1 -mt-0.5 opacity-50" />
                    )}
                  </Link>
                </div>
              );
            })}
          </nav>

          {/* Inventory Sub-tabs */}
          {isInventoryRoute && visibleInventorySubTabs.length > 1 && (
            <nav className="flex gap-1 mt-1 pl-4 overflow-x-auto touch-pan-x">
              {visibleInventorySubTabs.map((tab) => {
                const Icon = TAB_ICONS[tab];
                const isActive = getActiveInventorySubTab() === `/${tab}`;

                return (
                  <Link
                    key={tab}
                    href={`/${tab}`}
                    className={`px-3 py-1.5 text-[10px] font-semibold tracking-wider transition-all rounded whitespace-nowrap ${
                      isActive
                        ? "bg-accent-blue/20 text-accent-blue"
                        : "text-text-tertiary hover:text-text-secondary hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-3 h-3 inline-block mr-1 -mt-0.5" />
                    {TAB_LABELS[tab]}
                  </Link>
                );
              })}
            </nav>
          )}

          {/* Production Sub-tabs - only show when user has access to production-planning */}
          {isProductionRoute && showPlanningSubTabs && visibleProductionSubTabs.length > 0 && (
            <nav className="flex gap-1 mt-1 pl-4 overflow-x-auto touch-pan-x">
              {visibleProductionSubTabs.map((tab) => {
                const Icon = TAB_ICONS[tab];
                const isActive = getActiveProductionSubTab() === `/${tab}`;

                return (
                  <Link
                    key={tab}
                    href={`/${tab}`}
                    className={`px-3 py-1.5 text-[10px] font-semibold tracking-wider transition-all rounded whitespace-nowrap ${
                      isActive
                        ? "bg-accent-blue/20 text-accent-blue"
                        : "text-text-tertiary hover:text-text-secondary hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-3 h-3 inline-block mr-1 -mt-0.5" />
                    {TAB_LABELS[tab]}
                  </Link>
                );
              })}
            </nav>
          )}
        </header>

        {/* Page Content */}
        {children}

        {/* Sync Health Banner - data freshness indicator (admin only via component) */}
        <SyncHealthBanner />
      </div>
      </AnnouncementProvider>
    </DashboardContext.Provider>
  );
}
