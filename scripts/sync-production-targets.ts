/**
 * Sync Production Targets from CSV
 *
 * Parses the production targets CSV and upserts to Supabase production_targets table.
 * The ops manager provides monthly production goals per SKU.
 *
 * CSV Format: sku,month,target
 * - sku: Product SKU (e.g., Smith-CI-Chef10)
 * - month: 1-12 (January = 1)
 * - target: Units to produce this month
 *
 * Usage:
 *   npx tsx scripts/sync-production-targets.ts <csv-file> [--year 2026]
 *   npx tsx scripts/sync-production-targets.ts <csv-file> --dry-run
 *   npx tsx scripts/sync-production-targets.ts <csv-file> --clear-year 2026
 *
 * Examples:
 *   npx tsx scripts/sync-production-targets.ts /path/to/targets.csv --year 2026
 *   npx tsx scripts/sync-production-targets.ts targets.csv --dry-run
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface TargetRow {
  sku: string;
  month: number;
  target: number;
}

interface ParsedTarget {
  year: number;
  month: number;
  sku: string;
  target: number;
}

function parseCSV(content: string): TargetRow[] {
  const lines = content.trim().split("\n");
  const rows: TargetRow[] = [];

  // Skip header row if present
  const startIdx = lines[0].toLowerCase().includes("sku") ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split by comma, handling quoted values
    const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));

    if (parts.length < 3) {
      console.warn(`Skipping malformed row ${i + 1}: ${line}`);
      continue;
    }

    const [sku, monthStr, targetStr] = parts;

    const month = parseInt(monthStr, 10);
    const target = parseInt(targetStr, 10);

    if (!sku) {
      console.warn(`Skipping row ${i + 1}: Missing SKU`);
      continue;
    }

    if (isNaN(month) || month < 1 || month > 12) {
      console.warn(`Skipping row ${i + 1}: Invalid month "${monthStr}"`);
      continue;
    }

    if (isNaN(target) || target < 0) {
      console.warn(`Skipping row ${i + 1}: Invalid target "${targetStr}"`);
      continue;
    }

    rows.push({ sku, month, target });
  }

  return rows;
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const clearYearIdx = args.indexOf("--clear-year");
  const yearIdx = args.indexOf("--year");

  // Find CSV file path (first argument that doesn't start with --)
  const csvPath = args.find((arg) => !arg.startsWith("--"));

  if (!csvPath) {
    console.error("Usage: npx tsx scripts/sync-production-targets.ts <csv-file> [--year 2026] [--dry-run]");
    console.error("");
    console.error("Options:");
    console.error("  --year <YYYY>       Year for the targets (default: current year)");
    console.error("  --dry-run           Preview changes without writing to database");
    console.error("  --clear-year <YYYY> Clear all targets for a specific year before import");
    process.exit(1);
  }

  // Determine year
  let year = new Date().getFullYear();
  if (yearIdx !== -1 && args[yearIdx + 1]) {
    const parsedYear = parseInt(args[yearIdx + 1], 10);
    if (!isNaN(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100) {
      year = parsedYear;
    }
  }

  // Check for clear year option
  let clearYear: number | null = null;
  if (clearYearIdx !== -1 && args[clearYearIdx + 1]) {
    const parsedClearYear = parseInt(args[clearYearIdx + 1], 10);
    if (!isNaN(parsedClearYear) && parsedClearYear >= 2020 && parsedClearYear <= 2100) {
      clearYear = parsedClearYear;
    }
  }

  console.log("=".repeat(60));
  console.log("PRODUCTION TARGETS SYNC");
  console.log("=".repeat(60));
  console.log(`\nCSV file: ${csvPath}`);
  console.log(`Target year: ${year}`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (no database changes)" : "LIVE"}`);
  if (clearYear) {
    console.log(`Clear year: ${clearYear} (all existing targets will be deleted)`);
  }
  console.log("");

  // Read CSV file
  let csvContent: string;
  const resolvedPath = path.isAbsolute(csvPath) ? csvPath : path.resolve(process.cwd(), csvPath);

  try {
    csvContent = fs.readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    console.error(`Failed to read CSV file: ${error}`);
    process.exit(1);
  }

  // Parse CSV
  const rows = parseCSV(csvContent);
  console.log(`Parsed ${rows.length} target rows from CSV`);

  if (rows.length === 0) {
    console.log("No valid rows found. Exiting.");
    return;
  }

  // Transform to full records with year
  const targets: ParsedTarget[] = rows.map((row) => ({
    year,
    month: row.month,
    sku: row.sku,
    target: row.target,
  }));

  // Deduplicate (last value wins for same SKU/month)
  const uniqueMap = new Map<string, ParsedTarget>();
  for (const t of targets) {
    const key = `${t.sku}|${t.month}`;
    uniqueMap.set(key, t);
  }
  const uniqueTargets = Array.from(uniqueMap.values());

  // Summary stats
  const skus = new Set(uniqueTargets.map((t) => t.sku));
  const months = new Set(uniqueTargets.map((t) => t.month));
  const totalUnits = uniqueTargets.reduce((sum, t) => sum + t.target, 0);

  console.log(`\nTarget summary:`);
  console.log(`  Unique SKUs: ${skus.size}`);
  console.log(`  Months covered: ${Array.from(months).sort((a, b) => a - b).join(", ")}`);
  console.log(`  Total target entries: ${uniqueTargets.length}`);
  console.log(`  Total units to produce: ${totalUnits.toLocaleString()}`);

  // Show sample
  console.log(`\nSample entries (first 10):`);
  uniqueTargets.slice(0, 10).forEach((t) => {
    const monthName = new Date(2000, t.month - 1, 1).toLocaleString("en-US", { month: "short" });
    console.log(`  ${t.sku} | ${monthName} ${t.year} | ${t.target.toLocaleString()} units`);
  });

  if (isDryRun) {
    console.log("\n[DRY RUN] Would upsert these entries to production_targets table");
    console.log("[DRY RUN] No database changes made");
    return;
  }

  // Clear existing data for the year if requested
  if (clearYear) {
    console.log(`\nClearing all targets for year ${clearYear}...`);
    const { error: deleteError, count } = await supabase
      .from("production_targets")
      .delete()
      .eq("year", clearYear)
      .select("*", { count: "exact", head: true });

    if (deleteError) {
      console.error(`Error clearing year ${clearYear}: ${deleteError.message}`);
    } else {
      console.log(`  Cleared ${count || 0} existing entries for ${clearYear}`);
    }
  }

  // Insert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;
  let errors = 0;

  console.log(`\nUpserting ${uniqueTargets.length} targets in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < uniqueTargets.length; i += BATCH_SIZE) {
    const batch = uniqueTargets.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from("production_targets").upsert(
      batch.map((t) => ({
        year: t.year,
        month: t.month,
        sku: t.sku,
        target: t.target,
      })),
      { onConflict: "year,month,sku" }
    );

    if (error) {
      console.error(`Batch error at ${i}: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`\r  Upserted: ${inserted} / ${uniqueTargets.length}`);
    }
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log("SYNC COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Upserted: ${inserted}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Year: ${year}`);
  console.log(`  SKUs: ${skus.size}`);

  // Verify by querying
  const { data: sample, error: sampleError } = await supabase
    .from("production_targets")
    .select("year, month, sku, target")
    .eq("year", year)
    .order("month", { ascending: true })
    .limit(5);

  if (sampleError) {
    console.error(`\nError verifying: ${sampleError.message}`);
  } else {
    console.log(`\nVerification sample (from database):`);
    sample?.forEach((t) => {
      const monthName = new Date(2000, t.month - 1, 1).toLocaleString("en-US", { month: "short" });
      console.log(`  ${t.sku} | ${monthName} ${t.year} | ${t.target.toLocaleString()} units`);
    });
  }
}

main().catch(console.error);
