/**
 * Insert sample 2026 production targets for demo purposes
 * Run with: npx tsx scripts/insert-sample-targets.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const sampleTargets = [
  // =======================================
  // December 2025 (current month for testing)
  // =======================================

  // Cast Iron - December 2025 (using actual Smithey SKUs)
  { year: 2025, month: 12, sku: "Smith-CI-Chef10", target: 1000 },      // 10Chef
  { year: 2025, month: 12, sku: "Smith-CI-Skil8", target: 850 },        // 8Chef
  { year: 2025, month: 12, sku: "Smith-CI-Skil12", target: 2000 },      // 12Trad
  { year: 2025, month: 12, sku: "Smith-CI-Skil10", target: 1500 },      // 10Trad
  { year: 2025, month: 12, sku: "Smith-CI-Flat12", target: 700 },       // 12Flat
  { year: 2025, month: 12, sku: "Smith-CI-DSkil11", target: 500 },      // 11Deep
  { year: 2025, month: 12, sku: "Smith-CI-Dutch5", target: 400 },       // 5.5 Dutch
  { year: 2025, month: 12, sku: "Smith-CI-Dutch4", target: 350 },       // 3.5 Dutch

  // Carbon Steel - December 2025 (using actual Smithey SKUs)
  { year: 2025, month: 12, sku: "Smith-CS-Farm12", target: 750 },       // Farmhouse Skillet
  { year: 2025, month: 12, sku: "Smith-CS-WokM", target: 600 },         // Wok
  { year: 2025, month: 12, sku: "Smith-CS-Deep12", target: 400 },       // Deep Farm
  { year: 2025, month: 12, sku: "Smith-CS-OvalM", target: 350 },        // Oval Roaster

  // Glass Lids - December 2025
  { year: 2025, month: 12, sku: "Smith-AC-Glid10", target: 500 },
  { year: 2025, month: 12, sku: "Smith-AC-Glid12", target: 650 },

  // Care Kit - December 2025
  { year: 2025, month: 12, sku: "Smith-AC-CareKit", target: 1200 },

  // =======================================
  // January 2026 (for demo mode preview)
  // =======================================

  // Cast Iron - January 2026 (using actual Smithey SKUs)
  { year: 2026, month: 1, sku: "Smith-CI-Chef10", target: 1200 },       // 10Chef
  { year: 2026, month: 1, sku: "Smith-CI-Skil8", target: 1000 },        // 8Chef
  { year: 2026, month: 1, sku: "Smith-CI-Skil12", target: 2500 },       // 12Trad
  { year: 2026, month: 1, sku: "Smith-CI-Skil10", target: 1800 },       // 10Trad
  { year: 2026, month: 1, sku: "Smith-CI-Flat12", target: 800 },        // 12Flat
  { year: 2026, month: 1, sku: "Smith-CI-DSkil11", target: 600 },       // 11Deep
  { year: 2026, month: 1, sku: "Smith-CI-Dutch5", target: 500 },        // 5.5 Dutch
  { year: 2026, month: 1, sku: "Smith-CI-Dutch4", target: 400 },        // 3.5 Dutch

  // Carbon Steel - January 2026 (using actual Smithey SKUs)
  { year: 2026, month: 1, sku: "Smith-CS-Farm12", target: 900 },        // Farmhouse Skillet
  { year: 2026, month: 1, sku: "Smith-CS-WokM", target: 700 },          // Wok
  { year: 2026, month: 1, sku: "Smith-CS-Deep12", target: 500 },        // Deep Farm
  { year: 2026, month: 1, sku: "Smith-CS-OvalM", target: 400 },         // Oval Roaster

  // Glass Lids - January 2026
  { year: 2026, month: 1, sku: "Smith-AC-Glid10", target: 600 },
  { year: 2026, month: 1, sku: "Smith-AC-Glid12", target: 800 },

  // Care Kit - January 2026
  { year: 2026, month: 1, sku: "Smith-AC-CareKit", target: 1500 },
];

async function insertSampleTargets() {
  console.log("Inserting sample production targets (Dec 2025 + Jan 2026)...");

  const { data, error } = await supabase
    .from("production_targets")
    .upsert(sampleTargets, { onConflict: "year,month,sku" })
    .select();

  if (error) {
    console.error("Error inserting targets:", error);
    process.exit(1);
  }

  console.log(`Successfully inserted ${data.length} production targets`);
  console.log("\nSample targets:");
  data.forEach((t) => {
    console.log(`  ${t.sku}: ${t.target} units for ${t.month}/${t.year}`);
  });
}

insertSampleTargets();
