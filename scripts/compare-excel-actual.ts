import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// User's actual Excel data (cleaned)
const excelData: Record<string, number> = {
  'smith-ci-skil8': 1674,      // 8" Chef
  'smith-ci-chef10': 2117,     // 10" Chef
  'smith-ci-flat10': 391,      // 10" Flattop
  'smith-ci-flat12': 882,      // 12" Flattop
  'smith-ci-skil6': 354,       // 6" Traditional
  'smith-ci-skil10': 2208,     // 10" Traditional
  'smith-ci-skil12': 2976,     // 12" Traditional
  'smith-ci-tradskil14': 546,  // 14" Traditional
  'smith-ci-skil14': 568,      // 14" Dual Handle
  'smith-ci-dskil11': 686,     // 11" Deep Skillet
  'smith-ci-grill12': 163,     // 12" Grill Pan
  'smith-ci-dutch4': 201,      // 3.5 Dutch
  'smith-ci-dutch5': 497,      // 5.5 Dutch
  'smith-ci-dutch7': 491,      // 7.5 Dutch
  'smith-ci-dual6': 267,       // 6" Dual
  'smith-ci-griddle18': 960,   // Double Burner Griddle
  'smith-ci-dual12': 355,      // 12" Dual Handle
  'smith-ci-sauce1': 0,        // Sauce Pan
};

async function compare() {
  console.log("=== COMPARING EXCEL ACTUALS vs SUPABASE ===\n");

  // Get Supabase data
  const decStart = "2025-12-01T05:00:00.000Z";
  const decEnd = "2025-12-10T04:59:59.999Z";

  // Retail
  const { data: retailItems } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", decStart)
    .lte("orders.created_at", decEnd)
    .eq("orders.canceled", false)
    .limit(1000000);

  // B2B
  const { data: b2bItems } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", decStart)
    .lte("fulfilled_at", decEnd)
    .limit(100000);

  // Aggregate
  const supabaseData: Record<string, number> = {};
  for (const item of retailItems || []) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      supabaseData[key] = (supabaseData[key] || 0) + (item.quantity || 0);
    }
  }
  for (const item of b2bItems || []) {
    if (item.sku) {
      const key = item.sku.toLowerCase();
      supabaseData[key] = (supabaseData[key] || 0) + (item.quantity || 0);
    }
  }

  // Display names mapping
  const displayNames: Record<string, string> = {
    'smith-ci-skil8': '8" Chef',
    'smith-ci-chef10': '10" Chef',
    'smith-ci-flat10': '10" Flattop',
    'smith-ci-flat12': '12" Flattop',
    'smith-ci-skil6': '6" Traditional',
    'smith-ci-skil10': '10" Traditional',
    'smith-ci-skil12': '12" Traditional',
    'smith-ci-tradskil14': '14" Traditional',
    'smith-ci-skil14': '14" Dual Handle',
    'smith-ci-dskil11': '11" Deep Skillet',
    'smith-ci-grill12': '12" Grill Pan',
    'smith-ci-dutch4': '3.5 Dutch',
    'smith-ci-dutch5': '5.5 Dutch',
    'smith-ci-dutch7': '7.5 Dutch',
    'smith-ci-dual6': '6" Dual',
    'smith-ci-griddle18': 'Griddle18',
    'smith-ci-dual12': '12" Dual',
    'smith-ci-sauce1': 'Sauce Pan',
  };

  // Compare
  console.log("Product".padEnd(18) + "Excel".padStart(7) + "Supabase".padStart(10) + "Gap".padStart(7));
  console.log("-".repeat(42));

  let excelTotal = 0;
  let supabaseTotal = 0;

  for (const [sku, excelQty] of Object.entries(excelData)) {
    const supabaseQty = supabaseData[sku] || 0;
    const gap = excelQty - supabaseQty;
    const name = displayNames[sku] || sku;
    const gapStr = gap === 0 ? "✓" : (gap > 0 ? `+${gap}` : `${gap}`);

    console.log(
      `${name.padEnd(18)}${String(excelQty).padStart(7)}${String(supabaseQty).padStart(10)}${gapStr.padStart(7)}`
    );

    excelTotal += excelQty;
    supabaseTotal += supabaseQty;
  }

  console.log("-".repeat(42));
  const totalGap = excelTotal - supabaseTotal;
  const totalGapStr = totalGap === 0 ? "✓" : (totalGap > 0 ? `+${totalGap}` : `${totalGap}`);
  console.log(`${"TOTAL".padEnd(18)}${String(excelTotal).padStart(7)}${String(supabaseTotal).padStart(10)}${totalGapStr.padStart(7)}`);

  console.log(`\n>>> Excel Total: ${excelTotal}`);
  console.log(`>>> Supabase Total: ${supabaseTotal}`);
  console.log(`>>> Gap: ${totalGap} (${((totalGap / excelTotal) * 100).toFixed(1)}%)`);
}

compare().catch(console.error);
