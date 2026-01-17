/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function main() {
  // Query information_schema for all tables
  const { data: tables } = await supabase
    .from("information_schema.tables" as any)
    .select("table_name")
    .eq("table_schema", "public");

  console.log("All public tables:");
  const tableNames = (tables || []).map((t: any) => t.table_name).sort();

  // Group by prefix
  const nsTables = tableNames.filter((t: string) => t.startsWith("ns_"));
  const otherTables = tableNames.filter((t: string) => !t.startsWith("ns_"));

  console.log("\nNS tables:");
  for (const t of nsTables) {
    // Get column info
    const { data: sample } = await supabase.from(t).select("*").limit(1);
    const cols = sample?.[0] ? Object.keys(sample[0]) : [];
    console.log(`  ${t}: ${cols.join(", ")}`);
  }

  console.log("\nOther tables (possibly relevant):");
  for (const t of otherTables) {
    if (t.includes("financial") || t.includes("revenue") || t.includes("sales") || t.includes("pl_") || t.includes("income")) {
      const { data: sample } = await supabase.from(t).select("*").limit(1);
      const cols = sample?.[0] ? Object.keys(sample[0]) : [];
      console.log(`  ${t}: ${cols.join(", ")}`);
    }
  }

  console.log("\nAll tables:");
  console.log(tableNames.join(", "));
}

main().catch(console.error);
