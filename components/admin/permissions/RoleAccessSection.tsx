"use client";

import { useState } from "react";
import { RefreshCw, Pencil, Shield } from "lucide-react";
import { useAdmin } from "@/app/admin/layout";
import {
  DashboardRole,
  DashboardTab,
  ROLE_CONFIG,
  TAB_CONFIG,
  ALL_ROLES,
  ALL_TABS,
} from "@/lib/auth/permissions";
import RolePermissionsModal from "./RolePermissionsModal";

type TabGroup = "operations" | "analytics" | "engagement";

export default function RoleAccessSection() {
  const { config, configLoading, users } = useAdmin();
  const [editingRole, setEditingRole] = useState<DashboardRole | null>(null);

  // Exclude admin from the cards (admin always has full access)
  const editableRoles = ALL_ROLES.filter((r) => r !== "admin");

  function getRolePermissions(role: DashboardRole): DashboardTab[] {
    if (!config) return [];
    const perms = config.role_permissions[role] || [];
    if (perms.includes("*")) return ALL_TABS;
    return perms as DashboardTab[];
  }

  function getTabCountByGroup(role: DashboardRole): Record<TabGroup, number> {
    const perms = getRolePermissions(role);
    const visible = perms.filter((tab) => !config?.hidden_tabs.includes(tab));
    return {
      operations: visible.filter((t) => TAB_CONFIG[t]?.group === "operations").length,
      analytics: visible.filter((t) => TAB_CONFIG[t]?.group === "analytics").length,
      engagement: visible.filter((t) => TAB_CONFIG[t]?.group === "engagement").length,
    };
  }

  function getUserCountForRole(role: DashboardRole): number {
    return users.filter((u) => u.role === role && u.is_active).length;
  }

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
      {/* Admin notice */}
      <div className="px-4 py-3 rounded-lg bg-purple-500/5 border border-purple-500/10 text-sm text-text-secondary flex items-center gap-3">
        <Shield className="w-4 h-4 text-purple-400 flex-shrink-0" />
        <span>
          <strong className="text-purple-400">Admin</strong> role always has access to all tabs and cannot be modified.
        </span>
      </div>

      {/* Role Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {editableRoles.map((role) => {
          const perms = getRolePermissions(role);
          const visiblePerms = perms.filter((tab) => !config.hidden_tabs.includes(tab));
          const counts = getTabCountByGroup(role);
          const userCount = getUserCountForRole(role);

          return (
            <div
              key={role}
              className="bg-bg-secondary rounded-xl border border-border/30 p-5 hover:border-border-hover transition-all"
            >
              {/* Role Header */}
              <div className="flex items-center justify-between mb-4">
                <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium ${ROLE_CONFIG[role].color}`}>
                  {ROLE_CONFIG[role].label}
                </span>
                <span className="text-xs text-text-muted">
                  {userCount} user{userCount !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Tab Count */}
              <div className="mb-4">
                <div className="text-2xl font-bold text-text-primary tabular-nums">
                  {visiblePerms.length}
                </div>
                <div className="text-xs text-text-muted">
                  tabs accessible
                </div>
              </div>

              {/* Group Breakdown */}
              <div className="flex gap-4 text-xs mb-5">
                <div>
                  <span className="text-text-muted">Ops: </span>
                  <span className="text-text-secondary font-medium">{counts.operations}</span>
                </div>
                <div>
                  <span className="text-text-muted">Analytics: </span>
                  <span className="text-text-secondary font-medium">{counts.analytics}</span>
                </div>
                <div>
                  <span className="text-text-muted">Engage: </span>
                  <span className="text-text-secondary font-medium">{counts.engagement}</span>
                </div>
              </div>

              {/* Edit Button */}
              <button
                onClick={() => setEditingRole(role)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Permissions
              </button>
            </div>
          );
        })}
      </div>

      {/* Edit Modal */}
      {editingRole && (
        <RolePermissionsModal
          role={editingRole}
          onClose={() => setEditingRole(null)}
        />
      )}
    </div>
  );
}
