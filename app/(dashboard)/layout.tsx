"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  MessageCircle,
  Target,
  Hammer,
  Package,
  Gift,
  Mail,
  TrendingUp,
  DollarSign,
} from "lucide-react";
import { SyncHealthBanner } from "@/components/SyncHealthBanner";

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
 * Navigation tabs configuration
 * Each tab maps to a route and has an icon
 */
const NAV_TABS = [
  { href: "/inventory", label: "INVENTORY", icon: BarChart3 },
  { href: "/voc", label: "CUSTOMER SERVICE", icon: MessageCircle },
  { href: "/budget", label: "BUDGET V ACTUAL", icon: Target },
  { href: "/production", label: "PRODUCTION", icon: Hammer },
  { href: "/fulfillment", label: "FULFILLMENT", icon: Package },
  { href: "/holiday", label: "Q4 PACE", icon: Gift },
  { href: "/marketing", label: "MARKETING", icon: Mail },
  { href: "/sales", label: "SALES", icon: TrendingUp },
] as const;

// Hidden tab - only shown when secret code is entered
const HIDDEN_TABS = [
  { href: "/pl", label: "P&L", icon: DollarSign, code: "5555" },
] as const;

// Secret code to unlock hidden tabs
const SECRET_CODE = "5555";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [triggerRefresh, setTriggerRefresh] = useState<(() => void) | null>(null);

  // Hidden tab state - persisted in localStorage
  const [showHiddenTabs, setShowHiddenTabs] = useState(false);
  const [keySequence, setKeySequence] = useState("");

  // Check localStorage on mount for hidden tab state
  useEffect(() => {
    const saved = localStorage.getItem("smithey_pl_unlocked");
    if (saved === "true") {
      setShowHiddenTabs(true);
    }
  }, []);

  // Listen for secret code keystrokes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Only track number keys
      if (e.key >= "0" && e.key <= "9") {
        setKeySequence((prev) => {
          const newSeq = (prev + e.key).slice(-4); // Keep last 4 digits
          if (newSeq === SECRET_CODE) {
            setShowHiddenTabs(true);
            localStorage.setItem("smithey_pl_unlocked", "true");
          }
          return newSeq;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /**
   * Determine which tab is active based on current pathname
   * Fulfillment matches both /fulfillment and /fulfillment/tracking
   */
  const getActiveTab = useCallback(() => {
    // Check hidden tabs first
    for (const tab of HIDDEN_TABS) {
      if (pathname === tab.href || pathname.startsWith(tab.href + "/")) {
        return tab.href;
      }
    }
    for (const tab of NAV_TABS) {
      if (pathname === tab.href || pathname.startsWith(tab.href + "/")) {
        return tab.href;
      }
    }
    return "/inventory";
  }, [pathname]);

  const activeTab = getActiveTab();

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
      <div className="min-h-screen bg-bg-primary text-text-primary p-4 sm:p-6 overscroll-none">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
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

          {/* Primary Tab Navigation */}
          <nav className="flex gap-1 mt-4 border-b border-border overflow-x-auto touch-pan-x">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.href;

              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
                    isActive
                      ? "text-accent-blue border-accent-blue"
                      : "text-text-tertiary border-transparent hover:text-text-secondary"
                  }`}
                >
                  <Icon className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
                  {tab.label}
                </Link>
              );
            })}

            {/* Hidden tabs - only shown after secret code is entered */}
            {showHiddenTabs &&
              HIDDEN_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.href;

                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`px-4 sm:px-5 py-2.5 text-xs font-semibold tracking-wider transition-all border-b-2 -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:bg-white/5 ${
                      isActive
                        ? "text-emerald-400 border-emerald-400"
                        : "text-emerald-600/60 border-transparent hover:text-emerald-400/80"
                    }`}
                  >
                    <Icon className="w-4 h-4 inline-block mr-1.5 sm:mr-2 -mt-0.5" />
                    {tab.label}
                  </Link>
                );
              })}
          </nav>
        </header>

        {/* Page Content */}
        {children}

        {/* Sync Health Banner - data freshness indicator at bottom of ALL pages */}
        <SyncHealthBanner />
      </div>
    </DashboardContext.Provider>
  );
}
