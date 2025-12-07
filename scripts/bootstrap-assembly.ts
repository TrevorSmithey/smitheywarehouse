/**
 * Bootstrap assembly tracking tables in Supabase
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log("Bootstrapping assembly tracking tables...\n");

  // Create assembly_daily table
  console.log("Creating assembly_daily table...");
  const { error: err1 } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS assembly_daily (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        daily_total INTEGER NOT NULL DEFAULT 0,
        day_of_week TEXT,
        week_num INTEGER,
        month INTEGER,
        year INTEGER,
        synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `,
  });
  if (err1) console.log("  Note:", err1.message);
  else console.log("  Done");

  // Create assembly_targets table
  console.log("Creating assembly_targets table...");
  const { error: err2 } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS assembly_targets (
        id SERIAL PRIMARY KEY,
        sku TEXT NOT NULL UNIQUE,
        current_inventory INTEGER DEFAULT 0,
        demand INTEGER DEFAULT 0,
        current_shortage INTEGER DEFAULT 0,
        original_plan INTEGER DEFAULT 0,
        revised_plan INTEGER DEFAULT 0,
        assembled_since_cutoff INTEGER DEFAULT 0,
        deficit INTEGER DEFAULT 0,
        category TEXT,
        synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `,
  });
  if (err2) console.log("  Note:", err2.message);
  else console.log("  Done");

  // Create assembly_config table
  console.log("Creating assembly_config table...");
  const { error: err3 } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS assembly_config (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `,
  });
  if (err3) console.log("  Note:", err3.message);
  else console.log("  Done");

  // Insert default config
  console.log("Inserting default config...");
  const { error: err4 } = await supabase.from("assembly_config").upsert([
    { key: "manufacturing_cutoff", value: "2025-12-10" },
    { key: "cutoff_start_date", value: "2025-10-21" },
  ], { onConflict: "key" });
  if (err4) console.log("  Note:", err4.message);
  else console.log("  Done");

  // Create indexes
  console.log("Creating indexes...");
  await supabase.rpc("exec_sql", {
    sql: `CREATE INDEX IF NOT EXISTS idx_assembly_daily_date ON assembly_daily(date DESC)`,
  });
  await supabase.rpc("exec_sql", {
    sql: `CREATE INDEX IF NOT EXISTS idx_assembly_targets_sku ON assembly_targets(sku)`,
  });
  await supabase.rpc("exec_sql", {
    sql: `CREATE INDEX IF NOT EXISTS idx_assembly_targets_category ON assembly_targets(category)`,
  });
  console.log("  Done");

  console.log("\n✅ Bootstrap complete!");
}

main().catch(console.error);
