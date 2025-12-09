import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// User's actual Excel data (December MTD actuals)
const excelData: Record<string, number> = {
  'smith-ci-skil8': 1674,
  'smith-ci-chef10': 2117,
  'smith-ci-flat10': 391,
  'smith-ci-flat12': 882,
  'smith-ci-skil6': 354,
  'smith-ci-skil10': 2208,
  'smith-ci-skil12': 2976,
  'smith-ci-tradskil14': 546,
  'smith-ci-skil14': 568,
  'smith-ci-dskil11': 686,
  'smith-ci-grill12': 163,
  'smith-ci-dutch4': 201,
  'smith-ci-dutch5': 497,
  'smith-ci-dutch7': 491,
  'smith-ci-dual6': 267,
  'smith-ci-griddle18': 960,
  'smith-ci-dual12': 355,
  'smith-ci-sauce1': 0,
};

const castIronSkus = Object.keys(excelData);

async function verify() {
  console.log("=== VERIFYING UTC BOUNDARY FIX ===\n");

  // OLD boundary (EST midnight = 5am UTC)
  const estStart = "2025-12-01T05:00:00.000Z";
  const estEnd = "2025-12-09T04:59:59.999Z";

  // NEW boundary (UTC midnight)
  const utcStart = "2025-12-01T00:00:00.000Z";
  const utcEnd = "2025-12-09T23:59:59.999Z";

  console.log("Date boundaries:");
  console.log(`  OLD (EST): ${estStart} to ${estEnd}`);
  console.log(`  NEW (UTC): ${utcStart} to ${utcEnd}`);

  // Query with OLD EST boundary
  const { data: estRetail } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", estStart)
    .lte("orders.created_at", estEnd)
    .eq("orders.canceled", false)
    .limit(1000000);

  const { data: estB2B } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", estStart)
    .lte("fulfilled_at", estEnd)
    .limit(100000);

  // Query with NEW UTC boundary
  const { data: utcRetail } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", utcStart)
    .lte("orders.created_at", utcEnd)
    .eq("orders.canceled", false)
    .limit(1000000);

  const { data: utcB2B } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", utcStart)
    .lte("fulfilled_at", utcEnd)
    .limit(100000);

  // Aggregate EST data
  const estData: Record<string, number> = {};
  for (const item of estRetail || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      const key = item.sku.toLowerCase();
      estData[key] = (estData[key] || 0) + (item.quantity || 0);
    }
  }
  for (const item of estB2B || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      const key = item.sku.toLowerCase();
      estData[key] = (estData[key] || 0) + (item.quantity || 0);
    }
  }

  // Aggregate UTC data
  const utcData: Record<string, number> = {};
  for (const item of utcRetail || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      const key = item.sku.toLowerCase();
      utcData[key] = (utcData[key] || 0) + (item.quantity || 0);
    }
  }
  for (const item of utcB2B || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      const key = item.sku.toLowerCase();
      utcData[key] = (utcData[key] || 0) + (item.quantity || 0);
    }
  }

  // Calculate totals
  let estTotal = 0;
  let utcTotal = 0;
  let excelTotal = 0;

  for (const sku of castIronSkus) {
    estTotal += estData[sku] || 0;
    utcTotal += utcData[sku] || 0;
    excelTotal += excelData[sku] || 0;
  }

  console.log("\n>>> CAST IRON TOTALS:");
  console.log(`   Excel (user's data):     ${excelTotal.toLocaleString()}`);
  console.log(`   OLD EST boundary:        ${estTotal.toLocaleString()}  (gap: ${(excelTotal - estTotal).toLocaleString()})`);
  console.log(`   NEW UTC boundary:        ${utcTotal.toLocaleString()}  (gap: ${(excelTotal - utcTotal).toLocaleString()})`);
  console.log(`\n>>> Units gained by fix:    ${(utcTotal - estTotal).toLocaleString()}`);

  // Show recovery by SKU for top 5 affected
  console.log("\n>>> Top SKU gains from UTC fix:");
  const gains: Array<{ sku: string; gain: number }> = [];
  for (const sku of castIronSkus) {
    const gain = (utcData[sku] || 0) - (estData[sku] || 0);
    if (gain > 0) gains.push({ sku, gain });
  }
  gains.sort((a, b) => b.gain - a.gain);
  for (const { sku, gain } of gains.slice(0, 8)) {
    console.log(`   ${sku}: +${gain}`);
  }

  // Verify fix resolves issue
  const remainingGap = excelTotal - utcTotal;
  const pctGap = ((remainingGap / excelTotal) * 100).toFixed(2);

  console.log("\n>>> VERIFICATION:");
  if (Math.abs(remainingGap) <= 50) {
    console.log(`   SUCCESS - Gap reduced to ${remainingGap} units (${pctGap}%)`);
  } else {
    console.log(`   WARNING - Remaining gap: ${remainingGap} units (${pctGap}%)`);
    console.log("   May need further investigation");
  }
}

verify().catch(console.error);
