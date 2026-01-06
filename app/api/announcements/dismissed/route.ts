import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/announcements/dismissed
 *
 * Fetch announcements that the current user has dismissed.
 * Returns announcements with their dismissal timestamp.
 * Used for the notification bell dropdown.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(request);

  // Must be logged in to see dismissed announcements
  if (!session) {
    return NextResponse.json({ dismissed: [] });
  }

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    // Get user's dismissals with the announcement data
    const { data: dismissals, error: dismissalError } = await supabase
      .from("announcement_dismissals")
      .select(`
        dismissed_at,
        announcements (
          id,
          title,
          message,
          severity,
          starts_at,
          expires_at,
          created_at,
          is_archived
        )
      `)
      .eq("user_id", session.userId)
      .order("dismissed_at", { ascending: false });

    if (dismissalError) throw dismissalError;

    // Define the announcement type for the join
    type AnnouncementData = {
      id: string;
      title: string;
      message: string | null;
      severity: string;
      starts_at: string;
      expires_at: string | null;
      created_at: string;
      is_archived: boolean;
    };

    // Filter to only show non-archived, non-expired announcements
    // (No point showing expired/archived ones in the bell)
    const activeDismissed = (dismissals || [])
      .filter((d) => {
        // Supabase returns the joined data - cast through unknown for safety
        const announcement = d.announcements as unknown as AnnouncementData | null;

        if (!announcement) return false;
        if (announcement.is_archived) return false;
        if (announcement.expires_at && announcement.expires_at < now) return false;
        return true;
      })
      .map((d) => {
        const announcement = d.announcements as unknown as AnnouncementData;

        return {
          id: announcement.id,
          title: announcement.title,
          message: announcement.message,
          severity: announcement.severity,
          created_at: announcement.created_at,
          expires_at: announcement.expires_at,
          dismissed_at: d.dismissed_at,
        };
      });

    return NextResponse.json({ dismissed: activeDismissed });
  } catch (error) {
    console.error("Error fetching dismissed announcements:", error);
    return NextResponse.json(
      { error: "Failed to fetch dismissed announcements" },
      { status: 500 }
    );
  }
}
