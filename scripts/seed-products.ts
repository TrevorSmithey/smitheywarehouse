/**
 * Seed Products Script
 *
 * One-time script to populate the products table from nomenclature data.
 * Run with: npx tsx scripts/seed-products.ts
 *
 * Requires environment variables:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Product data from nomenclature.xlsx
const PRODUCTS = [
  // Cast Iron
  { sku: "Smith-CI-Skil12", display_name: "12Trad", category: "cast_iron" },
  { sku: "Smith-CI-Skil10", display_name: "10Trad", category: "cast_iron" },
  { sku: "Smith-CI-Skil8", display_name: "8Chef", category: "cast_iron" },
  { sku: "Smith-CI-TradSkil14", display_name: "14Trad", category: "cast_iron" },
  { sku: "Smith-CI-Skil14", display_name: "14Dual", category: "cast_iron" },
  { sku: "Smith-CI-Skil6", display_name: "6Trad", category: "cast_iron" },
  { sku: "Smith-CI-Chef10", display_name: "10Chef", category: "cast_iron" },
  { sku: "Smith-CI-DSkil11", display_name: "11Deep", category: "cast_iron" },
  { sku: "Smith-CI-Dual12", display_name: "12Dual", category: "cast_iron" },
  { sku: "Smith-CI-Dual6", display_name: "6Dual", category: "cast_iron" },
  { sku: "Smith-CI-Dutch7", display_name: "7.25 Dutch", category: "cast_iron" },
  { sku: "Smith-CI-Dutch5", display_name: "5.5 Dutch", category: "cast_iron" },
  { sku: "Smith-CI-Dutch4", display_name: "3.5 Dutch", category: "cast_iron" },
  { sku: "Smith-CI-Flat12", display_name: "12Flat", category: "cast_iron" },
  { sku: "Smith-CI-Flat10", display_name: "10Flat", category: "cast_iron" },
  { sku: "Smith-CI-Grill12", display_name: "12Grill", category: "cast_iron" },
  { sku: "Smith-CI-Griddle18", display_name: "Double Burner Griddle", category: "cast_iron" },

  // Carbon Steel
  { sku: "Smith-CS-WokM", display_name: "Wok", category: "carbon_steel" },
  { sku: "Smith-CS-RroastM", display_name: "Round Roaster", category: "carbon_steel" },
  { sku: "Smith-CS-Round17N", display_name: "Paella Pan", category: "carbon_steel" },
  { sku: "Smith-CS-OvalM", display_name: "Oval Roaster", category: "carbon_steel" },
  { sku: "Smith-CS-Farm9", display_name: "Little Farm", category: "carbon_steel" },
  { sku: "Smith-CS-Farm12", display_name: "Farmhouse Skillet", category: "carbon_steel" },
  { sku: "Smith-CS-Deep12", display_name: "Deep Farm", category: "carbon_steel" },
  { sku: "Smith-CS-Fish", display_name: "Fish Skillet", category: "carbon_steel" },

  // Glass Lids
  { sku: "Smith-AC-Glid14", display_name: "14Lid", category: "glass_lid" },
  { sku: "Smith-AC-Glid12", display_name: "12Lid", category: "glass_lid" },
  { sku: "Smith-AC-Glid11", display_name: "11Lid", category: "glass_lid" },
  { sku: "Smith-AC-Glid10", display_name: "10Lid", category: "glass_lid" },

  // Accessories
  { sku: "Smith-Bottle1", display_name: "Bottle Opener", category: "accessory" },
  { sku: "Smith-AC-SpatW1", display_name: "Slotted Spat", category: "accessory" },
  { sku: "Smith-AC-SpatB1", display_name: "Mighty Spat", category: "accessory" },
  { sku: "Smith-AC-Sleeve2", display_name: "Long Sleeve", category: "accessory" },
  { sku: "Smith-AC-Sleeve1", display_name: "Short Sleeve", category: "accessory" },
  { sku: "Smith-AC-Season", display_name: "Seasoning Oil", category: "accessory" },
  { sku: "Smith-AC-Scrub1", display_name: "Chainmail Scrubber", category: "accessory" },
  { sku: "Smith-AC-Puzzle1", display_name: "Puzzle", category: "accessory" },
  { sku: "Smith-AC-PHTLg", display_name: "Suede Potholder", category: "accessory" },
  { sku: "Smith-AC-Ornament1", display_name: "Ornament", category: "accessory" },
  { sku: "Smith-AC-KeeperW", display_name: "Salt Keeper", category: "accessory" },
  { sku: "Smith-AC-FGph", display_name: "Leather Potholder", category: "accessory" },
  { sku: "Smith-AC-CareKit", display_name: "Care Kit", category: "accessory" },

  // Factory Seconds (Demo units)
  { sku: "Smith-CI-Chef10-D", display_name: "10Chef Demo", category: "factory_second" },
  { sku: "Smith-CI-DSkil11-D", display_name: "11Deep Demo", category: "factory_second" },
  { sku: "Smith-CI-Dual12-D", display_name: "12Dual Demo", category: "factory_second" },
  { sku: "Smith-CI-Dual6-D", display_name: "6Dual Demo", category: "factory_second" },
  { sku: "Smith-CI-Dutch4-D", display_name: "3.5 Dutch Demo", category: "factory_second" },
  { sku: "Smith-CI-Dutch5-D", display_name: "5.5 Dutch Demo", category: "factory_second" },
  { sku: "Smith-CI-Dutch7-D", display_name: "7.25 Dutch Demo", category: "factory_second" },
  { sku: "Smith-CI-Flat10-D", display_name: "10Flat Demo", category: "factory_second" },
  { sku: "Smith-CI-Flat12-D", display_name: "12Flat Demo", category: "factory_second" },
  { sku: "Smith-CI-Griddle18-D", display_name: "DBG Demo", category: "factory_second" },
  { sku: "Smith-CI-Grill12-D", display_name: "12Grill Demo", category: "factory_second" },
  { sku: "Smith-CI-Skil10-D", display_name: "10Trad Demo", category: "factory_second" },
  { sku: "Smith-CI-Skil12-D", display_name: "12Trad Demo", category: "factory_second" },
  { sku: "Smith-CI-Skil14-D", display_name: "14Dual Demo", category: "factory_second" },
  { sku: "Smith-CI-Skil6-D", display_name: "6Trad Demo", category: "factory_second" },
  { sku: "Smith-CI-Skil8-D", display_name: "8Chef Demo", category: "factory_second" },
  { sku: "Smith-CI-TradSkil14-D", display_name: "14Trad Demo", category: "factory_second" },
  { sku: "Smith-CS-Deep12-D", display_name: "Deep Farm Demo", category: "factory_second" },
  { sku: "Smith-CS-Farm12-D", display_name: "Farmhouse Demo", category: "factory_second" },
  { sku: "Smith-CS-Farm9-D", display_name: "9Farm Demo", category: "factory_second" },
  { sku: "Smith-CS-OvalM-D", display_name: "Oval Roaster Demo", category: "factory_second" },
  { sku: "Smith-CS-Round17N-D", display_name: "Paella Demo", category: "factory_second" },
  { sku: "Smith-CS-RRoastM-D", display_name: "Round Roaster Demo", category: "factory_second" },
  { sku: "Smith-CS-WokM-D", display_name: "Wok Demo", category: "factory_second" },
];

async function seedProducts() {
  console.log("Starting product seed...");
  console.log(`Seeding ${PRODUCTS.length} products`);

  // Upsert products (insert or update on conflict)
  const { data, error } = await supabase
    .from("products")
    .upsert(
      PRODUCTS.map((p) => ({
        sku: p.sku,
        display_name: p.display_name,
        category: p.category,
        is_active: true,
      })),
      { onConflict: "sku" }
    )
    .select();

  if (error) {
    console.error("Error seeding products:", error);
    process.exit(1);
  }

  console.log(`Successfully seeded ${data?.length || 0} products`);

  // Show summary by category
  const categories = PRODUCTS.reduce(
    (acc, p) => {
      acc[p.category] = (acc[p.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log("\nProducts by category:");
  for (const [category, count] of Object.entries(categories)) {
    console.log(`  ${category}: ${count}`);
  }
}

seedProducts().catch(console.error);
