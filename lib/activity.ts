/**
 * Activity Logging Utilities
 *
 * Tracks user activity (logins, page views) for admin insights.
 * Activity data powers sparklines, "active now" indicators, and usage stats.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export type ActivityAction = "login" | "logout" | "page_view" | "failed_login";

export interface ActivityLog {
  id: string;
  user_id: string;
  action: ActivityAction;
  tab: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface UserActivitySummary {
  userId: string;
  daysActive: number; // out of last 7
  dailyActivity: boolean[]; // [7 days ago, 6 days ago, ..., today]
  lastActiveAt: string | null;
  isActiveNow: boolean; // active in last 15 minutes
}

/**
 * Log a user activity event
 */
export async function logActivity(
  userId: string,
  action: ActivityAction,
  tab?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("user_activity").insert({
      user_id: userId,
      action,
      tab: tab || null,
      metadata: metadata || null,
    });

    // Also update last_active_at on the user
    if (action !== "failed_login") {
      await supabase
        .from("dashboard_users")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", userId);
    }
  } catch (error) {
    console.error("Failed to log activity:", error);
    // Don't throw - activity logging should never break the app
  }
}

/**
 * Log a failed login attempt (no user_id, just the attempted PIN)
 */
export async function logFailedLogin(attemptedPin: string): Promise<void> {
  try {
    await supabase.from("user_activity").insert({
      user_id: null,
      action: "failed_login",
      metadata: { attempted_pin: attemptedPin.slice(0, 2) + "**" }, // Partial for security
    });
  } catch (error) {
    console.error("Failed to log failed login:", error);
  }
}

/**
 * Get activity summary for a user (7-day sparkline data)
 */
export async function getUserActivitySummary(
  userId: string
): Promise<UserActivitySummary> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const fifteenMinutesAgo = new Date();
  fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);

  try {
    // Get all activity for this user in the last 7 days
    const { data: activities } = await supabase
      .from("user_activity")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: false });

    // Build daily activity array [7 days ago, ..., today]
    const dailyActivity: boolean[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(today);
      dayStart.setDate(dayStart.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const hadActivity = activities?.some((a) => {
        const activityDate = new Date(a.created_at);
        return activityDate >= dayStart && activityDate < dayEnd;
      });

      dailyActivity.push(hadActivity || false);
    }

    const daysActive = dailyActivity.filter(Boolean).length;

    // Get last_active_at from user record
    const { data: user } = await supabase
      .from("dashboard_users")
      .select("last_active_at")
      .eq("id", userId)
      .single();

    const lastActiveAt = user?.last_active_at || null;
    const isActiveNow = lastActiveAt
      ? new Date(lastActiveAt) > fifteenMinutesAgo
      : false;

    return {
      userId,
      daysActive,
      dailyActivity,
      lastActiveAt,
      isActiveNow,
    };
  } catch (error) {
    console.error("Failed to get activity summary:", error);
    return {
      userId,
      daysActive: 0,
      dailyActivity: [false, false, false, false, false, false, false],
      lastActiveAt: null,
      isActiveNow: false,
    };
  }
}

/**
 * Get activity summaries for all users (for admin panel)
 */
export async function getAllUserActivitySummaries(): Promise<
  Record<string, UserActivitySummary>
> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const fifteenMinutesAgo = new Date();
  fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);

  try {
    // Get all users
    const { data: users } = await supabase
      .from("dashboard_users")
      .select("id, last_active_at")
      .eq("is_active", true);

    if (!users) return {};

    // Get all activity in last 7 days
    const { data: activities } = await supabase
      .from("user_activity")
      .select("user_id, created_at")
      .gte("created_at", sevenDaysAgo.toISOString())
      .not("user_id", "is", null);

    const summaries: Record<string, UserActivitySummary> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const user of users) {
      const userActivities = activities?.filter((a) => a.user_id === user.id) || [];

      // Build daily activity array
      const dailyActivity: boolean[] = [];
      for (let i = 6; i >= 0; i--) {
        const dayStart = new Date(today);
        dayStart.setDate(dayStart.getDate() - i);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        const hadActivity = userActivities.some((a) => {
          const activityDate = new Date(a.created_at);
          return activityDate >= dayStart && activityDate < dayEnd;
        });

        dailyActivity.push(hadActivity);
      }

      const lastActiveAt = user.last_active_at || null;
      const isActiveNow = lastActiveAt
        ? new Date(lastActiveAt) > fifteenMinutesAgo
        : false;

      summaries[user.id] = {
        userId: user.id,
        daysActive: dailyActivity.filter(Boolean).length,
        dailyActivity,
        lastActiveAt,
        isActiveNow,
      };
    }

    return summaries;
  } catch (error) {
    console.error("Failed to get all activity summaries:", error);
    return {};
  }
}

/**
 * Get recent activity log (for admin panel)
 */
export async function getRecentActivity(
  limit: number = 50
): Promise<ActivityLog[]> {
  try {
    const { data } = await supabase
      .from("user_activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    return (data as ActivityLog[]) || [];
  } catch (error) {
    console.error("Failed to get recent activity:", error);
    return [];
  }
}

/**
 * Get failed login attempts (for security monitoring)
 */
export async function getFailedLogins(hours: number = 24): Promise<number> {
  const since = new Date();
  since.setHours(since.getHours() - hours);

  try {
    const { count } = await supabase
      .from("user_activity")
      .select("*", { count: "exact", head: true })
      .eq("action", "failed_login")
      .gte("created_at", since.toISOString());

    return count || 0;
  } catch (error) {
    console.error("Failed to get failed logins:", error);
    return 0;
  }
}

/**
 * Get quick stats for admin header
 */
export async function getAdminQuickStats(): Promise<{
  totalUsers: number;
  activeThisWeek: number;
  activeToday: number;
  mostViewedTab: { tab: string; views: number } | null;
  failedLoginsToday: number;
}> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    // Total active users
    const { count: totalUsers } = await supabase
      .from("dashboard_users")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    // Active this week (distinct users with activity)
    const { data: weekActivity } = await supabase
      .from("user_activity")
      .select("user_id")
      .gte("created_at", weekAgo.toISOString())
      .not("user_id", "is", null);

    const activeThisWeek = new Set(weekActivity?.map((a) => a.user_id)).size;

    // Active today
    const { data: todayActivity } = await supabase
      .from("user_activity")
      .select("user_id")
      .gte("created_at", todayStart.toISOString())
      .not("user_id", "is", null);

    const activeToday = new Set(todayActivity?.map((a) => a.user_id)).size;

    // Most viewed tab this week
    const { data: tabViews } = await supabase
      .from("user_activity")
      .select("tab")
      .eq("action", "page_view")
      .gte("created_at", weekAgo.toISOString())
      .not("tab", "is", null);

    let mostViewedTab: { tab: string; views: number } | null = null;
    if (tabViews && tabViews.length > 0) {
      const tabCounts: Record<string, number> = {};
      for (const { tab } of tabViews) {
        if (tab) {
          tabCounts[tab] = (tabCounts[tab] || 0) + 1;
        }
      }
      const topTab = Object.entries(tabCounts).sort((a, b) => b[1] - a[1])[0];
      if (topTab) {
        mostViewedTab = { tab: topTab[0], views: topTab[1] };
      }
    }

    // Failed logins today
    const failedLoginsToday = await getFailedLogins(24);

    return {
      totalUsers: totalUsers || 0,
      activeThisWeek,
      activeToday,
      mostViewedTab,
      failedLoginsToday,
    };
  } catch (error) {
    console.error("Failed to get admin quick stats:", error);
    return {
      totalUsers: 0,
      activeThisWeek: 0,
      activeToday: 0,
      mostViewedTab: null,
      failedLoginsToday: 0,
    };
  }
}
