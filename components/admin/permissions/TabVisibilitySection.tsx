"use client";

import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useAdmin } from "@/app/admin/layout";
import {
  DashboardTab,
  TAB_CONFIG,
  ALL_TABS,
} from "@/lib/auth/permissions";

type TabGroup = "operations" | "analytics" | "engagement";

const GROUP_LABELS: Record<TabGroup, string> = {
  operations: "Operations",
  analytics: "Analytics",
  engagement: "Engagement",
};

const GROUP_ORDER: TabGroup[] = ["operations", "analytics", "engagement"];

export default function TabVisibilitySection() {
  const { config, configLoading, configSaving, saveConfig } = useAdmin();

  function toggleVisibility(tab: DashboardTab) {
    if (!config) return;
    const hidden = new Set(config.hidden_tabs);
    if (hidden.has(tab)) {
      hidden.delete(tab);
    } else {
      hidden.add(tab);
    }
    saveConfig({ hidden_tabs: Array.from(hidden) });
  }

  function isHidden(tab: DashboardTab): boolean {
    return config?.hidden_tabs.includes(tab) ?? false;
  }

  // Group tabs by category
  const tabsByGroup = GROUP_ORDER.reduce((acc, group) => {
    acc[group] = ALL_TABS.filter((tab) => TAB_CONFIG[tab].group === group);
    return acc;
  }, {} as Record<TabGroup, DashboardTab[]>);

  if (configLoading) {
    return (
      <div className="flex justify-center py-16">
        <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* Info */}
      <div className="px-4 py-3 rounded-lg bg-accent-blue/5 border border-accent-blue/10 text-sm text-text-secondary">
        <strong className="text-text-primary">Global visibility:</strong> Hidden tabs are invisible to everyone, regardless of role permissions.
      </div>

      {/* Saving indicator */}
      {configSaving && (
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Saving...
        </div>
      )}

      {/* Tab groups */}
      <div className="grid gap-6 lg:grid-cols-3">
        {GROUP_ORDER.map((group) => (
          <div
            key={group}
            className="bg-bg-secondary rounded-xl border border-border/30 p-5"
          >
            <h3 className="text-[11px] uppercase tracking-wider text-text-muted font-medium mb-4">
              {GROUP_LABELS[group]}
            </h3>
            <div className="space-y-2">
              {tabsByGroup[group].map((tab) => {
                const hidden = isHidden(tab);
                return (
                  <button
                    key={tab}
                    onClick={() => toggleVisibility(tab)}
                    className={`
                      w-full flex items-center justify-between p-3 rounded-lg
                      transition-all duration-200
                      ${hidden
                        ? "bg-bg-tertiary/50 opacity-60"
                        : "bg-bg-tertiary hover:bg-white/5"
                      }
                    `}
                  >
                    <span className={`text-sm font-medium ${hidden ? "text-text-muted line-through" : "text-text-primary"}`}>
                      {TAB_CONFIG[tab].label}
                    </span>
                    <div className={`
                      p-1.5 rounded-md transition-colors
                      ${hidden
                        ? "text-text-muted hover:text-status-warning hover:bg-status-warning/10"
                        : "text-status-good bg-status-good/10"
                      }
                    `}>
                      {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <p className="text-xs text-text-muted">
        {config.hidden_tabs.length === 0
          ? "All tabs are currently visible."
          : `${config.hidden_tabs.length} tab${config.hidden_tabs.length !== 1 ? "s" : ""} hidden globally.`
        }
      </p>
    </div>
  );
}
