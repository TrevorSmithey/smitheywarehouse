import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/announcements/[id]
 *
 * Archive an announcement (soft delete).
 * REQUIRES: Admin role
 *
 * The announcement is marked as archived rather than deleted
 * to preserve history. Archived announcements won't appear
 * in the GET endpoint.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify admin access
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Announcement ID is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Soft delete: set is_archived = true
    const { error } = await supabase
      .from("announcements")
      .update({ is_archived: true })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error archiving announcement:", error);
    return NextResponse.json(
      { error: "Failed to archive announcement" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/announcements/[id]
 *
 * Update an announcement.
 * REQUIRES: Admin role
 *
 * Body (all optional):
 *   - title: string
 *   - message: string
 *   - severity: 'info' | 'warning' | 'critical'
 *   - expires_at: ISO date string | null
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify admin access
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const body = await request.json();
    const { title, message, severity, expires_at } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Announcement ID is required" },
        { status: 400 }
      );
    }

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim().length === 0) {
        return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
      }
      updates.title = title.trim();
    }

    if (message !== undefined) {
      updates.message = message?.trim() || null;
    }

    if (severity !== undefined) {
      const validSeverities = ["info", "warning", "critical"];
      if (!validSeverities.includes(severity)) {
        return NextResponse.json(
          { error: "Invalid severity. Must be info, warning, or critical" },
          { status: 400 }
        );
      }
      updates.severity = severity;
    }

    if (expires_at !== undefined) {
      updates.expires_at = expires_at;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("announcements")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ announcement: data });
  } catch (error) {
    console.error("Error updating announcement:", error);
    return NextResponse.json(
      { error: "Failed to update announcement" },
      { status: 500 }
    );
  }
}
