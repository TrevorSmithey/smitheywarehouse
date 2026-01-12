import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth, requireAdmin } from "@/lib/auth/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const DashboardTabSchema = z.enum([
  "inventory",
  "production",
  "fulfillment",
  "production-planning",
  "restoration",
  "budget",
  "revenue-tracker",
  "holiday",
  "pl",
  "voc",
  "marketing",
  "sales",
  "ecommerce",
]);

const DashboardRoleSchema = z.enum([
  "admin",
  "exec",
  "ops1",
  "ops2",
  "standard",
  "sales",
  "fulfillment",
  "customer_service",
]);

// Permissions can include "*" for wildcard or specific tabs
const PermissionValueSchema = z.union([
  z.array(DashboardTabSchema),
  z.tuple([z.literal("*")]),
]);

// Note: Using z.string() for record keys instead of DashboardRoleSchema
// because z.record(enumSchema, ...) has unexpected behavior when not all
// enum keys are present in the input - it tries to validate missing keys.
// The application logic already ensures only valid roles are used.
const ConfigUpdateSchema = z.object({
  tab_order: z.array(DashboardTabSchema).optional(),
  hidden_tabs: z.array(DashboardTabSchema).optional(),
  role_permissions: z.record(z.string(), z.array(z.string())).optional(),
  role_defaults: z.record(z.string(), DashboardTabSchema).optional(),
  role_tab_orders: z.record(z.string(), z.array(DashboardTabSchema).nullable()).optional(),
  updated_by: z.string().optional(),
}).strict();

/**
 * GET /api/admin/config
 *
 * Get all dashboard configuration (tab order, hidden tabs, role permissions, role defaults).
 * All authenticated users can read config (needed to determine their accessible tabs).
 * REQUIRES: Any authenticated user
 */
export async function GET(request: NextRequest) {
  // All authenticated users can read config (required for permission checks)
  // Write access (PUT) still requires admin
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

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
    console.log("[Config API] Received body:", JSON.stringify(body, null, 2));

    // Validate input against schema
    const parsed = ConfigUpdateSchema.safeParse(body);
    if (!parsed.success) {
      console.error("[Config API] Validation failed. Body was:", JSON.stringify(body, null, 2));
      console.error("[Config API] Zod errors:", parsed.error.format());
      return NextResponse.json(
        { error: "Invalid config data", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { tab_order, hidden_tabs, role_permissions, role_defaults, role_tab_orders, updated_by } = parsed.data;

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
            updated_by: update.updated_by?.trim() || null,
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
