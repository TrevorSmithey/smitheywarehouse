/**
 * Admin Quick Stats API
 * GET /api/admin/stats
 *
 * Returns quick statistics for the admin panel header.
 * Admin-only endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/server";
import { getAdminQuickStats, getAllUserActivitySummaries } from "@/lib/activity";

export async function GET(request: NextRequest) {
  // Use secure auth verification that checks database
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const [quickStats, activitySummaries] = await Promise.all([
      getAdminQuickStats(),
      getAllUserActivitySummaries(),
    ]);

    return NextResponse.json({
      ...quickStats,
      activitySummaries,
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
