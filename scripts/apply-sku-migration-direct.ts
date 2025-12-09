import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

async function executeSQL(sql: string): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ sql }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { success: false, error: text };
  }

  return { success: true };
}

async function applyMigration() {
  console.log("=== APPLYING SKU NORMALIZATION MIGRATION ===\n");

  // Read the migration file
  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/20251209_sku_normalization.sql"
  );
  const fullSQL = readFileSync(migrationPath, "utf-8");

  // Split by semicolons but preserve statements
  // We need to handle multi-line statements properly
  const statements: string[] = [];
  let current = "";
  let inFunction = false;

  for (const line of fullSQL.split("\n")) {
    const trimmed = line.trim();

    // Track if we're inside a function body
    if (trimmed.includes("$$ LANGUAGE") || trimmed.includes("$$ LANGUAGE")) {
      inFunction = false;
    }
    if (trimmed.includes("AS $$")) {
      inFunction = true;
    }

    current += line + "\n";

    // Statement ends with semicolon outside of function body
    if (trimmed.endsWith(";") && !inFunction) {
      const stmt = current.trim();
      // Skip comment-only blocks
      if (stmt && !stmt.split("\n").every((l) => l.trim().startsWith("--") || !l.trim())) {
        statements.push(stmt);
      }
      current = "";
    }
  }

  console.log(`Found ${statements.length} statements\n`);

  // Execute each statement
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt
      .split("\n")
      .find((l) => l.trim() && !l.trim().startsWith("--"))
      ?.trim()
      .substring(0, 50);

    console.log(`[${i + 1}/${statements.length}] ${preview}...`);

    const result = await executeSQL(stmt);

    if (!result.success) {
      // exec_sql RPC doesn't exist, fall back to direct SQL endpoint
      console.log(`   ⚠️ RPC not available, trying direct...`);

      // Try the Supabase SQL endpoint (management API)
      const mgmtResponse = await fetch(
        `${SUPABASE_URL.replace(".supabase.co", ".supabase.co")}/pg/sql`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ query: stmt }),
        }
      );

      if (!mgmtResponse.ok) {
        console.log(`   ❌ Failed`);
      } else {
        console.log(`   ✅ Success`);
      }
    } else {
      console.log(`   ✅ Success`);
    }
  }

  console.log("\n=== MIGRATION COMPLETE ===");
  console.log("\nIf some statements failed, you may need to run manually in Supabase SQL Editor:");
  console.log("https://supabase.com/dashboard -> SQL Editor -> Paste contents of:");
  console.log("supabase/migrations/20251209_sku_normalization.sql");
}

applyMigration().catch(console.error);
