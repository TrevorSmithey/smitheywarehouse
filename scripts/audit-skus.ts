/**
 * Audit SKU matching between products table and forecasts
 */

import { createClient } from "@supabase/supabase-js";
import { FORECASTS_2025, FORECASTS_2026 } from "../lib/doi";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  // Get all SKUs from products table
  const { data: products } = await supabase
    .from("products")
    .select("sku, display_name, category")
    .eq("is_active", true);

  if (!products) {
    console.log("No products found");
    return;
  }

  console.log("=== SKU MATCHING AUDIT ===\n");
  console.log(`Products in database: ${products.length}\n`);

  const forecast2025Skus = new Set(Object.keys(FORECASTS_2025).map(s => s.toLowerCase()));
  const forecast2026Skus = new Set(Object.keys(FORECASTS_2026).map(s => s.toLowerCase()));

  let matched = 0;
  let unmatched: string[] = [];
  let factorySeconds = 0;

  for (const p of products) {
    const lower = p.sku.toLowerCase();
    const has2025 = forecast2025Skus.has(lower);
    const has2026 = forecast2026Skus.has(lower);

    if (p.category === "factory_second") {
      factorySeconds++;
      continue;
    }

    if (has2025 || has2026) {
      matched++;
    } else {
      unmatched.push(`${p.sku} (${p.category})`);
    }
  }

  console.log(`Matched to forecast: ${matched}`);
  console.log(`Factory seconds (no forecast expected): ${factorySeconds}`);
  console.log(`Unmatched (may not have forecast): ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log("\nUnmatched SKUs (these won't show DOI):");
    unmatched.forEach(s => console.log(`  - ${s}`));
  }

  // Check for case mismatches
  console.log("\n=== CASE MISMATCH CHECK ===\n");
  let caseMismatches = 0;
  for (const p of products) {
    const exact2025 = FORECASTS_2025[p.sku];
    const exact2026 = FORECASTS_2026[p.sku];

    if (!exact2025 && forecast2025Skus.has(p.sku.toLowerCase())) {
      console.log(`Case mismatch in 2025: DB has "${p.sku}"`);
      // Find the actual key
      for (const key of Object.keys(FORECASTS_2025)) {
        if (key.toLowerCase() === p.sku.toLowerCase()) {
          console.log(`  -> Forecast has "${key}"`);
        }
      }
      caseMismatches++;
    }
    if (!exact2026 && forecast2026Skus.has(p.sku.toLowerCase())) {
      console.log(`Case mismatch in 2026: DB has "${p.sku}"`);
      for (const key of Object.keys(FORECASTS_2026)) {
        if (key.toLowerCase() === p.sku.toLowerCase()) {
          console.log(`  -> Forecast has "${key}"`);
        }
      }
      caseMismatches++;
    }
  }

  if (caseMismatches === 0) {
    console.log("No case mismatches found - all SKUs match exactly.");
  }

  console.log("\n=== SUMMARY ===\n");
  console.log(`Total products: ${products.length}`);
  console.log(`Factory seconds: ${factorySeconds}`);
  console.log(`Matched to forecast: ${matched}`);
  console.log(`Unmatched: ${unmatched.length}`);
  console.log(`Case mismatches (handled by case-insensitive lookup): ${caseMismatches}`);
}

check().catch(console.error);
