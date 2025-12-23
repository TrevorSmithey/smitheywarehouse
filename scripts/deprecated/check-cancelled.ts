import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function check() {
  console.log("=== CHECKING CANCELLED ORDERS ===\n");

  const castIronSkus = [
    "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
    "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
    "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
    "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
    "smith-ci-dual12", "smith-ci-sauce1"
  ];

  // Using UTC boundaries (closer to Excel)
  const start = "2025-12-01T00:00:00.000Z";
  const end = "2025-12-09T23:59:59.999Z";

  // Count CANCELLED orders cast iron
  const { data: cancelledItems } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", start)
    .lte("orders.created_at", end)
    .eq("orders.canceled", true)
    .limit(100000);

  let cancelledCI = 0;
  for (const item of cancelledItems || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      cancelledCI += item.quantity || 0;
    }
  }
  console.log(`>>> Cancelled order cast iron (UTC Dec): ${cancelledCI}`);

  // Count ALL orders (including cancelled)
  const { data: allItems } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at)")
    .gte("orders.created_at", start)
    .lte("orders.created_at", end)
    .limit(1000000);

  let allCI = 0;
  for (const item of allItems || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      allCI += item.quantity || 0;
    }
  }
  console.log(`>>> ALL orders cast iron (incl. cancelled): ${allCI}`);
  console.log(`>>> Non-cancelled (allCI - cancelled): ${allCI - cancelledCI}`);

  // Get current timestamp
  const { data: latest } = await supabase
    .from("orders")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  console.log(`\n>>> Latest order timestamp: ${latest?.[0]?.created_at}`);

  // Check total retail for UTC range
  const { data: utcRetail } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", start)
    .lte("orders.created_at", end)
    .eq("orders.canceled", false)
    .limit(1000000);

  let utcCI = 0;
  for (const item of utcRetail || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      utcCI += item.quantity || 0;
    }
  }
  console.log(`>>> UTC range non-cancelled CI: ${utcCI}`);

  // Add B2B
  const { data: b2b } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", start)
    .lte("fulfilled_at", end)
    .limit(100000);

  let b2bCI = 0;
  for (const item of b2b || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      b2bCI += item.quantity || 0;
    }
  }
  console.log(`>>> B2B CI: ${b2bCI}`);
  console.log(`>>> Total (UTC + B2B): ${utcCI + b2bCI}`);
  console.log(`>>> User expects: 15,336`);
  console.log(`>>> Gap: ${15336 - (utcCI + b2bCI)}`);

  // If we INCLUDE cancelled orders
  console.log(`\n>>> If cancelled included: ${allCI + b2bCI}`);
  console.log(`>>> Gap with cancelled: ${15336 - (allCI + b2bCI)}`);
}

check().catch(console.error);
