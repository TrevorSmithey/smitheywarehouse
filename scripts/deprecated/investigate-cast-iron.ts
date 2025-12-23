import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function investigate() {
  // Current dashboard date range (MTD December 2025)
  const start = "2025-12-01T05:00:00.000Z";
  const end = "2025-12-09T04:59:59.999Z";

  console.log("=== DATA INVESTIGATION ===");
  console.log("Dashboard date range:", start, "to", end);

  // Get cast iron SKUs
  const castIronSkus = [
    "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
    "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
    "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
    "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
    "smith-ci-dual12", "smith-ci-sauce1"
  ];

  // 1. Check via RPC
  console.log("\n>>> RPC Results by SKU:");
  const { data: rpcData } = await supabase.rpc("get_budget_actuals", {
    p_start_date: start,
    p_end_date: end,
  });

  let rpcCastIron = 0;
  for (const row of rpcData || []) {
    if (castIronSkus.includes(row.sku?.toLowerCase())) {
      rpcCastIron += Number(row.total_qty) || 0;
      console.log(`  ${row.sku}: ${row.total_qty} (retail: ${row.retail_qty}, b2b: ${row.b2b_qty})`);
    }
  }
  console.log(`\n>>> RPC Cast Iron Total: ${rpcCastIron}`);

  // 2. Check sync status
  const { data: lastSync } = await supabase
    .from("sync_log")
    .select("synced_at, sync_type")
    .order("synced_at", { ascending: false })
    .limit(5);
  console.log("\n>>> Last Syncs:");
  for (const s of lastSync || []) {
    console.log(`  ${s.sync_type}: ${s.synced_at}`);
  }

  // 3. Check latest orders
  const { data: latestOrders } = await supabase
    .from("orders")
    .select("id, order_name, created_at")
    .eq("canceled", false)
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("\n>>> Latest Orders in DB:");
  for (const o of latestOrders || []) {
    console.log(`  ${o.order_name}: ${o.created_at}`);
  }

  // 4. Count total orders in date range
  const { count: orderCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("canceled", false)
    .gte("created_at", start)
    .lte("created_at", end);
  console.log(`\n>>> Total Orders in Range: ${orderCount}`);

  // 5. Check if there are recent orders we're missing
  const now = new Date();
  const { data: recentOrders } = await supabase
    .from("orders")
    .select("id, order_name, created_at")
    .eq("canceled", false)
    .gte("created_at", "2025-12-08T00:00:00.000Z")
    .order("created_at", { ascending: false });
  console.log(`\n>>> Orders from Dec 8-9: ${recentOrders?.length || 0}`);

  // 6. Check B2B separately
  const { data: b2bData } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", start)
    .lte("fulfilled_at", end);

  let b2bCastIron = 0;
  for (const item of b2bData || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      b2bCastIron += item.quantity || 0;
    }
  }
  console.log(`\n>>> B2B Cast Iron Total: ${b2bCastIron}`);

  // 7. Check when last B2B sync happened
  const { data: lastB2BSync } = await supabase
    .from("sync_log")
    .select("synced_at, sync_type, details")
    .eq("sync_type", "b2b")
    .order("synced_at", { ascending: false })
    .limit(1);
  console.log("\n>>> Last B2B Sync:");
  console.log(lastB2BSync);
}

investigate().catch(console.error);
