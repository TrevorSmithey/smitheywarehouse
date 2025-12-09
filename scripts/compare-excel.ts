import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// User's Excel data
const excelData: Record<string, number> = {
  'smith-ci-skil8': 3594,      // 8" Chef
  'smith-ci-chef10': 2651,     // 10" Chef
  'smith-ci-flat10': 1041,     // 10" Flattop
  'smith-ci-flat12': 2763,     // 12" Flattop
  'smith-ci-skil6': 1390,      // 6" Traditional
  'smith-ci-skil10': 4955,     // 10" Traditional
  'smith-ci-skil12': 8178,     // 12" Traditional
  'smith-ci-tradskil14': 1760, // 14" Traditional
  'smith-ci-skil14': 1981,     // 14" Dual Handle
  'smith-ci-dskil11': 1981,    // 11" Deep Skillet
  'smith-ci-grill12': 842,     // 12" Grill Pan
  'smith-ci-dutch4': 743,      // 3.5 Dutch
  'smith-ci-dutch5': 1301,     // 5.5 Dutch
  'smith-ci-dutch7': 1091,     // 7.5 Dutch
  'smith-ci-dual6': 743,       // 6" Dual
  'smith-ci-griddle18': 3198,  // Double Burner Griddle
  'smith-ci-dual12': 1252,     // 12" Dual Handle
  'smith-ci-sauce1': 0,        // Sauce Pan
};

async function compare() {
  console.log("=== COMPARING EXCEL vs SUPABASE ===\n");

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
  console.log("Product".padEnd(20) + "Excel".padStart(8) + "Supabase".padStart(10) + "Gap".padStart(8));
  console.log("-".repeat(46));

  let excelTotal = 0;
  let supabaseTotal = 0;

  for (const [sku, excelQty] of Object.entries(excelData)) {
    const supabaseQty = supabaseData[sku] || 0;
    const gap = excelQty - supabaseQty;
    const name = displayNames[sku] || sku;

    console.log(
      `${name.padEnd(20)}${String(excelQty).padStart(8)}${String(supabaseQty).padStart(10)}${(gap > 0 ? '+' : '') + gap}`.padStart(8)
    );

    excelTotal += excelQty;
    supabaseTotal += supabaseQty;
  }

  console.log("-".repeat(46));
  console.log(`${"TOTAL".padEnd(20)}${String(excelTotal).padStart(8)}${String(supabaseTotal).padStart(10)}${((excelTotal - supabaseTotal) > 0 ? '+' : '') + (excelTotal - supabaseTotal)}`.padStart(8));

  console.log(`\n>>> Excel Total: ${excelTotal}`);
  console.log(`>>> Supabase Total: ${supabaseTotal}`);
  console.log(`>>> Gap: ${excelTotal - supabaseTotal}`);
}

compare().catch(console.error);
