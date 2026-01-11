/**
 * Admin Engagement API
 *
 * Returns aggregated user engagement metrics for the admin panel.
 * Calculates sessions (activity grouped by 30min gaps), tab usage, and user breakdowns.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/server";

// Session gap threshold: 30 minutes of inactivity = new session
const SESSION_GAP_MS = 30 * 60 * 1000;

// Time window for engagement metrics
const DAYS_WINDOW = 7;

interface UserSession {
  userId: string;
  userName: string;
  userRole: string | null;
  startedAt: string;
  endedAt: string;
  tabsVisited: string[];
  activityCount: number;
}

interface UserEngagement {
  userId: string;
  userName: string;
  userRole: string | null;
  sessionCount: number;
  totalActivities: number;
  lastActiveAt: string | null;
}

interface TabUsage {
  tab: string;
  views: number;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  const supabase = createServiceClient();

  try {
    // Calculate time window
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - DAYS_WINDOW);

    // Fetch all activity in the time window with user info
    const { data: rawActivity, error: activityError } = await supabase
      .from("user_activity")
      .select(`
        id,
        user_id,
        action,
        tab,
        created_at,
        dashboard_users!left (
          id,
          name,
          role
        )
      `)
      .gte("created_at", windowStart.toISOString())
      .order("created_at", { ascending: true });

    if (activityError) {
      console.error("[ENGAGEMENT] Failed to fetch activity:", activityError);
      return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
    }

    // Group activity into sessions per user
    const userSessions = new Map<string, UserSession[]>();
    const userEngagement = new Map<string, UserEngagement>();
    const tabCounts = new Map<string, number>();
    let totalSessions = 0;
    let totalLogins = 0;
    let failedLogins = 0;

    // First pass: organize by user and count basics
    const activityByUser = new Map<string, typeof rawActivity>();

    for (const activity of rawActivity || []) {
      // Count failed logins (no user_id)
      if (activity.action === "failed_login") {
        failedLogins++;
        continue;
      }

      // Skip activities without user
      if (!activity.user_id) continue;

      // Count logins
      if (activity.action === "login") {
        totalLogins++;
      }

      // Count tab views
      if (activity.action === "page_view" && activity.tab) {
        tabCounts.set(activity.tab, (tabCounts.get(activity.tab) || 0) + 1);
      }

      // Group by user
      const userActivities = activityByUser.get(activity.user_id) || [];
      userActivities.push(activity);
      activityByUser.set(activity.user_id, userActivities);
    }

    // Second pass: calculate sessions per user
    for (const [userId, activities] of activityByUser.entries()) {
      if (activities.length === 0) continue;

      const sessions: UserSession[] = [];
      let currentSession: UserSession | null = null;

      // Get user info from first activity (dashboard_users is a joined object, not array)
      const userInfo = activities[0].dashboard_users as unknown as { id: string; name: string; role: string | null } | null;
      const userName = userInfo?.name || "Unknown";
      const userRole = userInfo?.role || null;

      for (const activity of activities) {
        const activityTime = new Date(activity.created_at).getTime();

        if (!currentSession) {
          // Start new session
          currentSession = {
            userId,
            userName,
            userRole,
            startedAt: activity.created_at,
            endedAt: activity.created_at,
            tabsVisited: activity.tab ? [activity.tab] : [],
            activityCount: 1,
          };
        } else {
          const lastActivityTime = new Date(currentSession.endedAt).getTime();
          const gap = activityTime - lastActivityTime;

          if (gap > SESSION_GAP_MS) {
            // Gap too large, save current session and start new one
            sessions.push(currentSession);
            currentSession = {
              userId,
              userName,
              userRole,
              startedAt: activity.created_at,
              endedAt: activity.created_at,
              tabsVisited: activity.tab ? [activity.tab] : [],
              activityCount: 1,
            };
          } else {
            // Continue current session
            currentSession.endedAt = activity.created_at;
            currentSession.activityCount++;
            if (activity.tab && !currentSession.tabsVisited.includes(activity.tab)) {
              currentSession.tabsVisited.push(activity.tab);
            }
          }
        }
      }

      // Don't forget the last session
      if (currentSession) {
        sessions.push(currentSession);
      }

      userSessions.set(userId, sessions);
      totalSessions += sessions.length;

      // Build user engagement summary
      const lastActivity = activities[activities.length - 1];
      userEngagement.set(userId, {
        userId,
        userName,
        userRole,
        sessionCount: sessions.length,
        totalActivities: activities.length,
        lastActiveAt: lastActivity?.created_at || null,
      });
    }

    // Sort tab usage by count descending
    const tabUsage: TabUsage[] = Array.from(tabCounts.entries())
      .map(([tab, views]) => ({ tab, views }))
      .sort((a, b) => b.views - a.views);

    // Sort user engagement by sessions descending
    const userBreakdown: UserEngagement[] = Array.from(userEngagement.values())
      .sort((a, b) => b.sessionCount - a.sessionCount);

    // Get "last active" sorted by recency
    const lastActive = [...userBreakdown]
      .filter((u) => u.lastActiveAt)
      .sort((a, b) => {
        const aTime = new Date(a.lastActiveAt!).getTime();
        const bTime = new Date(b.lastActiveAt!).getTime();
        return bTime - aTime;
      });

    // Get total active users (distinct users with any activity)
    const activeUsers = userEngagement.size;

    // Get max session count for bar chart scaling
    const maxSessions = Math.max(...userBreakdown.map((u) => u.sessionCount), 1);
    const maxTabViews = Math.max(...tabUsage.map((t) => t.views), 1);

    return NextResponse.json({
      // Summary metrics
      summary: {
        activeUsers,
        totalSessions,
        totalLogins,
        failedLogins,
        daysWindow: DAYS_WINDOW,
      },
      // User breakdown with session counts
      userBreakdown: userBreakdown.map((u) => ({
        ...u,
        barPercent: Math.round((u.sessionCount / maxSessions) * 100),
      })),
      // Tab usage with view counts
      tabUsage: tabUsage.map((t) => ({
        ...t,
        barPercent: Math.round((t.views / maxTabViews) * 100),
      })),
      // Last active list (most recent first)
      lastActive: lastActive.slice(0, 10),
    });
  } catch (error) {
    console.error("[ENGAGEMENT] Unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
