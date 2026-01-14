import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";
import { DashboardTab, ALL_TABS } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/preferences
 *
 * Returns the current user's preferences including their custom tab order.
 * If user has no custom order, returns null (client should fall back to role/global order).
 */
export async function GET(request: NextRequest) {
  // Verify authenticated user
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const supabase = createServiceClient();
    const { data: user, error } = await supabase
      .from("dashboard_users")
      .select("user_tab_order, default_page_override")
      .eq("id", auth.session.userId)
      .single();

    if (error) {
      console.error("Error fetching user preferences:", error);
      return NextResponse.json(
        { error: "Failed to fetch preferences" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      user_tab_order: user?.user_tab_order || null,
      default_page_override: user?.default_page_override || null,
    });
  } catch (error) {
    console.error("Error in GET preferences:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/auth/preferences
 *
 * Updates the current user's preferences.
 *
 * Body:
 * - user_tab_order: DashboardTab[] | null  (null to reset to role/global default)
 */
export async function PATCH(request: NextRequest) {
  // Verify authenticated user
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { user_tab_order } = body;

    // Validate user_tab_order if provided
    if (user_tab_order !== null && user_tab_order !== undefined) {
      // Must be an array
      if (!Array.isArray(user_tab_order)) {
        return NextResponse.json(
          { error: "user_tab_order must be an array or null" },
          { status: 400 }
        );
      }

      // All items must be valid DashboardTab values
      const invalidTabs = user_tab_order.filter(
        (tab: string) => !ALL_TABS.includes(tab as DashboardTab)
      );
      if (invalidTabs.length > 0) {
        return NextResponse.json(
          { error: `Invalid tab IDs: ${invalidTabs.join(", ")}` },
          { status: 400 }
        );
      }
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("dashboard_users")
      .update({
        user_tab_order: user_tab_order ?? null,
      })
      .eq("id", auth.session.userId);

    if (error) {
      console.error("Error updating user preferences:", error);
      return NextResponse.json(
        { error: "Failed to update preferences" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in PATCH preferences:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
