/**
 * Sync Bill of Materials from Excel
 *
 * Parses the BOM Excel file and upserts to Supabase bill_of_materials table.
 * Component SKUs match ShipHero inventory exactly (no translation needed).
 *
 * Excel Source: AllBOMReportResults821 (2).xlsx
 * - Sheet: AllBOMReportResults
 * - Columns: Internal ID, Name (finished good), Member Item (component), Member Quantity
 *
 * Usage:
 *   npx ts-node scripts/sync-bom.ts
 *   npx ts-node scripts/sync-bom.ts --dry-run
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as path from "path";

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Default Excel path - can be overridden with command line arg
const DEFAULT_EXCEL_PATH = "/Users/trevorfunderburk/Desktop/AllBOMReportResults821 (2).xlsx";

interface BOMRow {
  finished_good_sku: string;
  component_sku: string;
  quantity_required: number;
}

interface ExcelRow {
  "Internal ID"?: number;
  "Name"?: string;
  "Member Item"?: string;
  "Member Quantity"?: number;
  "Type"?: string;
  "Unit"?: string;
  // Handle various column name formats
  [key: string]: unknown;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const excelPath = process.argv.find(arg => arg.endsWith(".xlsx")) || DEFAULT_EXCEL_PATH;

  console.log("=".repeat(60));
  console.log("BOM SYNC SCRIPT");
  console.log("=".repeat(60));
  console.log(`\nExcel file: ${excelPath}`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (no database changes)" : "LIVE"}`);
  console.log("");

  // Read Excel file
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(excelPath);
  } catch (error) {
    console.error(`Failed to read Excel file: ${error}`);
    process.exit(1);
  }

  // Get the sheet (try common names)
  const sheetNames = workbook.SheetNames;
  console.log(`Available sheets: ${sheetNames.join(", ")}`);

  let sheetName = sheetNames.find(
    (name) =>
      name.toLowerCase().includes("bom") ||
      name.toLowerCase().includes("allbom") ||
      name.toLowerCase().includes("report")
  );

  // Fallback to first sheet if no match
  if (!sheetName) {
    sheetName = sheetNames[0];
  }

  console.log(`Using sheet: ${sheetName}\n`);

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet);

  console.log(`Total rows in Excel: ${rows.length}`);

  // Parse rows into BOM entries
  const bomEntries: BOMRow[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Try to find the right columns (Excel column names can vary)
    const finishedGood =
      row["Name"] ||
      row["name"] ||
      row["Finished Good"] ||
      row["finished_good"] ||
      row["Parent"];

    const component =
      row["Member Item"] ||
      row["member item"] ||
      row["Component"] ||
      row["component"] ||
      row["Member"];

    const quantity =
      row["Member Quantity"] ||
      row["member quantity"] ||
      row["Quantity"] ||
      row["quantity"] ||
      row["Qty"];

    // Validate required fields
    if (!finishedGood || typeof finishedGood !== "string") {
      skipped.push({ row: i + 2, reason: "Missing finished good SKU" });
      continue;
    }

    if (!component || typeof component !== "string") {
      skipped.push({ row: i + 2, reason: "Missing component SKU" });
      continue;
    }

    const qty = typeof quantity === "number" ? quantity : parseFloat(String(quantity));
    if (isNaN(qty) || qty <= 0) {
      skipped.push({ row: i + 2, reason: `Invalid quantity: ${quantity}` });
      continue;
    }

    bomEntries.push({
      finished_good_sku: finishedGood.trim(),
      component_sku: component.trim(),
      quantity_required: qty,
    });
  }

  // Deduplicate (in case of duplicate rows in Excel)
  const uniqueMap = new Map<string, BOMRow>();
  for (const entry of bomEntries) {
    const key = `${entry.finished_good_sku}|${entry.component_sku}`;
    // If duplicate, use the larger quantity (safer assumption)
    const existing = uniqueMap.get(key);
    if (!existing || entry.quantity_required > existing.quantity_required) {
      uniqueMap.set(key, entry);
    }
  }

  const uniqueEntries = Array.from(uniqueMap.values());

  // Summary stats
  const finishedGoods = new Set(uniqueEntries.map((e) => e.finished_good_sku));
  const components = new Set(uniqueEntries.map((e) => e.component_sku));

  console.log(`\nParsed BOM entries:`);
  console.log(`  Total entries: ${uniqueEntries.length}`);
  console.log(`  Unique finished goods: ${finishedGoods.size}`);
  console.log(`  Unique components: ${components.size}`);
  console.log(`  Skipped rows: ${skipped.length}`);

  if (skipped.length > 0 && skipped.length <= 10) {
    console.log(`\nSkipped rows:`);
    skipped.forEach((s) => console.log(`  Row ${s.row}: ${s.reason}`));
  }

  // Sample output
  console.log(`\nSample entries (first 10):`);
  uniqueEntries.slice(0, 10).forEach((e) => {
    console.log(`  ${e.finished_good_sku} → ${e.component_sku} (qty: ${e.quantity_required})`);
  });

  if (isDryRun) {
    console.log("\n[DRY RUN] Would upsert these entries to bill_of_materials table");
    console.log("[DRY RUN] No database changes made");
    return;
  }

  // Clear existing BOM data and insert fresh
  console.log(`\nClearing existing BOM data...`);
  const { error: deleteError } = await supabase
    .from("bill_of_materials")
    .delete()
    .neq("id", 0); // Delete all rows

  if (deleteError) {
    console.error(`Error clearing existing data: ${deleteError.message}`);
    // Continue anyway - upsert should handle it
  }

  // Insert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;
  let errors = 0;

  console.log(`Inserting ${uniqueEntries.length} BOM entries in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < uniqueEntries.length; i += BATCH_SIZE) {
    const batch = uniqueEntries.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from("bill_of_materials").upsert(
      batch.map((e) => ({
        finished_good_sku: e.finished_good_sku,
        component_sku: e.component_sku,
        quantity_required: e.quantity_required,
      })),
      { onConflict: "finished_good_sku,component_sku" }
    );

    if (error) {
      console.error(`Batch error at ${i}: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`\r  Inserted: ${inserted} / ${uniqueEntries.length}`);
    }
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log("SYNC COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Finished goods: ${finishedGoods.size}`);
  console.log(`  Components: ${components.size}`);

  // Verify by querying
  const { data: sample, error: sampleError } = await supabase
    .from("bill_of_materials")
    .select("finished_good_sku, component_sku, quantity_required")
    .limit(5);

  if (sampleError) {
    console.error(`\nError verifying: ${sampleError.message}`);
  } else {
    console.log(`\nVerification sample (from database):`);
    sample?.forEach((b) => {
      console.log(`  ${b.finished_good_sku} → ${b.component_sku} (qty: ${b.quantity_required})`);
    });
  }
}

main().catch(console.error);
