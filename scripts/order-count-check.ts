import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function check() {
  console.log("=== ORDER COUNT CHECK ===\n");

  // Supabase - using EST boundary (Dec 1 5am UTC)
  const estStart = "2025-12-01T05:00:00.000Z";

  // Supabase - using UTC boundary (Dec 1 midnight UTC)
  const utcStart = "2025-12-01T00:00:00.000Z";

  // EST boundary
  const { count: estTotal } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", estStart);

  const { count: estActive } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", estStart)
    .eq("canceled", false);

  // UTC boundary
  const { count: utcTotal } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", utcStart);

  const { count: utcActive } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", utcStart)
    .eq("canceled", false);

  console.log(">>> SUPABASE (D2C orders table):");
  console.log(`   EST boundary (Dec 1 5am UTC):`);
  console.log(`     Total: ${estTotal}`);
  console.log(`     Active (not cancelled): ${estActive}`);
  console.log(`   UTC boundary (Dec 1 midnight UTC):`);
  console.log(`     Total: ${utcTotal}`);
  console.log(`     Active (not cancelled): ${utcActive}`);

  // B2B fulfilled count
  const { count: b2bEst } = await supabase
    .from("b2b_fulfilled")
    .select("*", { count: "exact", head: true })
    .gte("fulfilled_at", estStart);

  const { count: b2bUtc } = await supabase
    .from("b2b_fulfilled")
    .select("*", { count: "exact", head: true })
    .gte("fulfilled_at", utcStart);

  console.log(`\n>>> SUPABASE (b2b_fulfilled rows):`);
  console.log(`   EST boundary: ${b2bEst}`);
  console.log(`   UTC boundary: ${b2bUtc}`);

  console.log(`\n>>> USER SEES IN SHOPIFY:`);
  console.log(`   D2C: 9,254 orders`);
  console.log(`   B2B: 181 orders`);

  console.log(`\n>>> GAP:`);
  console.log(`   D2C gap (EST): ${9254 - (estActive || 0)}`);
  console.log(`   D2C gap (UTC): ${9254 - (utcActive || 0)}`);
}

check().catch(console.error);
