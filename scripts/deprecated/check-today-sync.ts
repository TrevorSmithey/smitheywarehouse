import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function check() {
  console.log("=== CHECKING TODAY'S SYNC STATUS ===\n");

  const castIronSkus = [
    "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
    "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
    "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
    "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
    "smith-ci-dual12", "smith-ci-sauce1"
  ];

  // Today's orders (Dec 9 EST = Dec 9 5am UTC to Dec 10 5am UTC)
  const todayStart = "2025-12-09T05:00:00.000Z";
  const todayEnd = "2025-12-10T04:59:59.999Z";

  // Yesterday's orders (Dec 8 EST)
  const yesterdayStart = "2025-12-08T05:00:00.000Z";
  const yesterdayEnd = "2025-12-09T04:59:59.999Z";

  // Count today's cast iron
  const { data: todayItems } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", todayStart)
    .lte("orders.created_at", todayEnd)
    .eq("orders.canceled", false)
    .limit(100000);

  let todayCI = 0;
  for (const item of todayItems || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      todayCI += item.quantity || 0;
    }
  }

  // Count yesterday's cast iron
  const { data: yesterdayItems } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", yesterdayStart)
    .lte("orders.created_at", yesterdayEnd)
    .eq("orders.canceled", false)
    .limit(100000);

  let yesterdayCI = 0;
  for (const item of yesterdayItems || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      yesterdayCI += item.quantity || 0;
    }
  }

  console.log(">>> Today (Dec 9 EST) cast iron:", todayCI);
  console.log(">>> Yesterday (Dec 8 EST) cast iron:", yesterdayCI);

  // Check order counts
  const { count: todayOrderCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart)
    .lte("created_at", todayEnd)
    .eq("canceled", false);

  const { count: yesterdayOrderCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", yesterdayStart)
    .lte("created_at", yesterdayEnd)
    .eq("canceled", false);

  console.log("\n>>> Today's order count:", todayOrderCount);
  console.log(">>> Yesterday's order count:", yesterdayOrderCount);

  // Check latest order
  const { data: latestOrder } = await supabase
    .from("orders")
    .select("order_name, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  console.log("\n>>> Latest order in DB:", latestOrder?.[0]);

  // Current time
  const now = new Date();
  console.log(">>> Current time (UTC):", now.toISOString());
  console.log(">>> Current time (EST):", new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "full",
    timeStyle: "long"
  }).format(now));

  // Check if we have orders from the last hour
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const { count: recentOrders } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", oneHourAgo);

  console.log(`\n>>> Orders in last hour: ${recentOrders}`);

  // If we expected ~1500 units/day and only have ~150, we're behind
  const expectedTodayCI = 1500; // rough estimate based on daily avg
  if (todayCI < expectedTodayCI * 0.5) {
    console.log("\n⚠️  WARNING: Today's cast iron count seems low!");
    console.log(`   Expected ~${expectedTodayCI}, got ${todayCI}`);
  }

  // Day by day breakdown
  console.log("\n>>> Cast Iron by day (Dec 1-9):");
  for (let day = 1; day <= 9; day++) {
    const dayStart = new Date(Date.UTC(2025, 11, day, 5, 0, 0)).toISOString();
    const dayEnd = new Date(Date.UTC(2025, 11, day + 1, 4, 59, 59)).toISOString();

    const { data: dayItems } = await supabase
      .from("line_items")
      .select("sku, quantity, orders!inner(created_at, canceled)")
      .gte("orders.created_at", dayStart)
      .lte("orders.created_at", dayEnd)
      .eq("orders.canceled", false)
      .limit(100000);

    let dayCI = 0;
    for (const item of dayItems || []) {
      if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
        dayCI += item.quantity || 0;
      }
    }

    console.log(`  Dec ${day}: ${dayCI} CI`);
  }
}

check().catch(console.error);
