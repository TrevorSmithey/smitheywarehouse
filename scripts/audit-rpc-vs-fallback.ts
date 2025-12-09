/**
 * Audit script: Compare RPC results vs fallback pagination approach
 * Ensures data integrity between both methods
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
  console.log("AUDIT: RPC vs Fallback Data Comparison");
  console.log("===========================================\n");

  // Use December 2025 MTD as test range
  const start = "2025-12-01T05:00:00.000Z";
  const end = "2025-12-09T04:59:59.999Z";

  console.log(`Date range: ${start} to ${end}\n`);

  // ----- METHOD 1: RPC -----
  console.log(">>> Method 1: RPC Function");
  const rpcStart = Date.now();
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_budget_actuals', {
      p_start_date: start,
      p_end_date: end,
    });

  if (rpcError) {
    console.error(`RPC Error: ${rpcError.message}`);
    return;
  }

  const rpcTime = Date.now() - rpcStart;
  console.log(`   Time: ${rpcTime}ms`);
  console.log(`   Rows: ${rpcData?.length || 0}`);

  // Build RPC map
  const rpcBySku = new Map<string, { retail: number; b2b: number; total: number }>();
  for (const row of rpcData || []) {
    rpcBySku.set(row.sku.toLowerCase(), {
      retail: Number(row.retail_qty) || 0,
      b2b: Number(row.b2b_qty) || 0,
      total: Number(row.total_qty) || 0,
    });
  }

  // ----- METHOD 2: Direct queries (fallback approach) -----
  console.log("\n>>> Method 2: Direct Queries (Fallback)");
  const fallbackStart = Date.now();

  // Query retail sales with pagination
  const PAGE_SIZE = 50000;
  const retailData: Array<{ sku: string | null; quantity: number }> = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: page } = await supabase
      .from("line_items")
      .select(`
        sku,
        quantity,
        orders!inner(created_at, canceled)
      `)
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

  // Query B2B fulfilled
  const { data: b2bData } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", start)
    .lte("fulfilled_at", end)
    .limit(1000000);

  const fallbackTime = Date.now() - fallbackStart;
  console.log(`   Time: ${fallbackTime}ms`);
  console.log(`   Retail rows: ${retailData.length}`);
  console.log(`   B2B rows: ${b2bData?.length || 0}`);

  // Aggregate fallback data
  const fallbackBySku = new Map<string, { retail: number; b2b: number; total: number }>();

  for (const item of retailData) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      const existing = fallbackBySku.get(key) || { retail: 0, b2b: 0, total: 0 };
      existing.retail += item.quantity || 0;
      existing.total += item.quantity || 0;
      fallbackBySku.set(key, existing);
    }
  }

  for (const item of b2bData || []) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      const existing = fallbackBySku.get(key) || { retail: 0, b2b: 0, total: 0 };
      existing.b2b += item.quantity || 0;
      existing.total += item.quantity || 0;
      fallbackBySku.set(key, existing);
    }
  }

  // ----- COMPARE -----
  console.log("\n>>> Comparison Results");
  console.log("=".repeat(80));

  const allSkus = new Set([...rpcBySku.keys(), ...fallbackBySku.keys()]);
  let mismatches = 0;
  const mismatchDetails: string[] = [];

  for (const sku of Array.from(allSkus).sort()) {
    const rpc = rpcBySku.get(sku) || { retail: 0, b2b: 0, total: 0 };
    const fallback = fallbackBySku.get(sku) || { retail: 0, b2b: 0, total: 0 };

    if (rpc.retail !== fallback.retail || rpc.b2b !== fallback.b2b || rpc.total !== fallback.total) {
      mismatches++;
      mismatchDetails.push(
        `${sku}: RPC(r=${rpc.retail}, b=${rpc.b2b}, t=${rpc.total}) vs Fallback(r=${fallback.retail}, b=${fallback.b2b}, t=${fallback.total})`
      );
    }
  }

  if (mismatches === 0) {
    console.log("\n✅ ALL DATA MATCHES! No discrepancies found.");
  } else {
    console.log(`\n❌ MISMATCHES FOUND: ${mismatches}`);
    console.log("\nDetails:");
    for (const detail of mismatchDetails.slice(0, 20)) {
      console.log(`   ${detail}`);
    }
    if (mismatchDetails.length > 20) {
      console.log(`   ... and ${mismatchDetails.length - 20} more`);
    }
  }

  // Summary totals
  let rpcRetailTotal = 0, rpcB2bTotal = 0, rpcTotal = 0;
  let fallbackRetailTotal = 0, fallbackB2bTotal = 0, fallbackTotal = 0;

  for (const v of rpcBySku.values()) {
    rpcRetailTotal += v.retail;
    rpcB2bTotal += v.b2b;
    rpcTotal += v.total;
  }

  for (const v of fallbackBySku.values()) {
    fallbackRetailTotal += v.retail;
    fallbackB2bTotal += v.b2b;
    fallbackTotal += v.total;
  }

  console.log("\n>>> Totals Comparison");
  console.log(`   RPC:      Retail=${rpcRetailTotal}, B2B=${rpcB2bTotal}, Total=${rpcTotal}`);
  console.log(`   Fallback: Retail=${fallbackRetailTotal}, B2B=${fallbackB2bTotal}, Total=${fallbackTotal}`);
  console.log(`   Diff:     Retail=${rpcRetailTotal - fallbackRetailTotal}, B2B=${rpcB2bTotal - fallbackB2bTotal}, Total=${rpcTotal - fallbackTotal}`);

  console.log("\n>>> Performance");
  console.log(`   RPC:      ${rpcTime}ms`);
  console.log(`   Fallback: ${fallbackTime}ms`);
  console.log(`   Speedup:  ${(fallbackTime / rpcTime).toFixed(1)}x faster`);
}

audit().catch(console.error);
