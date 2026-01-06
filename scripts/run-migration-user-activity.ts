/**
 * Run the user_activity table migration
 *
 * Run with: npx tsx scripts/run-migration-user-activity.ts
 *
 * Requires environment variables:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function runMigration() {
  console.log("Creating user_activity table...");

  // Check if table already exists
  const { data: existing, error: checkError } = await supabase
    .from("user_activity")
    .select("id")
    .limit(1);

  if (!checkError) {
    console.log("✓ user_activity table already exists");
    return;
  }

  // Run the migration SQL
  const { error } = await supabase.rpc("exec_sql", {
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

      ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS "Service role only" ON user_activity;
      CREATE POLICY "Service role only" ON user_activity
        FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    `,
  });

  if (error) {
    // exec_sql might not exist, try direct table creation
    console.log("exec_sql not available, trying direct approach...");

    // Just try to insert and see if table exists
    const { error: insertError } = await supabase.from("user_activity").insert({
      user_id: null,
      action: "login",
      metadata: { test: true },
    });

    if (insertError?.code === "42P01") {
      console.error("❌ Table does not exist. Please run the migration manually:");
      console.error("   Go to Supabase Dashboard > SQL Editor and run:");
      console.error("   supabase/migrations/20260106_user_activity_table.sql");
      process.exit(1);
    } else if (insertError) {
      console.error("Error:", insertError);
    } else {
      // Clean up test row
      await supabase.from("user_activity").delete().eq("metadata->>test", "true");
      console.log("✓ user_activity table exists and is working");
    }
  } else {
    console.log("✓ Migration completed successfully");
  }
}

runMigration()
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
