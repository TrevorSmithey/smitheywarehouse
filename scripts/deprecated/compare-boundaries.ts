import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function compare() {
  console.log("=== COMPARING DATE BOUNDARIES ===\n");

  const castIronSkus = [
    "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
    "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
    "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
    "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
    "smith-ci-dual12", "smith-ci-sauce1"
  ];

  // Scenario 1: Dashboard (EST midnight = Dec 1 5am UTC)
  const estStart = "2025-12-01T05:00:00.000Z";
  const estEnd = "2025-12-10T04:59:59.999Z"; // end of Dec 9 EST

  // Scenario 2: UTC midnight start
  const utcStart = "2025-12-01T00:00:00.000Z";
  const utcEnd = "2025-12-09T23:59:59.999Z";

  // Helper to count cast iron
  async function countCastIron(start: string, end: string) {
    const { data: retailItems } = await supabase
      .from("line_items")
      .select("sku, quantity, orders!inner(created_at, canceled)")
      .gte("orders.created_at", start)
      .lte("orders.created_at", end)
      .eq("orders.canceled", false)
      .limit(1000000);

    let retail = 0;
    for (const item of retailItems || []) {
      if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
        retail += item.quantity || 0;
      }
    }

    const { data: b2bItems } = await supabase
      .from("b2b_fulfilled")
      .select("sku, quantity")
      .gte("fulfilled_at", start)
      .lte("fulfilled_at", end)
      .limit(100000);

    let b2b = 0;
    for (const item of b2bItems || []) {
      if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
        b2b += item.quantity || 0;
      }
    }

    return { retail, b2b, total: retail + b2b };
  }

  console.log(">>> Scenario 1: Dashboard (EST midnight)");
  console.log(`    Start: ${estStart}`);
  console.log(`    End:   ${estEnd}`);
  const est = await countCastIron(estStart, estEnd);
  console.log(`    Retail: ${est.retail}, B2B: ${est.b2b}, Total: ${est.total}`);

  console.log("\n>>> Scenario 2: UTC midnight");
  console.log(`    Start: ${utcStart}`);
  console.log(`    End:   ${utcEnd}`);
  const utc = await countCastIron(utcStart, utcEnd);
  console.log(`    Retail: ${utc.retail}, B2B: ${utc.b2b}, Total: ${utc.total}`);

  // Scenario 3: What if user includes Nov 30 UTC (Nov 30 EST evening)?
  const extendedStart = "2025-11-30T00:00:00.000Z";
  console.log("\n>>> Scenario 3: Include Nov 30 (UTC date)");
  console.log(`    Start: ${extendedStart}`);
  console.log(`    End:   ${utcEnd}`);
  const extended = await countCastIron(extendedStart, utcEnd);
  console.log(`    Retail: ${extended.retail}, B2B: ${extended.b2b}, Total: ${extended.total}`);

  // Scenario 4: What about by fulfillment date instead?
  console.log("\n>>> Scenario 4: Count by FULFILLMENT date (not order date)");
  const { data: fulfilledItems } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(fulfilled_at, canceled)")
    .gte("orders.fulfilled_at", estStart)
    .lte("orders.fulfilled_at", estEnd)
    .eq("orders.canceled", false)
    .limit(1000000);

  let fulfillRetail = 0;
  for (const item of fulfilledItems || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      fulfillRetail += item.quantity || 0;
    }
  }
  console.log(`    By fulfillment date: ${fulfillRetail}`);

  console.log("\n>>> User's Excel: 15,336");
  console.log(`>>> Gap from Scenario 1: ${15336 - est.total}`);
  console.log(`>>> Gap from Scenario 2: ${15336 - utc.total}`);
  console.log(`>>> Gap from Scenario 3: ${15336 - extended.total}`);
}

compare().catch(console.error);
