import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getServerSession, requireAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/announcements
 *
 * Fetch active announcements for the current user.
 * Returns announcements that:
 *   - Have started (starts_at <= now)
 *   - Haven't expired (expires_at is null OR expires_at > now)
 *   - Aren't archived
 *   - Haven't been dismissed by this user
 *
 * No auth required - all dashboard users can see announcements.
 * (Dashboard itself is protected by Vercel password + PIN)
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(request);
  // If no session, use "anonymous" - dismissals won't persist
  const userId = session?.userId || "anonymous";

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    // Fetch active, non-expired, non-dismissed announcements
    const { data, error } = await supabase
      .from("announcements")
      .select(
        `
        id,
        title,
        message,
        severity,
        starts_at,
        expires_at,
        created_at
      `
      )
      .eq("is_archived", false)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("severity", { ascending: true }) // critical first (alphabetically: critical < info < warning, so we need custom)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Get user's dismissals
    const { data: dismissals } = await supabase
      .from("announcement_dismissals")
      .select("announcement_id")
      .eq("user_id", userId);

    const dismissedIds = new Set(dismissals?.map((d) => d.announcement_id) || []);

    // Filter out dismissed announcements
    const activeAnnouncements = (data || []).filter((a) => !dismissedIds.has(a.id));

    // Sort by severity priority: critical > warning > info
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    activeAnnouncements.sort((a, b) => {
      const aOrder = severityOrder[a.severity as keyof typeof severityOrder] ?? 2;
      const bOrder = severityOrder[b.severity as keyof typeof severityOrder] ?? 2;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Same severity: newer first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return NextResponse.json({ announcements: activeAnnouncements });
  } catch (error) {
    console.error("Error fetching announcements:", error);
    return NextResponse.json(
      { error: "Failed to fetch announcements" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/announcements
 *
 * Create a new announcement.
 * REQUIRES: Admin role
 *
 * Body:
 *   - title: string (required)
 *   - message: string (optional)
 *   - severity: 'info' | 'warning' | 'critical' (default: 'info')
 *   - starts_at: ISO date string (default: now)
 *   - expires_at: ISO date string (optional)
 */
export async function POST(request: NextRequest) {
  // Verify admin access
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { title, message, severity, starts_at, expires_at } = body;

    // Validate required fields
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Validate severity
    const validSeverities = ["info", "warning", "critical"];
    const safeSeverity = validSeverities.includes(severity) ? severity : "info";

    const supabase = createServiceClient();

    // Convert date-only input (YYYY-MM-DD) to end-of-day timestamp
    // so announcements expire at the END of the specified date
    let expiresAtValue = null;
    if (expires_at) {
      // If it's just a date (YYYY-MM-DD), set to end of day in UTC
      if (/^\d{4}-\d{2}-\d{2}$/.test(expires_at)) {
        expiresAtValue = `${expires_at}T23:59:59.999Z`;
      } else {
        expiresAtValue = expires_at;
      }
    }

    const { data, error } = await supabase
      .from("announcements")
      .insert({
        title: title.trim(),
        message: message?.trim() || null,
        severity: safeSeverity,
        starts_at: starts_at || new Date().toISOString(),
        expires_at: expiresAtValue,
        created_by: auth.session.name,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ announcement: data }, { status: 201 });
  } catch (error) {
    console.error("Error creating announcement:", error);
    return NextResponse.json(
      { error: "Failed to create announcement" },
      { status: 500 }
    );
  }
}
