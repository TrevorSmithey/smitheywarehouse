import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function applyMigration() {
  console.log("=== APPLYING SKU NORMALIZATION MIGRATION ===\n");

  // Read the migration file
  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/20251209_sku_normalization.sql"
  );
  const sql = readFileSync(migrationPath, "utf-8");

  // Split into individual statements
  // PostgreSQL requires separate execution for CREATE statements
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));

  console.log(`Found ${statements.length} SQL statements to execute\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    // Skip comments-only blocks
    if (stmt.split("\n").every((line) => line.trim().startsWith("--") || !line.trim())) {
      continue;
    }

    // Extract first meaningful line for logging
    const firstLine = stmt
      .split("\n")
      .find((line) => line.trim() && !line.trim().startsWith("--"))
      ?.trim()
      .substring(0, 60);

    console.log(`[${i + 1}/${statements.length}] ${firstLine}...`);

    const { error } = await supabase.rpc("exec_sql", { sql: stmt + ";" }).single();

    if (error) {
      // Try direct query for DDL
      const { error: directError } = await supabase.from("_exec").select().limit(0);

      // Supabase doesn't support direct DDL via JS client, use SQL editor approach
      console.log(`   ⚠️ Cannot execute DDL via JS client`);
      failed++;
    } else {
      console.log(`   ✅ Success`);
      success++;
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Successful: ${success}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log(`\n⚠️ Some statements failed. This is expected - Supabase JS client`);
    console.log(`cannot execute DDL (CREATE, DROP, etc.) directly.`);
    console.log(`\nTo apply the full migration:`);
    console.log(`1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql`);
    console.log(`2. Copy and paste the contents of:`);
    console.log(`   supabase/migrations/20251209_sku_normalization.sql`);
    console.log(`3. Click "Run"`);
  }
}

applyMigration().catch(console.error);
