"use client";

import { RefreshCw } from "lucide-react";
import {
  DashboardRole,
  DashboardTab,
  ROLE_CONFIG,
  TAB_CONFIG,
  ALL_ROLES,
} from "@/lib/auth/permissions";
import { useAdmin } from "@/app/admin/layout";

// ============================================================================
// DEFAULTS VIEW COMPONENT
// ============================================================================

export default function DefaultsView() {
  const {
    users,
    config,
    configLoading,
    configSaving,
    saveConfig,
  } = useAdmin();

  function setRoleDefault(role: DashboardRole, tab: DashboardTab) {
    if (!config) return;
    const defaults = { ...config.role_defaults, [role]: tab };
    saveConfig({ role_defaults: defaults });
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Role Defaults</h2>
          <p className="text-sm text-text-tertiary mt-1">Set the default landing page for each role</p>
        </div>
        {configSaving && (
          <span className="text-xs text-text-tertiary flex items-center gap-2">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Saving...
          </span>
        )}
      </div>

      {/* Table */}
      {configLoading ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
        </div>
      ) : config ? (
        <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-bg-tertiary/30">
                <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Role</th>
                <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Default Page</th>
                <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Users</th>
                <th className="text-center py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Overrides</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {ALL_ROLES.map((role) => {
                const accessibleTabs = config.tab_order.filter((tab) => {
                  if (config.hidden_tabs.includes(tab)) return false;
                  if (role === "admin") return true;
                  const perms = config.role_permissions[role] || [];
                  return perms.includes("*") || perms.includes(tab);
                });

                const roleUsers = users.filter((u) => u.role === role && u.is_active);
                const usersWithOverride = roleUsers.filter((u) => u.default_page_override);

                return (
                  <tr key={role} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 px-5">
                      <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium ${ROLE_CONFIG[role].color}`}>
                        {ROLE_CONFIG[role].label}
                      </span>
                    </td>
                    <td className="py-4 px-5">
                      <select
                        value={config.role_defaults[role] || accessibleTabs[0] || "inventory"}
                        onChange={(e) => setRoleDefault(role, e.target.value as DashboardTab)}
                        className="px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none focus:ring-2 focus:ring-accent-blue/20 min-w-[200px] transition-all"
                      >
                        {accessibleTabs.map((tab) => (
                          <option key={tab} value={tab}>
                            {TAB_CONFIG[tab]?.label || tab}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-4 px-5 text-center">
                      <span className="text-sm text-text-secondary font-medium">{roleUsers.length}</span>
                    </td>
                    <td className="py-4 px-5 text-center">
                      {usersWithOverride.length > 0 ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-status-warning/10 text-status-warning text-xs font-medium">
                          {usersWithOverride.length}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-text-muted">
        Users land on their role&apos;s default page after login. Individual overrides can be set in the Users tab.
      </p>
    </div>
  );
}
