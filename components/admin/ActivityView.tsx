"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";
import {
  DashboardRole,
  DashboardTab,
  ROLE_CONFIG,
  TAB_CONFIG,
} from "@/lib/auth/permissions";
import type { ActivityEntry } from "@/lib/types";
import { useAdmin } from "@/app/admin/layout";
import UserAvatar from "./UserAvatar";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ============================================================================
// ACTIVITY VIEW COMPONENT
// ============================================================================

export default function ActivityView() {
  const { users } = useAdmin();

  // Mounted ref for async safety
  const isMountedRef = useRef(true);

  // Activity state (fetched here, not from context)
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<{
    userId: string;
    action: string;
  }>({ userId: "", action: "" });

  // Load activity log with mounted check
  const loadActivities = useCallback(async (filters?: { userId?: string; action?: string }) => {
    setActivitiesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (filters?.userId) params.set("userId", filters.userId);
      if (filters?.action) params.set("action", filters.action);

      const res = await fetch(`/api/admin/activity?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok && isMountedRef.current) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error("Failed to load activities:", error);
    } finally {
      if (isMountedRef.current) {
        setActivitiesLoading(false);
      }
    }
  }, []);

  // Initial load with cleanup
  useEffect(() => {
    isMountedRef.current = true;
    loadActivities();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadActivities]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Activity Log</h2>
          <p className="text-sm text-text-tertiary mt-1">Track user logins and page views</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={activityFilter.userId}
            onChange={(e) => {
              const newFilter = { ...activityFilter, userId: e.target.value };
              setActivityFilter(newFilter);
              loadActivities({ userId: newFilter.userId || undefined, action: newFilter.action || undefined });
            }}
            className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none transition-all"
          >
            <option value="">All Users</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>

          <select
            value={activityFilter.action}
            onChange={(e) => {
              const newFilter = { ...activityFilter, action: e.target.value };
              setActivityFilter(newFilter);
              loadActivities({ userId: newFilter.userId || undefined, action: newFilter.action || undefined });
            }}
            className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:border-accent-blue focus:outline-none transition-all"
          >
            <option value="">All Actions</option>
            <option value="login">Login</option>
            <option value="page_view">Page View</option>
            <option value="logout">Logout</option>
          </select>

          <button
            onClick={() => loadActivities({ userId: activityFilter.userId || undefined, action: activityFilter.action || undefined })}
            className="p-2 rounded-lg text-text-tertiary hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${activitiesLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Table */}
      {activitiesLoading && activities.length === 0 ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No activity recorded yet.</p>
        </div>
      ) : (
        <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-bg-tertiary/30">
                  <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">User</th>
                  <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Action</th>
                  <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Tab</th>
                  <th className="text-right py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {activities.map((activity) => (
                  <tr key={activity.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-3">
                        <UserAvatar
                          name={activity.userName}
                          role={activity.userRole as DashboardRole}
                          size="sm"
                        />
                        <div>
                          <span className="text-sm text-text-primary font-medium">{activity.userName}</span>
                          {activity.userRole && (
                            <span className="ml-2 text-xs text-text-muted">
                              {ROLE_CONFIG[activity.userRole as DashboardRole]?.label || activity.userRole}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-5">
                      <span className={`
                        inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium
                        ${activity.action === "login"
                          ? "bg-accent-cyan/10 text-accent-cyan"
                          : activity.action === "logout"
                          ? "bg-text-muted/10 text-text-secondary"
                          : "bg-accent-blue/10 text-accent-blue"
                        }
                      `}>
                        {activity.action === "page_view" ? "viewed" : activity.action}
                      </span>
                    </td>
                    <td className="py-3.5 px-5">
                      {activity.tab ? (
                        <span className="text-sm text-text-secondary">
                          {TAB_CONFIG[activity.tab as DashboardTab]?.label || activity.tab}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <span className="text-xs text-text-tertiary">
                        {formatRelativeTime(activity.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-text-muted">
        Showing the last 100 activity entries.
      </p>
    </div>
  );
}
