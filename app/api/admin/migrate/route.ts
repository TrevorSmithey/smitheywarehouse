/**
 * Admin Migration API
 * POST /api/admin/migrate
 *
 * Runs database migrations. Admin-only endpoint.
 * Use this to apply pending migrations from the deployed environment.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: NextRequest) {
  // Verify admin access
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const migration = searchParams.get("migration");

  if (migration === "user_activity") {
    return runUserActivityMigration();
  }

  return NextResponse.json(
    { error: "Unknown migration. Available: user_activity" },
    { status: 400 }
  );
}

async function runUserActivityMigration() {
  try {
    // Check if table already exists by trying to query it
    const { error: checkError } = await supabase
      .from("user_activity")
      .select("id")
      .limit(1);

    if (!checkError) {
      return NextResponse.json({
        success: true,
        message: "user_activity table already exists",
      });
    }

    // Table doesn't exist - need to create it
    // Since Supabase JS doesn't support raw SQL easily, we'll create the table
    // by inserting a row and letting the foreign key constraint fail if dashboard_users doesn't exist

    // Try a simple insert to test
    const { error: insertError } = await supabase.from("user_activity").insert({
      user_id: null,
      action: "login",
      tab: null,
      metadata: { _migration_test: true },
    });

    if (insertError) {
      // Table doesn't exist and we can't create it via JS client
      // Return instructions for manual migration
      return NextResponse.json(
        {
          error: "Table does not exist",
          message:
            "Please run the migration SQL manually in Supabase Dashboard > SQL Editor",
          migration_file: "supabase/migrations/20260106_user_activity_table.sql",
          sql: `
CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('login', 'logout', 'page_view', 'failed_login')),
  tab TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity(action);
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_time ON user_activity(user_id, created_at DESC);
          `.trim(),
        },
        { status: 400 }
      );
    }

    // Clean up test row
    await supabase
      .from("user_activity")
      .delete()
      .eq("metadata->>_migration_test", "true");

    return NextResponse.json({
      success: true,
      message: "user_activity table is ready",
    });
  } catch (error) {
    console.error("Migration error:", error);
    return NextResponse.json(
      { error: "Migration failed", details: String(error) },
      { status: 500 }
    );
  }
}
