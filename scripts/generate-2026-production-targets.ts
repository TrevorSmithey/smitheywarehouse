/**
 * Generate 2026 Production Targets
 *
 * Queries the 2026 sales budget from the budgets table and creates
 * level-loaded production targets across Jan-Oct (10 months).
 *
 * Production ends Nov 10, 2026 - so we compress 12 months of sales
 * into 10 months of production to build inventory for peak season.
 *
 * Usage:
 *   npx tsx scripts/generate-2026-production-targets.ts
 *   npx tsx scripts/generate-2026-production-targets.ts --dry-run
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

// We'll dynamically find all Cast Iron (Smith-CI-*) and Carbon Steel (Smith-CS-*)
// SKUs from the budget table instead of hardcoding
// This ensures we always match what's in the actual data

// Production months: January through October (10 months)
const PRODUCTION_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const YEAR = 2026;

// Buffer for defects and safety stock (7% = 2% defects + 5% buffer)
const BUFFER_PERCENT = 0.07;

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  console.log("=".repeat(70));
  console.log("2026 PRODUCTION TARGETS GENERATOR");
  console.log("=".repeat(70));
  console.log(`Mode: ${isDryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Year: ${YEAR}`);
  console.log(`Production months: Jan-Oct (${PRODUCTION_MONTHS.length} months)`);
  console.log(`Buffer: ${(BUFFER_PERCENT * 100).toFixed(0)}% (defects + safety)`);
  console.log("");

  // Fetch 2026 budget from the budgets table
  // The table structure is: sku, year, month, budget, channel
  console.log("Fetching 2026 budget from database...");

  // Get ALL budget data for 2026, then filter to production SKUs (CI and CS)
  const { data: allBudgetData, error: budgetError } = await supabase
    .from("budgets")
    .select("sku, month, budget")
    .eq("year", YEAR)
    .eq("channel", "total");

  if (budgetError) {
    console.error(`Error fetching budget: ${budgetError.message}`);
    process.exit(1);
  }

  if (!allBudgetData || allBudgetData.length === 0) {
    console.error("No 2026 budget data found");
    process.exit(1);
  }

  // Filter to only Cast Iron (Smith-CI-*) and Carbon Steel (Smith-CS-*) products
  // These are the products we manufacture - accessories (Smith-AC-*) are purchased
  const budgetData = allBudgetData.filter(row =>
    row.sku.startsWith("Smith-CI-") || row.sku.startsWith("Smith-CS-")
  );

  console.log(`Found ${allBudgetData.length} total budget entries`);
  console.log(`Filtered to ${budgetData.length} production SKU entries (CI + CS)\n`);

  // Aggregate by SKU (sum all 12 months)
  const skuTotals: Record<string, number> = {};
  for (const row of budgetData) {
    if (!skuTotals[row.sku]) {
      skuTotals[row.sku] = 0;
    }
    skuTotals[row.sku] += row.budget || 0;
  }

  // Calculate production targets
  const targets: Array<{ year: number; month: number; sku: string; target: number }> = [];

  console.log("SKU Production Schedule:");
  console.log("-".repeat(70));
  console.log("SKU                          | Annual Budget | w/ Buffer | Per Month");
  console.log("-".repeat(70));

  let totalAnnualBudget = 0;
  let totalWithBuffer = 0;
  let totalPerMonth = 0;

  // Sort SKUs for consistent output
  const sortedSkus = Object.keys(skuTotals).sort();

  for (const sku of sortedSkus) {
    const annualBudget = skuTotals[sku];

    if (annualBudget === 0) continue;

    // Add buffer for defects and safety stock
    const withBuffer = Math.ceil(annualBudget * (1 + BUFFER_PERCENT));

    // Level-load across 10 production months
    const perMonth = Math.ceil(withBuffer / PRODUCTION_MONTHS.length);

    // Create target entries for each production month
    for (const month of PRODUCTION_MONTHS) {
      targets.push({
        year: YEAR,
        month,
        sku,
        target: perMonth,
      });
    }

    totalAnnualBudget += annualBudget;
    totalWithBuffer += withBuffer;
    totalPerMonth += perMonth;

    console.log(
      `${sku.padEnd(28)} | ${annualBudget.toLocaleString().padStart(13)} | ${withBuffer.toLocaleString().padStart(9)} | ${perMonth.toLocaleString().padStart(9)}`
    );
  }

  console.log("-".repeat(70));
  console.log(
    `${"TOTAL".padEnd(28)} | ${totalAnnualBudget.toLocaleString().padStart(13)} | ${totalWithBuffer.toLocaleString().padStart(9)} | ${totalPerMonth.toLocaleString().padStart(9)}`
  );
  console.log("");

  console.log(`\nGenerated ${targets.length} target entries`);
  console.log(`  SKUs: ${new Set(targets.map(t => t.sku)).size}`);
  console.log(`  Months: ${PRODUCTION_MONTHS.length} (Jan-Oct)`);
  console.log(`  Total units (annual with buffer): ${totalWithBuffer.toLocaleString()}`);

  if (isDryRun) {
    console.log("\n[DRY RUN] Sample of what would be inserted:");
    targets.slice(0, 15).forEach(t => {
      const monthName = new Date(2000, t.month - 1, 1).toLocaleString("en-US", { month: "short" });
      console.log(`  ${t.sku} | ${monthName} ${t.year} | ${t.target.toLocaleString()} units`);
    });
    console.log("\n[DRY RUN] No changes made to database");
    return;
  }

  // Clear existing 2026 targets
  console.log("\nClearing existing 2026 production targets...");
  const { error: deleteError } = await supabase
    .from("production_targets")
    .delete()
    .eq("year", YEAR);

  if (deleteError) {
    console.error(`Error clearing existing targets: ${deleteError.message}`);
    process.exit(1);
  }
  console.log("  Cleared existing 2026 targets");

  // Insert new targets in batches
  console.log("\nInserting production targets...");
  const BATCH_SIZE = 50;
  let inserted = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("production_targets")
      .insert(batch);

    if (error) {
      console.error(`Batch error at ${i}: ${error.message}`);
    } else {
      inserted += batch.length;
      process.stdout.write(`\r  Inserted: ${inserted} / ${targets.length}`);
    }
  }

  console.log("\n\n" + "=".repeat(70));
  console.log("COMPLETE");
  console.log("=".repeat(70));
  console.log(`  Inserted ${inserted} production target entries`);
  console.log(`  Year: ${YEAR}`);
  console.log(`  Production period: Jan-Oct`);

  // Verification query
  console.log("\nVerifying (sample from database):");
  const { data: verification } = await supabase
    .from("production_targets")
    .select("*")
    .eq("year", YEAR)
    .order("sku")
    .order("month")
    .limit(10);

  verification?.forEach(t => {
    const monthName = new Date(2000, t.month - 1, 1).toLocaleString("en-US", { month: "short" });
    console.log(`  ${t.sku} | ${monthName} ${t.year} | ${t.target.toLocaleString()} units`);
  });

  // Summary by month
  console.log("\nMonthly production totals:");
  const { data: monthlySums } = await supabase
    .from("production_targets")
    .select("month, target")
    .eq("year", YEAR);

  if (monthlySums) {
    const byMonth: Record<number, number> = {};
    for (const row of monthlySums) {
      byMonth[row.month] = (byMonth[row.month] || 0) + row.target;
    }

    for (const month of PRODUCTION_MONTHS) {
      const monthName = new Date(2000, month - 1, 1).toLocaleString("en-US", { month: "short" });
      console.log(`  ${monthName}: ${(byMonth[month] || 0).toLocaleString()} units`);
    }
  }
}

main().catch(console.error);
