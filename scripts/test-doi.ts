/**
 * Test DOI Calculation
 *
 * Verify the weekly weights methodology matches Excel expectations.
 * Run with: npx tsx scripts/test-doi.ts
 */

import {
  calculateDOI,
  getCurrentWeek,
  WEEKLY_WEIGHTS,
  FORECASTS_2025,
  FORECASTS_2026,
  getRemainingAnnualDemand,
} from "../lib/doi";

console.log("=== DOI Calculation Verification ===\n");

// 1. Verify weights sum to 1.0
const weightSum = Object.values(WEEKLY_WEIGHTS).reduce((a, b) => a + b, 0);
console.log(`Weekly weights sum: ${weightSum.toFixed(6)} (should be 1.0)`);

// 2. Show current week
const currentWeek = getCurrentWeek();
console.log(`Current ISO week: ${currentWeek}`);

// 3. Show BFCM weights (47, 48)
console.log(`\nBFCM weeks:`);
console.log(`  Week 47: ${(WEEKLY_WEIGHTS[47] * 100).toFixed(2)}%`);
console.log(`  Week 48: ${(WEEKLY_WEIGHTS[48] * 100).toFixed(2)}%`);
console.log(`  Combined: ${((WEEKLY_WEIGHTS[47] + WEEKLY_WEIGHTS[48]) * 100).toFixed(2)}%`);

// 4. Test Smith-CI-Skil12 (12Trad) - sample from conversation
console.log("\n=== Sample Calculation: Smith-CI-Skil12 ===");
const testSku = "Smith-CI-Skil12";
const testInventory = 6852; // From ShipHero data

console.log(`SKU: ${testSku}`);
console.log(`Current Inventory: ${testInventory.toLocaleString()}`);
console.log(`2025 Forecast: ${FORECASTS_2025[testSku]?.toLocaleString() || "N/A"}`);
console.log(`2026 Forecast: ${FORECASTS_2026[testSku]?.toLocaleString() || "N/A"}`);

const result = calculateDOI(testSku, testInventory);
if (result) {
  console.log(`\nDOI Result:`);
  console.log(`  Days to Stockout: ${result.doi}`);
  console.log(`  Stockout Week: ${result.stockoutWeek}`);
  console.log(`  Stockout Year: ${result.stockoutYear}`);
  console.log(`  Weekly Demand at Stockout: ${result.weeklyDemand.toLocaleString()}`);
  console.log(`  Interpolated Days: ${result.interpolatedDays.toFixed(1)}`);
}

// 5. Show remaining 2025 demand
const remaining2025 = getRemainingAnnualDemand(FORECASTS_2025[testSku], currentWeek);
console.log(`\nRemaining 2025 demand (week ${currentWeek}-52): ${Math.round(remaining2025).toLocaleString()}`);
console.log(`Inventory vs Remaining: ${testInventory.toLocaleString()} vs ${Math.round(remaining2025).toLocaleString()}`);

if (testInventory > remaining2025) {
  console.log(">>> Inventory exceeds 2025 remaining - will wrap into 2026 <<<");
}

// 6. Test a few more SKUs
console.log("\n=== Additional SKU Tests ===\n");

const testCases = [
  { sku: "Smith-CI-Skil10", inventory: 3500 },
  { sku: "Smith-CI-Chef10", inventory: 2800 },
  { sku: "Smith-CS-WokM", inventory: 1500 },
  { sku: "Smith-AC-Scrub1", inventory: 8000 },
  { sku: "Smith-AC-Glid12", inventory: 3000 },
];

for (const tc of testCases) {
  const r = calculateDOI(tc.sku, tc.inventory);
  if (r) {
    const status = r.doi < 30 ? "CRITICAL" : r.doi < 60 ? "WATCH" : "OK";
    console.log(`${tc.sku.padEnd(20)} | Inv: ${tc.inventory.toString().padStart(6)} | DOI: ${r.doi.toString().padStart(4)}d | Week ${r.stockoutWeek}/${r.stockoutYear} | ${status}`);
  } else {
    console.log(`${tc.sku.padEnd(20)} | Inv: ${tc.inventory.toString().padStart(6)} | No forecast`);
  }
}

// 7. Test edge case: SKU with no forecast
console.log("\n=== Edge Case: No Forecast ===");
const noForecastResult = calculateDOI("Smith-NONEXISTENT", 1000);
console.log(`Result for nonexistent SKU: ${noForecastResult ? "Got result" : "undefined (correct)"}`);

// 8. Test case sensitivity
console.log("\n=== Case Sensitivity Test ===");
const tradSkil14_2025 = FORECASTS_2025["Smith-CI-Tradskil14"];
const tradSkil14_2026 = FORECASTS_2026["Smith-CI-TradSkil14"];
console.log(`2025 key "Tradskil14": ${tradSkil14_2025?.toLocaleString() || "N/A"}`);
console.log(`2026 key "TradSkil14": ${tradSkil14_2026?.toLocaleString() || "N/A"}`);
const tradResult = calculateDOI("Smith-CI-TradSkil14", 1000);
console.log(`DOI lookup for TradSkil14: ${tradResult?.doi || "No result"}`);

console.log("\n=== Verification Complete ===");
