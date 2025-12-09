/**
 * Setup forecasts table and migrate data from doi.ts
 *
 * Run with: npx tsx scripts/setup-forecasts-table.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Annual forecasts from doi.ts - migrating to database
const FORECASTS_2025: Record<string, number> = {
  "Smith-AC-Scrub1": 32621,
  "Smith-AC-FGph": 4683,
  "Smith-AC-Sleeve1": 17796,
  "Smith-AC-Sleeve2": 12784,
  "Smith-AC-SpatW1": 11626,
  "Smith-AC-SpatB1": 19177,
  "Smith-AC-PHTLg": 2506,
  "Smith-AC-KeeperW": 2370,
  "Smith-AC-Season": 32900,
  "Smith-AC-CareKit": 8324, // was Smith-AC-Brush
  "Smith-Bottle1": 1381,
  "Smith-AC-Glid10": 8819,
  "Smith-AC-Glid12": 17540,
  "Smith-AC-Glid14": 7859,
  "Smith-AC-CSlid12": 0,
  "Smith-CS-Farm12": 5663,
  "Smith-CS-Deep12": 6382,
  "Smith-CS-RRoastM": 1491,
  "Smith-CS-OvalM": 1785,
  "Smith-CS-WokM": 3538,
  "Smith-CS-Round17N": 1058,
  "Smith-CS-Farm9": 5026,
  "Smith-CS-Fish": 2261,
  "Smith-CI-Skil8": 13694,
  "Smith-CI-Chef10": 10570,
  "Smith-CI-Flat10": 3841,
  "Smith-CI-Flat12": 10760,
  "Smith-CI-Skil6": 5505,
  "Smith-CI-Skil10": 19863,
  "Smith-CI-Skil12": 32096,
  "Smith-CI-TradSkil14": 6577,
  "Smith-CI-Skil14": 8196,
  "Smith-CI-DSkil11": 8196,
  "Smith-CI-Grill12": 3094,
  "Smith-CI-Dutch4": 2987,
  "Smith-CI-Dutch5": 5656,
  "Smith-CI-Dutch7": 4477,
  "Smith-CI-Dual6": 3804,
  "Smith-CI-Griddle18": 7661,
  "Smith-CI-Dual12": 6193,
};

const FORECASTS_2026: Record<string, number> = {
  "Smith-AC-Scrub1": 43446,
  "Smith-AC-FGph": 6273,
  "Smith-AC-Sleeve1": 23728,
  "Smith-AC-Sleeve2": 17069,
  "Smith-AC-SpatW1": 15448,
  "Smith-AC-SpatB1": 25607,
  "Smith-AC-PHTLg": 3330,
  "Smith-AC-KeeperW": 3142,
  "Smith-AC-Season": 44043,
  "Smith-AC-CareKit": 11055, // was Smith-AC-Brush
  "Smith-Bottle1": 1877,
  "Smith-CS-Farm12": 7383,
  "Smith-CS-Deep12": 8411,
  "Smith-CS-RRoastM": 1929,
  "Smith-CS-OvalM": 2269,
  "Smith-CS-WokM": 4581,
  "Smith-CS-Round17N": 1354,
  "Smith-CS-Farm9": 6616,
  "Smith-CS-Fish": 2996,
  "Smith-CI-Skil8": 17996,
  "Smith-CI-Chef10": 13721,
  "Smith-CI-Flat10": 5092,
  "Smith-CI-Flat12": 14059,
  "Smith-CI-Skil6": 7161,
  "Smith-CI-Skil10": 25749,
  "Smith-CI-Skil12": 41841,
  "Smith-CI-TradSkil14": 8689,
  "Smith-CI-Skil14": 10534,
  "Smith-CI-DSkil11": 10534,
  "Smith-CI-Grill12": 4622,
  "Smith-CI-Dutch4": 3805,
  "Smith-CI-Dutch5": 6656,
  "Smith-CI-Dutch7": 5502,
  "Smith-CI-Dual6": 3805,
  "Smith-CI-Griddle18": 15888,
  "Smith-CI-Dual12": 6247,
  "Smith-CI-Sauce1": 974,
  "Smith-AC-CSlid12": 2392,
  "Smith-AC-Glid10": 11604,
  "Smith-AC-Glid12": 23039,
  "Smith-AC-Glid14": 10273,
};

async function main() {
  console.log("Setting up forecasts table...\n");

  // Generate SQL for table creation
  const createTableSQL = `
-- Forecasts table: annual demand forecasts per SKU
-- Used for DOI (Days of Inventory) calculations
CREATE TABLE IF NOT EXISTS forecasts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sku TEXT NOT NULL,
  year INTEGER NOT NULL,
  annual_forecast INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sku, year)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_forecasts_sku ON forecasts(sku);
CREATE INDEX IF NOT EXISTS idx_forecasts_year ON forecasts(year);

-- Update trigger
CREATE OR REPLACE FUNCTION update_forecasts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS forecasts_updated_at ON forecasts;
CREATE TRIGGER forecasts_updated_at
  BEFORE UPDATE ON forecasts
  FOR EACH ROW
  EXECUTE FUNCTION update_forecasts_updated_at();
`;

  console.log("SQL to create table (run this in Supabase SQL Editor):");
  console.log("=".repeat(60));
  console.log(createTableSQL);
  console.log("=".repeat(60));
  console.log("\nAfter running the SQL, press Enter to continue with data migration...");

  // Wait for user input
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  console.log("\nMigrating forecast data...");

  // Prepare data for upsert
  const rows: { sku: string; year: number; annual_forecast: number }[] = [];

  // 2025 forecasts
  for (const [sku, forecast] of Object.entries(FORECASTS_2025)) {
    rows.push({ sku, year: 2025, annual_forecast: forecast });
  }

  // 2026 forecasts
  for (const [sku, forecast] of Object.entries(FORECASTS_2026)) {
    rows.push({ sku, year: 2026, annual_forecast: forecast });
  }

  console.log(`Upserting ${rows.length} forecast rows...`);

  // Upsert in batches
  const batchSize = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from("forecasts")
      .upsert(batch, { onConflict: "sku,year" });

    if (error) {
      console.error(`Error upserting batch ${i / batchSize + 1}:`, error.message);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`\n✅ Migrated ${inserted} forecast rows to Supabase`);

  // Verify
  const { data: verifyData, error: verifyError } = await supabase
    .from("forecasts")
    .select("year, count")
    .select("*");

  if (!verifyError && verifyData) {
    const by2025 = verifyData.filter(r => r.year === 2025).length;
    const by2026 = verifyData.filter(r => r.year === 2026).length;
    console.log(`  - 2025: ${by2025} SKUs`);
    console.log(`  - 2026: ${by2026} SKUs`);
  }

  process.exit(0);
}

main().catch(console.error);
