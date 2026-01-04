import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify-pin
 *
 * Verifies a 4-digit PIN and returns user info if valid.
 * Updates last_login_at on successful auth.
 */
export async function POST(request: NextRequest) {
  try {
    const { pin } = await request.json();

    // Validate PIN format (4 digits)
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return NextResponse.json(
        { error: "Invalid PIN format. Must be 4 digits." },
        { status: 400 }
      );
    }

    // Query database for user with matching PIN
    const supabase = createServiceClient();
    const { data: user, error } = await supabase
      .from("dashboard_users")
      .select("id, name, role")
      .eq("pin", pin)
      .eq("is_active", true)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    // Update last_login_at
    await supabase
      .from("dashboard_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("PIN verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
