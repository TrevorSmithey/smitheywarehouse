import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/announcements/[id]/dismiss
 *
 * Dismiss an announcement for the current user.
 * The announcement will no longer appear for this user,
 * but will still be visible to other users.
 *
 * Requires authentication (any role).
 * Anonymous users can dismiss, but it won't persist.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(request);

  // Require authentication for dismiss to persist
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required to dismiss announcements" },
      { status: 401 }
    );
  }

  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Announcement ID is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Verify announcement exists and is active
    const { data: announcement, error: fetchError } = await supabase
      .from("announcements")
      .select("id")
      .eq("id", id)
      .eq("is_archived", false)
      .single();

    if (fetchError || !announcement) {
      return NextResponse.json(
        { error: "Announcement not found" },
        { status: 404 }
      );
    }

    // Create dismissal record (upsert to handle duplicates)
    const { error } = await supabase.from("announcement_dismissals").upsert(
      {
        announcement_id: id,
        user_id: session.userId,
        dismissed_at: new Date().toISOString(),
      },
      {
        onConflict: "announcement_id,user_id",
      }
    );

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error dismissing announcement:", error);
    return NextResponse.json(
      { error: "Failed to dismiss announcement" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/announcements/[id]/dismiss
 *
 * Restore (un-dismiss) an announcement for the current user.
 * The announcement will appear again in the banner.
 *
 * Requires authentication.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(request);

  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Announcement ID is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Delete the dismissal record
    const { error } = await supabase
      .from("announcement_dismissals")
      .delete()
      .eq("announcement_id", id)
      .eq("user_id", session.userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error restoring announcement:", error);
    return NextResponse.json(
      { error: "Failed to restore announcement" },
      { status: 500 }
    );
  }
}
