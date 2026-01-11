"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import {
  Activity,
  RefreshCw,
  Users,
  LogIn,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
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
// TYPES
// ============================================================================

interface EngagementSummary {
  activeUsers: number;
  totalSessions: number;
  totalLogins: number;
  failedLogins: number;
  daysWindow: number;
}

interface UserBreakdown {
  userId: string;
  userName: string;
  userRole: string | null;
  sessionCount: number;
  totalActivities: number;
  lastActiveAt: string | null;
  barPercent: number;
}

interface TabUsage {
  tab: string;
  views: number;
  barPercent: number;
}

interface EngagementData {
  summary: EngagementSummary;
  userBreakdown: UserBreakdown[];
  tabUsage: TabUsage[];
  lastActive: UserBreakdown[];
}

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
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "1d";
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

// ============================================================================
// CHART TOOLTIP
// ============================================================================

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: UserBreakdown | TabUsage }>;
  label?: string;
}

function UserTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload as UserBreakdown;
  return (
    <div className="bg-bg-tertiary border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-sm font-medium text-text-primary">{data.userName}</p>
      <p className="text-xs text-text-secondary mt-1">
        {data.sessionCount} sessions · {data.totalActivities} activities
      </p>
    </div>
  );
}

function TabTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload as TabUsage;
  const tabLabel = TAB_CONFIG[data.tab as DashboardTab]?.label || data.tab;
  return (
    <div className="bg-bg-tertiary border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-sm font-medium text-text-primary">{tabLabel}</p>
      <p className="text-xs text-text-secondary mt-1">{data.views} views</p>
    </div>
  );
}

// ============================================================================
// ACTIVITY VIEW COMPONENT
// ============================================================================

export default function ActivityView() {
  const { users } = useAdmin();

  // Mounted ref for async safety
  const isMountedRef = useRef(true);

  // Engagement data state
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [engagementLoading, setEngagementLoading] = useState(false);

  // Raw activity state (for collapsed log)
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [showRawLog, setShowRawLog] = useState(false);
  const [activityFilter, setActivityFilter] = useState<{
    userId: string;
    action: string;
  }>({ userId: "", action: "" });

  // Load engagement data
  const loadEngagement = useCallback(async () => {
    setEngagementLoading(true);
    try {
      const res = await fetch("/api/admin/activity/engagement", {
        headers: getAuthHeaders(),
      });
      if (res.ok && isMountedRef.current) {
        const data = await res.json();
        setEngagement(data);
      }
    } catch (error) {
      console.error("Failed to load engagement:", error);
    } finally {
      if (isMountedRef.current) {
        setEngagementLoading(false);
      }
    }
  }, []);

  // Load raw activity log
  const loadActivities = useCallback(
    async (filters?: { userId?: string; action?: string }) => {
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
    },
    []
  );

  // Initial load
  useEffect(() => {
    isMountedRef.current = true;
    loadEngagement();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadEngagement]);

  // Load raw activities when expanded
  useEffect(() => {
    if (showRawLog && activities.length === 0) {
      loadActivities();
    }
  }, [showRawLog, activities.length, loadActivities]);

  const handleRefresh = () => {
    loadEngagement();
    if (showRawLog) {
      loadActivities({
        userId: activityFilter.userId || undefined,
        action: activityFilter.action || undefined,
      });
    }
  };

  // Loading state
  if (engagementLoading && !engagement) {
    return (
      <div className="flex justify-center py-16">
        <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
      </div>
    );
  }

  const summary = engagement?.summary;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-medium text-text-primary">
            User Engagement
          </h2>
          <p className="text-sm text-text-tertiary mt-1">
            Last {summary?.daysWindow || 7} days
          </p>
        </div>

        <button
          onClick={handleRefresh}
          className="p-2 rounded-lg text-text-tertiary hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
          title="Refresh"
        >
          <RefreshCw
            className={`w-4 h-4 ${engagementLoading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={Users}
          label="Active Users"
          value={summary?.activeUsers || 0}
          subtext="this week"
        />
        <SummaryCard
          icon={Activity}
          label="Sessions"
          value={summary?.totalSessions || 0}
          subtext="total"
        />
        <SummaryCard
          icon={LogIn}
          label="Logins"
          value={summary?.totalLogins || 0}
          subtext="total"
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Failed Attempts"
          value={summary?.failedLogins || 0}
          subtext="blocked"
          alert={summary?.failedLogins ? summary.failedLogins > 0 : false}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* User Breakdown - Takes 2 columns */}
        <div className="lg:col-span-2 bg-bg-secondary rounded-xl border border-border/30 p-5">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-4">
            USER BREAKDOWN
          </h3>

          {engagement?.userBreakdown.length === 0 ? (
            <div className="text-center py-8 text-text-tertiary">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No user activity this week</p>
            </div>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={engagement?.userBreakdown || []}
                  layout="vertical"
                  margin={{ top: 0, right: 20, bottom: 0, left: 80 }}
                >
                  <XAxis
                    type="number"
                    stroke="#64748B"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="userName"
                    stroke="#64748B"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={75}
                  />
                  <Tooltip
                    content={<UserTooltip />}
                    cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  />
                  <Bar
                    dataKey="sessionCount"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={24}
                  >
                    {engagement?.userBreakdown.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === 0 ? "#0EA5E9" : "#0EA5E9"}
                        fillOpacity={1 - index * 0.1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Right Column - Tab Usage + Last Active */}
        <div className="space-y-6">
          {/* Tab Usage */}
          <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-4">
              TAB USAGE
            </h3>
            <div className="space-y-3">
              {engagement?.tabUsage.slice(0, 6).map((tab) => {
                const tabLabel =
                  TAB_CONFIG[tab.tab as DashboardTab]?.label || tab.tab;
                return (
                  <div key={tab.tab} className="group">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-secondary truncate">
                        {tabLabel}
                      </span>
                      <span className="text-text-tertiary tabular-nums">
                        {tab.views}
                      </span>
                    </div>
                    <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-blue rounded-full transition-all duration-500"
                        style={{ width: `${tab.barPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {!engagement?.tabUsage.length && (
                <p className="text-xs text-text-muted text-center py-4">
                  No tab views recorded
                </p>
              )}
            </div>
          </div>

          {/* Last Active */}
          <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-4">
              LAST ACTIVE
            </h3>
            <div className="space-y-2.5">
              {engagement?.lastActive.slice(0, 6).map((user) => (
                <div
                  key={user.userId}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <UserAvatar
                      name={user.userName}
                      role={user.userRole as DashboardRole}
                      size="sm"
                    />
                    <span className="text-sm text-text-primary truncate">
                      {user.userName}
                    </span>
                  </div>
                  <span className="text-xs text-text-tertiary tabular-nums flex-shrink-0 ml-2">
                    {formatRelativeTime(user.lastActiveAt)}
                  </span>
                </div>
              ))}
              {!engagement?.lastActive.length && (
                <p className="text-xs text-text-muted text-center py-4">
                  No recent activity
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Raw Log */}
      <div className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
        <button
          onClick={() => setShowRawLog(!showRawLog)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            {showRawLog ? (
              <ChevronDown className="w-4 h-4 text-text-tertiary" />
            ) : (
              <ChevronRight className="w-4 h-4 text-text-tertiary" />
            )}
            <span className="text-sm text-text-secondary">Raw Activity Log</span>
          </div>
          <span className="text-xs text-text-muted">Last 100 entries</span>
        </button>

        {showRawLog && (
          <div className="border-t border-border/30">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 p-4 bg-bg-tertiary/30">
              <select
                value={activityFilter.userId}
                onChange={(e) => {
                  const newFilter = {
                    ...activityFilter,
                    userId: e.target.value,
                  };
                  setActivityFilter(newFilter);
                  loadActivities({
                    userId: newFilter.userId || undefined,
                    action: newFilter.action || undefined,
                  });
                }}
                className="px-3 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary focus:border-accent-blue focus:outline-none transition-all"
              >
                <option value="">All Users</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>

              <select
                value={activityFilter.action}
                onChange={(e) => {
                  const newFilter = {
                    ...activityFilter,
                    action: e.target.value,
                  };
                  setActivityFilter(newFilter);
                  loadActivities({
                    userId: newFilter.userId || undefined,
                    action: newFilter.action || undefined,
                  });
                }}
                className="px-3 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary focus:border-accent-blue focus:outline-none transition-all"
              >
                <option value="">All Actions</option>
                <option value="login">Login</option>
                <option value="page_view">Page View</option>
                <option value="failed_login">Failed Login</option>
              </select>

              <button
                onClick={() =>
                  loadActivities({
                    userId: activityFilter.userId || undefined,
                    action: activityFilter.action || undefined,
                  })
                }
                className="p-1.5 rounded-lg text-text-tertiary hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
                title="Refresh"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    activitiesLoading ? "animate-spin" : ""
                  }`}
                />
              </button>
            </div>

            {/* Table */}
            {activitiesLoading && activities.length === 0 ? (
              <div className="flex justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-accent-blue" />
              </div>
            ) : activities.length === 0 ? (
              <div className="text-center py-12 text-text-tertiary">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No activity recorded.</p>
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
                <table className="w-full">
                  <thead className="sticky top-0 bg-bg-tertiary/95 backdrop-blur-sm z-10">
                    <tr className="border-b border-border/20">
                      <th className="text-left py-2.5 px-4 text-[10px] uppercase tracking-wider text-text-muted font-medium">
                        User
                      </th>
                      <th className="text-left py-2.5 px-4 text-[10px] uppercase tracking-wider text-text-muted font-medium">
                        Action
                      </th>
                      <th className="text-left py-2.5 px-4 text-[10px] uppercase tracking-wider text-text-muted font-medium">
                        Tab
                      </th>
                      <th className="text-right py-2.5 px-4 text-[10px] uppercase tracking-wider text-text-muted font-medium">
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {activities.map((activity) => (
                      <tr
                        key={activity.id}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <UserAvatar
                              name={activity.userName}
                              role={activity.userRole as DashboardRole}
                              size="sm"
                            />
                            <span className="text-xs text-text-primary">
                              {activity.userName}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`
                            inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium
                            ${
                              activity.action === "login"
                                ? "bg-accent-cyan/10 text-accent-cyan"
                                : activity.action === "failed_login"
                                ? "bg-status-bad/10 text-status-bad"
                                : activity.action === "logout"
                                ? "bg-text-muted/10 text-text-secondary"
                                : "bg-accent-blue/10 text-accent-blue"
                            }
                          `}
                          >
                            {activity.action === "page_view"
                              ? "viewed"
                              : activity.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          {activity.tab ? (
                            <span className="text-xs text-text-secondary">
                              {TAB_CONFIG[activity.tab as DashboardTab]?.label ||
                                activity.tab}
                            </span>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className="text-[10px] text-text-tertiary tabular-nums">
                            {formatRelativeTime(activity.createdAt)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SUMMARY CARD COMPONENT
// ============================================================================

interface SummaryCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  subtext: string;
  alert?: boolean;
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  subtext,
  alert,
}: SummaryCardProps) {
  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              alert ? "text-status-warning" : "text-text-primary"
            }`}
          >
            {value}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">
            {label}
          </div>
          <div className="text-xs text-text-tertiary">{subtext}</div>
        </div>
        <div
          className={`p-2 rounded-lg ${
            alert ? "bg-status-warning/10" : "bg-bg-tertiary"
          }`}
        >
          <Icon
            className={`w-4 h-4 ${
              alert ? "text-status-warning" : "text-text-tertiary"
            }`}
          />
        </div>
      </div>
    </div>
  );
}
