/**
 * Admin Activity Log API
 * GET /api/admin/activity
 *
 * Returns recent activity log for the admin panel.
 * Admin-only endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: NextRequest) {
  // Use secure auth verification that checks database
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit") || "50";
  // Cap limit to prevent abuse (max 1000)
  const limit = Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 1000);
  const action = searchParams.get("action"); // filter by action type
  const userId = searchParams.get("userId"); // filter by user

  try {
    let query = supabase
      .from("user_activity")
      .select(`
        id,
        user_id,
        action,
        tab,
        metadata,
        created_at,
        dashboard_users (
          id,
          name,
          role
        )
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Validate and apply action filter
    if (action) {
      const validActions = ["login", "logout", "page_view", "failed_login"];
      if (!validActions.includes(action)) {
        return NextResponse.json(
          { error: "Invalid action type" },
          { status: 400 }
        );
      }
      query = query.eq("action", action);
    }

    // Validate and apply userId filter
    if (userId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        return NextResponse.json(
          { error: "Invalid user ID format" },
          { status: 400 }
        );
      }
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Transform data for easier consumption
    // Note: dashboard_users is a single object from the foreign key join
    const activities = data?.map((item) => {
      // Supabase returns joined relations as object, but TS infers array
      const user = item.dashboard_users as unknown as { id: string; name: string; role: string } | null;
      return {
        id: item.id,
        userId: item.user_id,
        userName: user?.name || "Unknown",
        userRole: user?.role || null,
        action: item.action,
        tab: item.tab,
        metadata: item.metadata,
        createdAt: item.created_at,
      };
    });

    return NextResponse.json({ activities });
  } catch (error) {
    console.error("Activity log error:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity log" },
      { status: 500 }
    );
  }
}
