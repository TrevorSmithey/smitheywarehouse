import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["admin", "exec", "ops1", "ops2", "standard", "sales"];

/**
 * GET /api/admin/users
 *
 * List all dashboard users (active and inactive).
 * REQUIRES: Admin role
 * NOTE: PINs ARE returned since admin needs to see/share them.
 */
export async function GET(request: NextRequest) {
  // Verify admin access
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const supabase = createServiceClient();
    // Admin can see PINs for sharing with users
    const { data, error } = await supabase
      .from("dashboard_users")
      .select("id, name, email, role, pin, is_active, created_at, last_login_at, last_active_at, notes, default_page_override, additional_tabs")
      .order("is_active", { ascending: false })
      .order("name");

    if (error) throw error;

    return NextResponse.json({ users: data });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

/**
 * POST /api/admin/users
 *
 * Create a new dashboard user.
 * REQUIRES: Admin role
 */
export async function POST(request: NextRequest) {
  // Verify admin access
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { name, email, role, pin, notes, default_page_override, additional_tabs } = body;

    // Validate required fields
    if (!name || !role || !pin) {
      return NextResponse.json(
        { error: "Name, role, and PIN are required" },
        { status: 400 }
      );
    }

    // Validate PIN format
    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json(
        { error: "PIN must be exactly 4 digits" },
        { status: 400 }
      );
    }

    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // SECURITY: Check for PIN collision
    // PINs must be unique among active users to prevent wrong user authentication
    const { data: existingPin } = await supabase
      .from("dashboard_users")
      .select("id")
      .eq("pin", pin)
      .eq("is_active", true)
      .single();

    if (existingPin) {
      return NextResponse.json(
        { error: "PIN already in use. Please choose a different PIN." },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("dashboard_users")
      .insert({
        name,
        email: email || null,
        role,
        pin,
        notes: notes || null,
        default_page_override: default_page_override || null,
        additional_tabs: additional_tabs || [],
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating user:", error);
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    return NextResponse.json({ user: data }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
