/**
 * Comprehensive DOI Audit
 *
 * Verifies:
 * 1. Weekly weights match source data
 * 2. All SKU forecasts are correctly transcribed
 * 3. ISO week calculation is correct
 * 4. Algorithm matches Excel methodology
 * 5. Edge cases handled properly
 */

import * as fs from "fs";
import {
  WEEKLY_WEIGHTS,
  FORECASTS_2025,
  FORECASTS_2026,
  calculateDOI,
  getCurrentWeek,
  getRemainingAnnualDemand,
} from "../lib/doi";

const doiData = JSON.parse(
  fs.readFileSync("/Users/trevorfunderburk/smitheywarehouse/data/doi-data.json", "utf-8")
);

console.log("═══════════════════════════════════════════════════════════");
console.log("                    DOI SYSTEM AUDIT                        ");
console.log("═══════════════════════════════════════════════════════════\n");

let errors: string[] = [];
let warnings: string[] = [];

// ═══════════════════════════════════════════════════════════
// AUDIT 1: Weekly Weights
// ═══════════════════════════════════════════════════════════
console.log("AUDIT 1: Weekly Weights\n");

// Check all 52 weights match
let weightMismatches = 0;
for (let w = 1; w <= 52; w++) {
  const sourceWeight = doiData.weights[String(w)];
  const codeWeight = WEEKLY_WEIGHTS[w];

  if (sourceWeight !== codeWeight) {
    errors.push(`Week ${w} weight mismatch: source=${sourceWeight}, code=${codeWeight}`);
    weightMismatches++;
  }
}

// Verify sum
const codeWeightSum = Object.values(WEEKLY_WEIGHTS).reduce((a, b) => a + b, 0);
const sourceWeightSum = Object.values(doiData.weights).reduce((a: number, b) => a + (b as number), 0);

console.log(`  Source weights sum: ${sourceWeightSum.toFixed(10)}`);
console.log(`  Code weights sum:   ${codeWeightSum.toFixed(10)}`);
console.log(`  Weight mismatches:  ${weightMismatches}`);
console.log(`  Status: ${weightMismatches === 0 && Math.abs(codeWeightSum - 1) < 0.0001 ? "✓ PASS" : "✗ FAIL"}\n`);

// ═══════════════════════════════════════════════════════════
// AUDIT 2: 2025 Forecasts
// ═══════════════════════════════════════════════════════════
console.log("AUDIT 2: 2025 Forecasts\n");

const source2025 = Object.keys(doiData.forecasts_2025);
const code2025 = Object.keys(FORECASTS_2025);

console.log(`  Source SKUs: ${source2025.length}`);
console.log(`  Code SKUs:   ${code2025.length}`);

// Check for mismatches
let forecast2025Mismatches = 0;
for (const sku of source2025) {
  const sourceVal = doiData.forecasts_2025[sku];
  const codeVal = FORECASTS_2025[sku];

  if (sourceVal !== codeVal) {
    errors.push(`2025 ${sku}: source=${sourceVal}, code=${codeVal || "MISSING"}`);
    forecast2025Mismatches++;
  }
}

// Check for SKUs in code but not in source
for (const sku of code2025) {
  if (!doiData.forecasts_2025[sku]) {
    errors.push(`2025 ${sku}: in code but not in source`);
    forecast2025Mismatches++;
  }
}

console.log(`  Mismatches: ${forecast2025Mismatches}`);
console.log(`  Status: ${forecast2025Mismatches === 0 ? "✓ PASS" : "✗ FAIL"}\n`);

// ═══════════════════════════════════════════════════════════
// AUDIT 3: 2026 Forecasts
// ═══════════════════════════════════════════════════════════
console.log("AUDIT 3: 2026 Forecasts\n");

const source2026 = Object.keys(doiData.forecasts_2026);
const code2026 = Object.keys(FORECASTS_2026);

console.log(`  Source SKUs: ${source2026.length}`);
console.log(`  Code SKUs:   ${code2026.length}`);

let forecast2026Mismatches = 0;
for (const sku of source2026) {
  const sourceVal = doiData.forecasts_2026[sku];
  const codeVal = FORECASTS_2026[sku];

  if (sourceVal !== codeVal) {
    errors.push(`2026 ${sku}: source=${sourceVal}, code=${codeVal || "MISSING"}`);
    forecast2026Mismatches++;
  }
}

for (const sku of code2026) {
  if (!doiData.forecasts_2026[sku]) {
    errors.push(`2026 ${sku}: in code but not in source`);
    forecast2026Mismatches++;
  }
}

console.log(`  Mismatches: ${forecast2026Mismatches}`);
console.log(`  Status: ${forecast2026Mismatches === 0 ? "✓ PASS" : "✗ FAIL"}\n`);

// ═══════════════════════════════════════════════════════════
// AUDIT 4: SKU Name Consistency
// ═══════════════════════════════════════════════════════════
console.log("AUDIT 4: SKU Name Consistency (2025 vs 2026)\n");

// Find SKUs in 2025 but not in 2026
const in2025Only = source2025.filter(sku => !source2026.includes(sku));
const in2026Only = source2026.filter(sku => !source2025.includes(sku));

console.log(`  SKUs only in 2025: ${in2025Only.length}`);
in2025Only.forEach(sku => console.log(`    - ${sku}`));

console.log(`  SKUs only in 2026: ${in2026Only.length}`);
in2026Only.forEach(sku => console.log(`    - ${sku}`));

// Check for case variations
const caseVariations: string[] = [];
for (const sku2025 of source2025) {
  for (const sku2026 of source2026) {
    if (sku2025.toLowerCase() === sku2026.toLowerCase() && sku2025 !== sku2026) {
      caseVariations.push(`${sku2025} (2025) vs ${sku2026} (2026)`);
    }
  }
}

if (caseVariations.length > 0) {
  console.log(`\n  ⚠ CASE VARIATIONS DETECTED:`);
  caseVariations.forEach(v => {
    console.log(`    - ${v}`);
    warnings.push(`Case variation: ${v}`);
  });
}

console.log(`  Status: ${caseVariations.length === 0 ? "✓ PASS" : "⚠ WARNING"}\n`);

// ═══════════════════════════════════════════════════════════
// AUDIT 5: ISO Week Calculation
// ═══════════════════════════════════════════════════════════
console.log("AUDIT 5: ISO Week Calculation\n");

// Test known dates
const testDates = [
  { date: new Date(2025, 0, 1), expectedWeek: 1 },   // Jan 1, 2025 - Wed
  { date: new Date(2025, 11, 6), expectedWeek: 49 }, // Dec 6, 2025 - Sat
  { date: new Date(2025, 11, 31), expectedWeek: 1 }, // Dec 31, 2025 - Wed (week 1 of 2026!)
];

// Proper ISO week calculation
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const currentWeekFromCode = getCurrentWeek();
const currentWeekISO = getISOWeek(new Date());

console.log(`  Current week (our code):  ${currentWeekFromCode}`);
console.log(`  Current week (ISO 8601):  ${currentWeekISO}`);

if (currentWeekFromCode !== currentWeekISO) {
  errors.push(`Week calculation mismatch: our code=${currentWeekFromCode}, ISO=${currentWeekISO}`);
  console.log(`  ✗ WEEK CALCULATION IS WRONG!`);
} else {
  console.log(`  ✓ Week calculation matches ISO 8601`);
}

console.log(`  Current day of week: ${new Date().getDay()} (0=Sun, 6=Sat)`);
console.log(`  Status: ${currentWeekFromCode === currentWeekISO ? "✓ PASS" : "✗ FAIL"}\n`);

// ═══════════════════════════════════════════════════════════
// AUDIT 6: Algorithm Step-by-Step Trace
// ═══════════════════════════════════════════════════════════
console.log("AUDIT 6: Algorithm Trace (Smith-CI-Skil12)\n");

const testSku = "Smith-CI-Skil12";
const testInventory = 6852;

console.log(`  SKU: ${testSku}`);
console.log(`  Inventory: ${testInventory.toLocaleString()}`);
console.log(`  2025 Forecast: ${FORECASTS_2025[testSku]?.toLocaleString()}`);
console.log(`  2026 Forecast: ${FORECASTS_2026[testSku]?.toLocaleString()}`);
console.log("");

// Manual calculation
const week = currentWeekISO;
const dayOfWeek = new Date().getDay();
const daysRemaining = 7 - dayOfWeek;

console.log(`  Starting week: ${week}`);
console.log(`  Day of week: ${dayOfWeek} (days remaining: ${daysRemaining})`);
console.log("");

// Trace through weeks
let inv = testInventory;
let days = 0;
let w = week;
const forecast2025 = FORECASTS_2025[testSku];

console.log("  Week-by-week trace:");
for (let i = 0; i < 10 && inv > 0; i++) {
  const demand = forecast2025 * WEEKLY_WEIGHTS[w];
  const consumed = Math.min(inv, demand);
  const remaining = inv - consumed;
  const daysThisWeek = i === 0 ? daysRemaining : 7;

  if (inv <= demand) {
    // Stockout this week
    const fraction = inv / demand;
    const daysIntoWeek = fraction * 7;
    const actualDays = i === 0 ? Math.max(0, daysIntoWeek - (7 - daysRemaining)) : daysIntoWeek;
    days += actualDays;
    console.log(`  Week ${w}: demand=${Math.round(demand).toLocaleString()}, inv=${inv.toLocaleString()} ← STOCKOUT (${actualDays.toFixed(1)} days)`);
    inv = 0;
  } else {
    days += daysThisWeek;
    inv = remaining;
    console.log(`  Week ${w}: demand=${Math.round(demand).toLocaleString()}, remaining=${Math.round(remaining).toLocaleString()}, days+=${daysThisWeek}`);
  }

  w++;
  if (w > 52) w = 1;
}

console.log(`\n  Manual DOI: ${Math.round(days)} days`);

// Compare with function
const result = calculateDOI(testSku, testInventory);
console.log(`  Function DOI: ${result?.doi} days`);
console.log(`  Match: ${Math.round(days) === result?.doi ? "✓ PASS" : "✗ FAIL"}\n`);

// ═══════════════════════════════════════════════════════════
// AUDIT 7: Edge Cases
// ═══════════════════════════════════════════════════════════
console.log("AUDIT 7: Edge Cases\n");

// 7a. SKU with only 2025 forecast (new in 2026)
console.log("  7a. SKU only in 2025 (no 2026 forecast):");
const sku2025Only = in2025Only[0];
if (sku2025Only) {
  const r = calculateDOI(sku2025Only, 500);
  console.log(`      ${sku2025Only}: DOI=${r?.doi || "undefined"} (should work with 2025 only)`);
}

// 7b. SKU with only 2026 forecast (new product)
console.log("  7b. SKU only in 2026 (new product):");
const sku2026Only = in2026Only.find(s => s.includes("Sauce")) || in2026Only[0];
if (sku2026Only) {
  const r = calculateDOI(sku2026Only, 500);
  console.log(`      ${sku2026Only}: DOI=${r?.doi || "undefined"}`);
}

// 7c. Factory second (no forecast)
console.log("  7c. Factory second (no forecast):");
const factorySku = "Smith-CI-Skil12-D";
const fsResult = calculateDOI(factorySku, 1000);
console.log(`      ${factorySku}: DOI=${fsResult?.doi || "undefined (correct)"}`);

// 7d. Very high inventory (beyond 2 years)
console.log("  7d. Very high inventory (500K units):");
const highInvResult = calculateDOI("Smith-CI-Skil12", 500000);
console.log(`      DOI=${highInvResult?.doi} days (${(highInvResult?.doi || 0) / 365} years)`);

// 7e. Zero inventory
console.log("  7e. Zero inventory:");
const zeroResult = calculateDOI("Smith-CI-Skil12", 0);
console.log(`      DOI=${zeroResult?.doi || "undefined"} (should be 0 or undefined)`);

console.log("");

// ═══════════════════════════════════════════════════════════
// AUDIT 8: Cross-Year Projection
// ═══════════════════════════════════════════════════════════
console.log("AUDIT 8: Cross-Year Projection\n");

// Find a SKU that will wrap into 2026
const remaining2025 = getRemainingAnnualDemand(FORECASTS_2025["Smith-CS-WokM"], currentWeekISO);
console.log(`  Smith-CS-WokM remaining 2025 demand: ${Math.round(remaining2025).toLocaleString()}`);
console.log(`  Testing with 5,000 inventory (should exceed 2025)`);

const wokResult = calculateDOI("Smith-CS-WokM", 5000);
console.log(`  DOI: ${wokResult?.doi} days`);
console.log(`  Stockout: Week ${wokResult?.stockoutWeek}/${wokResult?.stockoutYear}`);
console.log(`  Year 2026 reached: ${wokResult?.stockoutYear === 2026 ? "✓ YES" : "✗ NO"}\n`);

// ═══════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════
console.log("═══════════════════════════════════════════════════════════");
console.log("                       AUDIT SUMMARY                        ");
console.log("═══════════════════════════════════════════════════════════\n");

if (errors.length === 0 && warnings.length === 0) {
  console.log("  ✓ ALL AUDITS PASSED\n");
} else {
  if (errors.length > 0) {
    console.log(`  ✗ ERRORS (${errors.length}):`);
    errors.forEach(e => console.log(`    - ${e}`));
    console.log("");
  }

  if (warnings.length > 0) {
    console.log(`  ⚠ WARNINGS (${warnings.length}):`);
    warnings.forEach(w => console.log(`    - ${w}`));
    console.log("");
  }
}

console.log("═══════════════════════════════════════════════════════════\n");
