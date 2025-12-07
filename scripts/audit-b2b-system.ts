/**
 * Full B2B System Audit
 * Verifies data integrity and consistency
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("              B2B SYSTEM AUDIT                              ");
  console.log("═══════════════════════════════════════════════════════════\n");

  // 1. Check Supabase table structure
  console.log("1. SUPABASE TABLE CHECK");
  console.log("─".repeat(50));

  const { data: sampleData, error: sampleError } = await supabase
    .from("b2b_fulfilled")
    .select("*")
    .limit(1);

  if (sampleError) {
    console.log("  ❌ Error accessing b2b_fulfilled:", sampleError.message);
  } else if (sampleData && sampleData.length > 0) {
    console.log("  ✓ Table accessible");
    console.log("  Columns:", Object.keys(sampleData[0]).join(", "));
  }

  // 2. Count records by month
  console.log("\n2. RECORDS BY MONTH (2025)");
  console.log("─".repeat(50));

  const { data: allRecords } = await supabase
    .from("b2b_fulfilled")
    .select("fulfilled_at, quantity")
    .gte("fulfilled_at", "2025-01-01")
    .lt("fulfilled_at", "2026-01-01");

  const monthlyStats: Record<string, { records: number; units: number }> = {};
  for (const r of allRecords || []) {
    const month = r.fulfilled_at.slice(0, 7);
    if (!monthlyStats[month]) {
      monthlyStats[month] = { records: 0, units: 0 };
    }
    monthlyStats[month].records++;
    monthlyStats[month].units += r.quantity;
  }

  const months = Object.keys(monthlyStats).sort();
  console.log("  Month     Records    Units");
  for (const m of months) {
    const s = monthlyStats[m];
    console.log(`  ${m}   ${s.records.toString().padStart(6)}   ${s.units.toLocaleString().padStart(8)}`);
  }

  const totalRecords = Object.values(monthlyStats).reduce((a, b) => a + b.records, 0);
  const totalUnits = Object.values(monthlyStats).reduce((a, b) => a + b.units, 0);
  console.log("  ─".repeat(20));
  console.log(`  TOTAL     ${totalRecords.toString().padStart(6)}   ${totalUnits.toLocaleString().padStart(8)}`);

  // 3. Check for duplicates
  console.log("\n3. DUPLICATE CHECK");
  console.log("─".repeat(50));

  const { data: dupCheck } = await supabase
    .from("b2b_fulfilled")
    .select("order_id, sku, fulfilled_at")
    .gte("fulfilled_at", "2025-12-01");

  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of dupCheck || []) {
    const key = `${r.order_id}|${r.sku}|${r.fulfilled_at}`;
    if (seen.has(key)) {
      dups.push(key);
    }
    seen.add(key);
  }

  if (dups.length === 0) {
    console.log("  ✓ No duplicates found in December data");
  } else {
    console.log(`  ❌ Found ${dups.length} duplicates`);
  }

  // 4. Spot check recent order from Shopify
  console.log("\n4. SHOPIFY SPOT CHECK (Most Recent Order)");
  console.log("─".repeat(50));

  const shopifyUrl = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/orders.json?status=any&limit=1`;
  const shopifyRes = await fetch(shopifyUrl, {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN!,
      "Content-Type": "application/json",
    },
  });
  const shopifyData = await shopifyRes.json();
  const latestOrder = shopifyData.orders?.[0];

  if (latestOrder) {
    console.log(`  Latest Shopify order: ${latestOrder.name}`);
    console.log(`  Created: ${latestOrder.created_at}`);
    console.log(`  Cancelled: ${latestOrder.cancelled_at ? "YES" : "No"}`);
    console.log(`  Line items: ${latestOrder.line_items?.length || 0}`);

    // Check if it's in Supabase
    const { data: inSupabase } = await supabase
      .from("b2b_fulfilled")
      .select("*")
      .eq("order_name", latestOrder.name);

    if (latestOrder.cancelled_at) {
      if (!inSupabase || inSupabase.length === 0) {
        console.log("  ✓ Cancelled order correctly excluded from Supabase");
      } else {
        console.log("  ❌ Cancelled order should NOT be in Supabase");
      }
    } else {
      if (inSupabase && inSupabase.length > 0) {
        console.log(`  ✓ Order exists in Supabase (${inSupabase.length} line items)`);
      } else {
        console.log("  ⚠ Order not yet in Supabase (may need sync)");
      }
    }
  }

  // 5. Check December totals match our audit
  console.log("\n5. DECEMBER AUDIT VERIFICATION");
  console.log("─".repeat(50));

  const { data: decData } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", "2025-12-01")
    .lt("fulfilled_at", "2025-12-08");

  const decTotals: Record<string, number> = {};
  for (const r of decData || []) {
    decTotals[r.sku] = (decTotals[r.sku] || 0) + r.quantity;
  }

  // Expected from our earlier audit (active orders only)
  const expectedTop5 = [
    ["Smith-CI-Skil12", 243],
    ["Smith-CI-Skil8", 188],
    ["Smith-AC-Glid12", 147],
    ["Smith-CI-Skil10", 134],
    ["Smith-AC-Scrub1", 126],
  ];

  let allMatch = true;
  for (const [sku, expected] of expectedTop5) {
    const actual = decTotals[sku as string] || 0;
    const match = actual === expected;
    if (!match) allMatch = false;
    console.log(`  ${sku}: ${actual} ${match ? "✓" : `❌ (expected ${expected})`}`);
  }

  if (allMatch) {
    console.log("\n  ✓ December data matches audit expectations");
  } else {
    console.log("\n  ⚠ Some discrepancies found");
  }

  // 6. Check cron sync endpoint
  console.log("\n6. API ROUTE CHECK");
  console.log("─".repeat(50));
  console.log("  Cron endpoint: /api/cron/sync-b2b");
  console.log("  Sync window: Last 7 days");
  console.log("  Schedule: Verify in vercel.json");

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("                    AUDIT COMPLETE                          ");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
