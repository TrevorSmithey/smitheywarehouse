/**
 * Clean up incorrect sample production targets
 * Removes entries that used wrong SKU naming conventions
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

// Incorrect SKUs that were inserted with wrong naming conventions
const incorrectSkus = [
  // Wrong Cast Iron SKUs (used "Trad" instead of "Skil", "Chef8" instead of "Skil8", etc.)
  "Smith-CI-Chef8",       // Should be Smith-CI-Skil8
  "Smith-CI-Trad12",      // Should be Smith-CI-Skil12
  "Smith-CI-Trad10",      // Should be Smith-CI-Skil10
  "Smith-CI-FlatTop",     // Should be Smith-CI-Flat12
  "Smith-CI-Oval",        // Doesn't exist in Smithey nomenclature
  "Smith-CI-Dutch5.5",    // Should be Smith-CI-Dutch5
  "Smith-CI-Dutch3.5",    // Should be Smith-CI-Dutch4

  // Wrong Carbon Steel SKUs
  "Smith-CS-Chef10",      // Doesn't exist
  "Smith-CS-Chef12",      // Doesn't exist
  "Smith-CS-Wok14",       // Should be Smith-CS-WokM
  "Smith-CS-FlatTop",     // Doesn't exist
];

async function cleanupIncorrectTargets() {
  console.log("Cleaning up incorrect sample production targets...");
  console.log(`Deleting ${incorrectSkus.length} incorrect SKU entries...\n`);

  for (const sku of incorrectSkus) {
    const { data, error } = await supabase
      .from("production_targets")
      .delete()
      .ilike("sku", sku)
      .select();

    if (error) {
      console.error(`  Error deleting ${sku}:`, error.message);
    } else if (data && data.length > 0) {
      console.log(`  Deleted ${data.length} entries for: ${sku}`);
    } else {
      console.log(`  No entries found for: ${sku}`);
    }
  }

  console.log("\nCleanup complete!");
}

cleanupIncorrectTargets();
