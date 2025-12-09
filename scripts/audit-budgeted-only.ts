/**
 * Audit: Compare RPC vs Fallback for ONLY budgeted SKUs
 * This is what actually matters for the budget report
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function audit() {
  console.log("===========================================");
  console.log("AUDIT: Budgeted SKUs Only (RPC vs Fallback)");
  console.log("===========================================\n");

  // Get all SKUs that have budgets
  const { data: budgetedSkus } = await supabase
    .from("budgets")
    .select("sku")
    .eq("year", 2025)
    .eq("month", 12);

  const budgetSkuSet = new Set((budgetedSkus || []).map(b => b.sku.toLowerCase()));
  console.log(`Budgeted SKUs: ${budgetSkuSet.size}\n`);

  const start = "2025-12-01T05:00:00.000Z";
  const end = "2025-12-09T04:59:59.999Z";

  // RPC
  const { data: rpcData } = await supabase.rpc('get_budget_actuals', {
    p_start_date: start,
    p_end_date: end,
  });

  const rpcBySku = new Map<string, number>();
  for (const row of rpcData || []) {
    rpcBySku.set(row.sku.toLowerCase(), Number(row.total_qty) || 0);
  }

  // Fallback - retail
  const PAGE_SIZE = 50000;
  const retailData: Array<{ sku: string | null; quantity: number }> = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: page } = await supabase
      .from("line_items")
      .select(`sku, quantity, orders!inner(created_at, canceled)`)
      .gte("orders.created_at", start)
      .lte("orders.created_at", end)
      .eq("orders.canceled", false)
      .range(offset, offset + PAGE_SIZE - 1);

    if (page && page.length > 0) {
      retailData.push(...page);
      offset += page.length;
      hasMore = page.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  // Fallback - B2B
  const { data: b2bData } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", start)
    .lte("fulfilled_at", end)
    .limit(1000000);

  const fallbackBySku = new Map<string, number>();
  for (const item of retailData) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      fallbackBySku.set(key, (fallbackBySku.get(key) || 0) + (item.quantity || 0));
    }
  }
  for (const item of b2bData || []) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      fallbackBySku.set(key, (fallbackBySku.get(key) || 0) + (item.quantity || 0));
    }
  }

  // Compare ONLY budgeted SKUs
  console.log(">>> Comparing ONLY budgeted SKUs\n");
  console.log("SKU".padEnd(25) + "RPC".padStart(8) + "Fallback".padStart(10) + "Match".padStart(8));
  console.log("-".repeat(51));

  let matches = 0;
  let mismatches = 0;
  const mismatchDetails: string[] = [];

  for (const sku of Array.from(budgetSkuSet).sort()) {
    const rpcVal = rpcBySku.get(sku) || 0;
    const fallbackVal = fallbackBySku.get(sku) || 0;
    const match = rpcVal === fallbackVal;

    if (match) {
      matches++;
    } else {
      mismatches++;
      mismatchDetails.push(`${sku}: RPC=${rpcVal}, Fallback=${fallbackVal}, Diff=${rpcVal - fallbackVal}`);
    }

    console.log(`${sku.padEnd(25)}${String(rpcVal).padStart(8)}${String(fallbackVal).padStart(10)}${(match ? "✅" : "❌").padStart(8)}`);
  }

  console.log("-".repeat(51));
  console.log(`\n>>> Summary`);
  console.log(`   Matches: ${matches}/${budgetSkuSet.size}`);
  console.log(`   Mismatches: ${mismatches}`);

  if (mismatches > 0) {
    console.log("\n>>> Mismatch Details:");
    for (const d of mismatchDetails) {
      console.log(`   ${d}`);
    }
  } else {
    console.log("\n✅ ALL BUDGETED SKUs MATCH EXACTLY!");
  }
}

audit().catch(console.error);
