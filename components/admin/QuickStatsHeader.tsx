"use client";

/**
 * QuickStatsHeader Component
 *
 * Premium statistics cards for the admin panel header.
 * Features refined visual hierarchy, subtle gradients, and smooth micro-interactions.
 */

import { Users, Activity, LayoutGrid, Shield } from "lucide-react";
import { TAB_CONFIG, DashboardTab } from "@/lib/auth/permissions";

interface QuickStatsHeaderProps {
  totalUsers: number;
  activeThisWeek: number;
  activeToday: number;
  mostViewedTab: { tab: string; views: number } | null;
  syncHealthy: boolean;
  syncIssues?: number;
  onStatClick?: (stat: "users" | "activity" | "tabs" | "health") => void;
}

export default function QuickStatsHeader({
  totalUsers,
  activeThisWeek,
  activeToday,
  mostViewedTab,
  syncHealthy,
  syncIssues = 0,
  onStatClick,
}: QuickStatsHeaderProps) {
  const tabLabel = mostViewedTab
    ? TAB_CONFIG[mostViewedTab.tab as DashboardTab]?.label || mostViewedTab.tab
    : "—";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {/* Total Users */}
      <button
        onClick={() => onStatClick?.("users")}
        className="group relative bg-bg-secondary/80 backdrop-blur-sm border border-border rounded-xl p-5 text-left transition-all duration-300 hover:border-accent-blue/30 hover:bg-bg-secondary overflow-hidden"
      >
        {/* Subtle gradient accent */}
        <div className="absolute inset-0 bg-gradient-to-br from-accent-blue/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Icon */}
        <div className="absolute top-4 right-4 text-text-muted group-hover:text-accent-blue/50 transition-colors duration-300">
          <Users className="w-5 h-5" />
        </div>

        <div className="relative">
          <div className="text-3xl font-semibold text-text-primary tracking-tight">
            {totalUsers}
          </div>
          <div className="text-[11px] text-text-tertiary uppercase tracking-widest mt-2 font-medium">
            Dashboard Users
          </div>
        </div>
      </button>

      {/* Active This Week */}
      <button
        onClick={() => onStatClick?.("activity")}
        className="group relative bg-bg-secondary/80 backdrop-blur-sm border border-border rounded-xl p-5 text-left transition-all duration-300 hover:border-status-good/30 hover:bg-bg-secondary overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-status-good/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="absolute top-4 right-4 text-text-muted group-hover:text-status-good/50 transition-colors duration-300">
          <Activity className="w-5 h-5" />
        </div>

        <div className="relative">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold text-text-primary tracking-tight">
              {activeThisWeek}
            </span>
            <span className="text-sm text-text-muted font-normal">
              / {totalUsers}
            </span>
          </div>
          <div className="text-[11px] text-text-tertiary uppercase tracking-widest mt-2 font-medium">
            Active This Week
          </div>
          {activeToday > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-status-good animate-pulse" />
              <span className="text-xs text-status-good font-medium">
                {activeToday} online now
              </span>
            </div>
          )}
        </div>
      </button>

      {/* Most Viewed Tab */}
      <button
        onClick={() => onStatClick?.("tabs")}
        className="group relative bg-bg-secondary/80 backdrop-blur-sm border border-border rounded-xl p-5 text-left transition-all duration-300 hover:border-accent-cyan/30 hover:bg-bg-secondary overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-accent-cyan/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="absolute top-4 right-4 text-text-muted group-hover:text-accent-cyan/50 transition-colors duration-300">
          <LayoutGrid className="w-5 h-5" />
        </div>

        <div className="relative">
          <div className="text-xl font-semibold text-text-primary truncate pr-6">
            {tabLabel}
          </div>
          <div className="text-[11px] text-text-tertiary uppercase tracking-widest mt-2 font-medium">
            Most Viewed Tab
          </div>
          {mostViewedTab && (
            <div className="text-xs text-accent-cyan mt-2 font-medium">
              {mostViewedTab.views.toLocaleString()} views this week
            </div>
          )}
        </div>
      </button>

      {/* Data Health */}
      <button
        onClick={() => onStatClick?.("health")}
        className={`group relative bg-bg-secondary/80 backdrop-blur-sm border rounded-xl p-5 text-left transition-all duration-300 overflow-hidden ${
          syncHealthy
            ? "border-border hover:border-status-good/30"
            : "border-status-warning/30 hover:border-status-warning/50"
        }`}
      >
        <div className={`absolute inset-0 transition-opacity duration-300 ${
          syncHealthy
            ? "bg-gradient-to-br from-status-good/5 to-transparent opacity-0 group-hover:opacity-100"
            : "bg-gradient-to-br from-status-warning/5 to-transparent opacity-50"
        }`} />

        <div className={`absolute top-4 right-4 transition-colors duration-300 ${
          syncHealthy
            ? "text-text-muted group-hover:text-status-good/50"
            : "text-status-warning/50"
        }`}>
          <Shield className="w-5 h-5" />
        </div>

        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                syncHealthy
                  ? "bg-status-good"
                  : "bg-status-warning animate-pulse"
              }`}
            />
            <span className="text-xl font-semibold text-text-primary">
              {syncHealthy ? "Healthy" : `${syncIssues} Issue${syncIssues !== 1 ? "s" : ""}`}
            </span>
          </div>
          <div className="text-[11px] text-text-tertiary uppercase tracking-widest mt-2 font-medium">
            Data Sync Status
          </div>
        </div>
      </button>
    </div>
  );
}
