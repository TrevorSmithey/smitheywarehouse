/**
 * Activity Logging API
 * POST /api/activity/log
 *
 * Logs user activity (page views) from the client.
 * Called by dashboard layout when user navigates to a tab.
 *
 * SECURITY: Requires authenticated user.
 * Uses the authenticated session's userId, NOT a client-provided userId.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { logActivity, ActivityAction } from "@/lib/activity";

export async function POST(request: NextRequest) {
  // SECURITY: Verify the user is authenticated
  const session = await getServerSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, tab } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Missing required field: action" },
        { status: 400 }
      );
    }

    // Validate action type
    const validActions: ActivityAction[] = ["login", "logout", "page_view"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: "Invalid action type" },
        { status: 400 }
      );
    }

    // SECURITY: Use session.userId, NOT client-provided userId
    // This prevents users from logging activity as someone else
    await logActivity(session.userId, action, tab);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Activity log error:", error);
    return NextResponse.json(
      { error: "Failed to log activity" },
      { status: 500 }
    );
  }
}
