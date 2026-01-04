import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/config
 *
 * Get all dashboard configuration (tab order, hidden tabs, role permissions, role defaults).
 */
export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("dashboard_config")
      .select("key, value");

    if (error) throw error;

    // Convert array of key-value pairs to object
    const config: Record<string, unknown> = {};
    for (const row of data || []) {
      config[row.key] = row.value;
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error("Error fetching config:", error);
    return NextResponse.json({ error: "Failed to fetch config" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/config
 *
 * Update dashboard configuration. Expects body with:
 * - tab_order?: string[]
 * - hidden_tabs?: string[]
 * - role_permissions?: Record<string, string[]>
 * - role_defaults?: Record<string, string>
 * - role_tab_orders?: Record<string, string[]>
 *
 * REQUIRES: Admin role
 */
export async function PUT(request: NextRequest) {
  // Verify admin access
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { tab_order, hidden_tabs, role_permissions, role_defaults, role_tab_orders, updated_by } = body;

    const supabase = createServiceClient();
    const updates: Array<{ key: string; value: unknown; updated_by?: string }> = [];

    if (tab_order !== undefined) {
      updates.push({ key: "tab_order", value: tab_order, updated_by });
    }
    if (hidden_tabs !== undefined) {
      updates.push({ key: "hidden_tabs", value: hidden_tabs, updated_by });
    }
    if (role_permissions !== undefined) {
      updates.push({ key: "role_permissions", value: role_permissions, updated_by });
    }
    if (role_defaults !== undefined) {
      updates.push({ key: "role_defaults", value: role_defaults, updated_by });
    }
    if (role_tab_orders !== undefined) {
      updates.push({ key: "role_tab_orders", value: role_tab_orders, updated_by });
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No config to update" }, { status: 400 });
    }

    // Upsert each config key
    for (const update of updates) {
      const { error } = await supabase
        .from("dashboard_config")
        .upsert(
          {
            key: update.key,
            value: update.value,
            updated_by: update.updated_by || null,
          },
          { onConflict: "key" }
        );

      if (error) {
        console.error(`Error updating ${update.key}:`, error);
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating config:", error);
    return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  }
}
