import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function investigate() {
  console.log("=== INVESTIGATING 1,481 UNIT GAP ===\n");

  const decStart = "2025-12-01T05:00:00.000Z";

  // 1. Check date boundaries - what's our first and last order?
  const { data: firstOrder } = await supabase
    .from("orders")
    .select("id, order_name, created_at")
    .eq("canceled", false)
    .gte("created_at", decStart)
    .order("created_at", { ascending: true })
    .limit(1);

  const { data: lastOrder } = await supabase
    .from("orders")
    .select("id, order_name, created_at")
    .eq("canceled", false)
    .order("created_at", { ascending: false })
    .limit(1);

  console.log(">>> First order in Dec range:", firstOrder?.[0]);
  console.log(">>> Last order in DB:", lastOrder?.[0]);

  // 2. Check if we're missing any cast iron SKUs
  console.log("\n>>> All Cast Iron SKUs with quantities in December:");

  const { data: skuBreakdown } = await supabase
    .from("line_items")
    .select(`
      sku,
      quantity,
      orders!inner(created_at, canceled)
    `)
    .gte("orders.created_at", decStart)
    .eq("orders.canceled", false)
    .ilike("sku", "smith-ci-%")
    .limit(1000000);

  const skuTotals = new Map<string, number>();
  for (const item of skuBreakdown || []) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      skuTotals.set(key, (skuTotals.get(key) || 0) + (item.quantity || 0));
    }
  }

  // Sort by quantity
  const sorted = Array.from(skuTotals.entries()).sort((a, b) => b[1] - a[1]);
  let retailTotal = 0;
  for (const [sku, qty] of sorted) {
    console.log(`  ${sku}: ${qty}`);
    retailTotal += qty;
  }
  console.log(`\nRetail Total: ${retailTotal}`);

  // 3. Check B2B breakdown
  console.log("\n>>> B2B Cast Iron SKUs:");
  const { data: b2bBreakdown } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", decStart)
    .ilike("sku", "smith-ci-%")
    .limit(100000);

  const b2bTotals = new Map<string, number>();
  for (const item of b2bBreakdown || []) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      b2bTotals.set(key, (b2bTotals.get(key) || 0) + (item.quantity || 0));
    }
  }

  let b2bTotal = 0;
  for (const [sku, qty] of Array.from(b2bTotals.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sku}: ${qty}`);
    b2bTotal += qty;
  }
  console.log(`\nB2B Total: ${b2bTotal}`);

  console.log("\n>>> GRAND TOTAL:", retailTotal + b2bTotal);
  console.log(">>> User expects:", 15336);
  console.log(">>> Gap:", 15336 - (retailTotal + b2bTotal));

  // 4. Check if there are orders that might have wrong dates
  const { count: novOrders } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("canceled", false)
    .gte("created_at", "2025-11-30T00:00:00.000Z")
    .lt("created_at", decStart);

  console.log("\n>>> Orders from Nov 30 midnight to Dec 1 5am UTC:", novOrders);

  // 5. Count line items in that window
  const { data: novItems } = await supabase
    .from("line_items")
    .select(`
      sku,
      quantity,
      orders!inner(created_at, canceled)
    `)
    .gte("orders.created_at", "2025-11-30T00:00:00.000Z")
    .lt("orders.created_at", decStart)
    .eq("orders.canceled", false)
    .ilike("sku", "smith-ci-%")
    .limit(100000);

  let novCastIron = 0;
  for (const item of novItems || []) {
    novCastIron += item.quantity || 0;
  }
  console.log(">>> Cast iron in that window:", novCastIron);

  // 6. Check total orders in December by day
  console.log("\n>>> Order count by day (EST dates):");
  for (let day = 1; day <= 9; day++) {
    const dayStart = new Date(Date.UTC(2025, 11, day, 5, 0, 0)).toISOString();
    const dayEnd = new Date(Date.UTC(2025, 11, day + 1, 4, 59, 59)).toISOString();

    const { count } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("canceled", false)
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);

    console.log(`  Dec ${day}: ${count} orders`);
  }
}

investigate().catch(console.error);
