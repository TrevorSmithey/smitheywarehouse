import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function audit() {
  console.log("=== SUPABASE TABLES AUDIT ===\n");

  const knownTables = [
    "products",
    "warehouses",
    "inventory",
    "inventory_history",
    "b2b_fulfilled",
    "daily_fulfillments",
    "fulfillment_summary",
    "tracking_events",
    "orders",
    "order_items",
    "sku_mapping",
    "customers",
    "shipments",
    "sync_logs",
    "settings",
    "retail_fulfilled",
  ];

  console.log("TABLE                  | ROWS      | STATUS");
  console.log("-----------------------|-----------|--------");

  const foundTables: string[] = [];

  for (const table of knownTables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });

      if (!error && count !== null) {
        foundTables.push(table);
        console.log(
          `${table.padEnd(22)} | ${count.toLocaleString().padStart(9)} | OK`
        );
      }
    } catch {
      // Table doesn't exist
    }
  }

  console.log("\n=== DATA VERIFICATION ===\n");

  // Products
  const { count: productCount } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true });
  console.log(`Products: ${productCount}`);

  // Categories breakdown
  const { data: categoryData } = await supabase
    .from("products")
    .select("category");

  const categories: Record<string, number> = {};
  for (const row of categoryData || []) {
    categories[row.category] = (categories[row.category] || 0) + 1;
  }
  console.log("  By category:");
  for (const [cat, count] of Object.entries(categories).sort()) {
    console.log(`    ${cat}: ${count}`);
  }

  // Inventory by warehouse
  const { data: invByWarehouse } = await supabase
    .from("inventory")
    .select("warehouse_id, on_hand");

  const warehouseTotals: Record<number, number> = {};
  for (const row of invByWarehouse || []) {
    warehouseTotals[row.warehouse_id] =
      (warehouseTotals[row.warehouse_id] || 0) + row.on_hand;
  }

  console.log("\nInventory totals by warehouse:");
  const warehouseNames: Record<number, string> = {
    120758: "Pipefitter",
    77373: "Hobson",
    93742: "Selery",
  };
  let grandTotal = 0;
  for (const [id, total] of Object.entries(warehouseTotals)) {
    console.log(
      `  ${warehouseNames[Number(id)] || id}: ${total.toLocaleString()}`
    );
    grandTotal += total;
  }
  console.log(`  TOTAL: ${grandTotal.toLocaleString()}`);

  // Inventory sync timestamp
  const { data: invLatest } = await supabase
    .from("inventory")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1);

  if (invLatest?.[0]) {
    console.log(
      `\nInventory last synced: ${new Date(invLatest[0].synced_at).toLocaleString("en-US", { timeZone: "America/New_York" })}`
    );
  }

  // B2B totals
  const { data: b2bData, count: b2bCount } = await supabase
    .from("b2b_fulfilled")
    .select("quantity", { count: "exact" });

  const b2bTotal = (b2bData || []).reduce((sum, r) => sum + r.quantity, 0);
  console.log(`\nB2B Fulfilled:`);
  console.log(`  Records: ${b2bCount?.toLocaleString()}`);
  console.log(`  Units: ${b2bTotal.toLocaleString()}`);

  // B2B date range
  const { data: b2bEarliest } = await supabase
    .from("b2b_fulfilled")
    .select("fulfilled_at")
    .order("fulfilled_at", { ascending: true })
    .limit(1);

  const { data: b2bLatest } = await supabase
    .from("b2b_fulfilled")
    .select("fulfilled_at")
    .order("fulfilled_at", { ascending: false })
    .limit(1);

  console.log(
    `  Date range: ${b2bEarliest?.[0]?.fulfilled_at?.split("T")[0]} to ${b2bLatest?.[0]?.fulfilled_at?.split("T")[0]}`
  );

  // Inventory history
  const { count: historyCount } = await supabase
    .from("inventory_history")
    .select("*", { count: "exact", head: true });

  const { data: historyDates } = await supabase
    .from("inventory_history")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1);

  const { data: historyDatesEarliest } = await supabase
    .from("inventory_history")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: true })
    .limit(1);

  console.log(`\nInventory History:`);
  console.log(`  Records: ${historyCount?.toLocaleString()}`);
  console.log(
    `  Date range: ${historyDatesEarliest?.[0]?.snapshot_date} to ${historyDates?.[0]?.snapshot_date}`
  );

  console.log("\n=== ENVIRONMENT VARIABLES REQUIRED ===\n");
  console.log("For this app to work, Vercel needs:\n");

  const envVars = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", present: !!process.env.NEXT_PUBLIC_SUPABASE_URL },
    { name: "SUPABASE_SERVICE_KEY", present: !!process.env.SUPABASE_SERVICE_KEY },
    { name: "SHIPHERO_API_TOKEN", present: !!process.env.SHIPHERO_API_TOKEN },
    { name: "SHOPIFY_B2B_STORE_URL", present: !!process.env.SHOPIFY_B2B_STORE_URL },
    { name: "SHOPIFY_B2B_ADMIN_TOKEN", present: !!process.env.SHOPIFY_B2B_ADMIN_TOKEN },
    { name: "CRON_SECRET", present: !!process.env.CRON_SECRET },
  ];

  for (const v of envVars) {
    console.log(`  ${v.present ? "OK" : "MISSING"} ${v.name}`);
  }

  console.log("\n(Checked from .env.local - verify these are also in Vercel dashboard)");
}

audit();
