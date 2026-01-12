import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["admin", "exec", "ops1", "ops2", "standard", "sales", "fulfillment", "customer_service"];

/**
 * PATCH /api/admin/users/[id]
 *
 * Update a dashboard user.
 * REQUIRES: Admin role
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify admin access
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;
    const body = await request.json();
    const { name, email, role, pin, is_active, notes, default_page_override, additional_tabs } = body;

    const supabase = createServiceClient();

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return NextResponse.json(
          { error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` },
          { status: 400 }
        );
      }
      updates.role = role;
    }
    if (pin !== undefined) {
      if (!/^\d{4}$/.test(pin)) {
        return NextResponse.json(
          { error: "PIN must be exactly 4 digits" },
          { status: 400 }
        );
      }

      // SECURITY: Check for PIN collision with OTHER users
      const { data: existingPin } = await supabase
        .from("dashboard_users")
        .select("id")
        .eq("pin", pin)
        .eq("is_active", true)
        .neq("id", id) // Exclude current user
        .single();

      if (existingPin) {
        return NextResponse.json(
          { error: "PIN already in use by another user" },
          { status: 409 }
        );
      }

      updates.pin = pin;
    }
    if (is_active !== undefined) updates.is_active = is_active;
    if (notes !== undefined) updates.notes = notes;
    if (default_page_override !== undefined) updates.default_page_override = default_page_override;
    if (additional_tabs !== undefined) updates.additional_tabs = additional_tabs;

    // SECURITY: Prevent admin from changing their own role or deactivating themselves
    if (auth.session.userId === id) {
      if (role !== undefined && role !== "admin") {
        return NextResponse.json(
          { error: "Cannot change your own role" },
          { status: 403 }
        );
      }
      if (is_active === false) {
        return NextResponse.json(
          { error: "Cannot deactivate your own account" },
          { status: 403 }
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("dashboard_users")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Error updating user:", error);
      return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }

    return NextResponse.json({ user: data });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/users/[id]
 *
 * Soft delete (deactivate) a dashboard user.
 * REQUIRES: Admin role
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify admin access
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const { id } = await params;

    // SECURITY: Prevent admin from deactivating themselves
    if (auth.session.userId === id) {
      return NextResponse.json(
        { error: "Cannot deactivate your own account" },
        { status: 403 }
      );
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("dashboard_users")
      .update({ is_active: false })
      .eq("id", id);

    if (error) {
      console.error("Error deactivating user:", error);
      return NextResponse.json({ error: "Failed to deactivate user" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deactivating user:", error);
    return NextResponse.json({ error: "Failed to deactivate user" }, { status: 500 });
  }
}
