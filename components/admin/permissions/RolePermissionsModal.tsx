"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Check, Copy, RefreshCw } from "lucide-react";
import { useAdmin } from "@/app/admin/layout";
import {
  DashboardRole,
  DashboardTab,
  ROLE_CONFIG,
  TAB_CONFIG,
  ALL_ROLES,
  ALL_TABS,
} from "@/lib/auth/permissions";

type TabGroup = "operations" | "analytics" | "engagement";

const GROUP_ORDER: TabGroup[] = ["operations", "analytics", "engagement"];
const GROUP_LABELS: Record<TabGroup, string> = {
  operations: "Operations",
  analytics: "Analytics",
  engagement: "Engagement",
};

interface RolePermissionsModalProps {
  role: DashboardRole;
  onClose: () => void;
}

export default function RolePermissionsModal({ role, onClose }: RolePermissionsModalProps) {
  const { config, configSaving, saveConfig } = useAdmin();

  // Local state for permissions being edited
  const [selectedTabs, setSelectedTabs] = useState<Set<DashboardTab>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from config
  useEffect(() => {
    if (config) {
      const perms = config.role_permissions[role] || [];
      if (perms.includes("*")) {
        setSelectedTabs(new Set(ALL_TABS));
      } else {
        setSelectedTabs(new Set(perms as DashboardTab[]));
      }
    }
  }, [config, role]);

  // Track changes
  const checkForChanges = useCallback(() => {
    if (!config) return false;
    const original = config.role_permissions[role] || [];
    if (original.includes("*")) {
      return selectedTabs.size !== ALL_TABS.length;
    }
    if (selectedTabs.size !== original.length) return true;
    return !original.every((t) => selectedTabs.has(t as DashboardTab));
  }, [config, role, selectedTabs]);

  useEffect(() => {
    setHasChanges(checkForChanges());
  }, [checkForChanges]);

  // Group tabs by category
  const tabsByGroup = GROUP_ORDER.reduce((acc, group) => {
    acc[group] = ALL_TABS.filter((tab) => TAB_CONFIG[tab].group === group);
    return acc;
  }, {} as Record<TabGroup, DashboardTab[]>);

  function toggleTab(tab: DashboardTab) {
    setSelectedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tab)) {
        next.delete(tab);
      } else {
        next.add(tab);
      }
      return next;
    });
  }

  function selectAllInGroup(group: TabGroup) {
    setSelectedTabs((prev) => {
      const next = new Set(prev);
      tabsByGroup[group].forEach((tab) => next.add(tab));
      return next;
    });
  }

  function deselectAllInGroup(group: TabGroup) {
    setSelectedTabs((prev) => {
      const next = new Set(prev);
      tabsByGroup[group].forEach((tab) => next.delete(tab));
      return next;
    });
  }

  function isGroupFullySelected(group: TabGroup): boolean {
    return tabsByGroup[group].every((tab) => selectedTabs.has(tab));
  }

  function copyFromRole(sourceRole: DashboardRole) {
    if (!config) return;
    const sourcePerms = config.role_permissions[sourceRole] || [];
    if (sourcePerms.includes("*")) {
      setSelectedTabs(new Set(ALL_TABS));
    } else {
      setSelectedTabs(new Set(sourcePerms as DashboardTab[]));
    }
  }

  async function handleSave() {
    if (!config) return;
    const perms = { ...config.role_permissions };
    perms[role] = Array.from(selectedTabs);
    await saveConfig({ role_permissions: perms });
    onClose();
  }

  function isTabHidden(tab: DashboardTab): boolean {
    return config?.hidden_tabs.includes(tab) ?? false;
  }

  // Other roles to copy from (exclude current role and admin)
  const copyableRoles = ALL_ROLES.filter((r) => r !== role && r !== "admin");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-bg-secondary rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium ${ROLE_CONFIG[role].color}`}>
              {ROLE_CONFIG[role].label}
            </span>
            <h3 className="text-lg font-medium text-text-primary">
              Permissions
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {configSaving && (
              <span className="text-xs text-text-tertiary flex items-center gap-2">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Saving...
              </span>
            )}
            <button
              onClick={onClose}
              className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Copy From */}
        <div className="px-6 py-3 border-b border-border/30 bg-bg-tertiary/30">
          <div className="flex items-center gap-3">
            <Copy className="w-4 h-4 text-text-muted" />
            <span className="text-sm text-text-secondary">Copy from:</span>
            <select
              onChange={(e) => e.target.value && copyFromRole(e.target.value as DashboardRole)}
              className="px-3 py-1.5 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:border-accent-blue focus:outline-none transition-all"
              defaultValue=""
            >
              <option value="" disabled>Select role...</option>
              {copyableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_CONFIG[r].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 overflow-y-auto max-h-[50vh] space-y-6">
          {GROUP_ORDER.map((group) => {
            const fullySelected = isGroupFullySelected(group);

            return (
              <div key={group}>
                {/* Group Header */}
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                    {GROUP_LABELS[group]}
                  </h4>
                  <button
                    onClick={() =>
                      fullySelected ? deselectAllInGroup(group) : selectAllInGroup(group)
                    }
                    className="text-xs text-accent-blue hover:text-accent-cyan transition-colors"
                  >
                    {fullySelected ? "Deselect All" : "Select All"}
                  </button>
                </div>

                {/* Tab Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {tabsByGroup[group].map((tab) => {
                    const selected = selectedTabs.has(tab);
                    const hidden = isTabHidden(tab);

                    return (
                      <button
                        key={tab}
                        onClick={() => toggleTab(tab)}
                        disabled={hidden}
                        className={`
                          flex items-center gap-2 px-3 py-2.5 rounded-lg text-left
                          transition-all duration-150
                          ${hidden
                            ? "opacity-40 cursor-not-allowed bg-bg-tertiary/30"
                            : selected
                              ? "bg-accent-blue/10 border border-accent-blue/30"
                              : "bg-bg-tertiary hover:bg-white/5 border border-transparent"
                          }
                        `}
                        title={hidden ? "This tab is globally hidden" : undefined}
                      >
                        <div className={`
                          w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                          transition-all
                          ${selected
                            ? "bg-accent-blue border-accent-blue"
                            : "bg-transparent border-border"
                          }
                        `}>
                          {selected && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <span className={`text-sm ${selected ? "text-text-primary font-medium" : "text-text-secondary"}`}>
                          {TAB_CONFIG[tab].label}
                        </span>
                        {hidden && (
                          <span className="text-[10px] text-status-warning ml-auto">(hidden)</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border/50 bg-bg-tertiary/30">
          <div className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{selectedTabs.size}</span> tabs selected
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || configSaving}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${hasChanges && !configSaving
                  ? "bg-accent-blue text-white hover:bg-accent-blue/90"
                  : "bg-bg-tertiary text-text-muted cursor-not-allowed"
                }
              `}
            >
              {configSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
