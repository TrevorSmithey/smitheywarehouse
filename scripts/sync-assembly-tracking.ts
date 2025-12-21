/**
 * @deprecated This script is DEPRECATED as of December 2025.
 *
 * Assembly data now syncs directly from NetSuite via:
 *   /api/cron/sync-netsuite-assembly
 *
 * The cron endpoint pulls Assembly Build transactions from NetSuite,
 * eliminating the need for manual Excel exports.
 *
 * To backfill: curl -H "Authorization: Bearer $CRON_SECRET" \
 *   "https://smitheywarehouse.vercel.app/api/cron/sync-netsuite-assembly?full=true"
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OLD DESCRIPTION (for reference):
 * Sync Assembly Tracking data from Excel to Supabase
 * Reads the Cookware Assembly Tracking Excel and upserts to assembly tables
 *
 * Usage:
 *   npm run sync-assembly      # Sync from OneDrive Excel
 */

console.error("⚠️  DEPRECATED: This script has been replaced by NetSuite sync.");
console.error("   Use the API endpoint instead: /api/cron/sync-netsuite-assembly");
console.error("   For full backfill: add ?full=true");
process.exit(1);

/* DEPRECATED CODE BELOW - kept for reference */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Excel file path (OneDrive synced)
const EXCEL_PATH = path.join(
  process.env.HOME || "",
  "Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC",
  "Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards",
  "Cookware Assembly Tracking.xlsx"
);

// Delay in seconds before reading Excel (allows OneDrive to finish syncing)
const STARTUP_DELAY_SECONDS = 5;

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

interface DailyRow {
  date: string;
  daily_total: number;
  day_of_week: string | null;
  week_num: number | null;
  month: number | null;
  year: number | null;
}

interface TargetRow {
  sku: string;
  current_inventory: number;
  demand: number;
  current_shortage: number;
  original_plan: number;
  revised_plan: number;
  assembled_since_cutoff: number;
  deficit: number;
  category: string;
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  return null;
}

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === "" || value === "-") return 0;
  const num = Number(value);
  return isNaN(num) ? 0 : Math.round(num);
}

function parseString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function getCategory(sku: string): string {
  if (sku.includes("-CI-")) return "cast_iron";
  if (sku.includes("-CS-")) return "carbon_steel";
  return "other";
}

interface SkuDailyRow {
  date: string;
  sku: string;
  quantity: number;
}

async function syncSkuDailyData(workbook: XLSX.WorkBook): Promise<number> {
  console.log("\n--- Syncing SKU Daily Production ---");

  const sheet = workbook.Sheets["Raw_Data"];
  if (!sheet) {
    console.error("Raw_Data sheet not found");
    return 0;
  }

  const rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const rows: SkuDailyRow[] = [];

  for (const raw of rawData as Record<string, unknown>[]) {
    // Raw_Data has columns: Date, Item, Quantity
    const date = parseExcelDate(raw["Date"]);
    const sku = parseString(raw["Item"]);
    const qty = parseNumber(raw["Quantity"]);

    // Skip invalid rows
    if (!date || !sku || qty === 0) continue;
    // Only Smith- SKUs
    if (!sku.startsWith("Smith-")) continue;

    rows.push({ date, sku, quantity: qty });
  }

  console.log(`Found ${rows.length} SKU daily records`);

  if (rows.length > 0) {
    // Batch upsert in chunks of 500
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase.from("assembly_sku_daily").upsert(chunk, {
        onConflict: "date,sku",
        ignoreDuplicates: false,
      });

      if (error) {
        console.error("SKU daily upsert error:", error);
        return 0;
      }
    }
  }

  return rows.length;
}

async function syncDailyData(workbook: XLSX.WorkBook): Promise<number> {
  console.log("\n--- Syncing Daily Aggregation ---");

  const sheet = workbook.Sheets["Daily_Aggregation"];
  if (!sheet) {
    console.error("Daily_Aggregation sheet not found");
    return 0;
  }

  const rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const rows: DailyRow[] = [];

  for (const raw of rawData as Record<string, unknown>[]) {
    const date = parseExcelDate(raw["Date"]);
    const dailyTotal = parseNumber(raw["Daily Total"]);

    // Skip rows with no date or no production
    if (!date || dailyTotal === 0) continue;

    rows.push({
      date,
      daily_total: dailyTotal,
      day_of_week: parseString(raw["Day of Week"]),
      week_num: parseNumber(raw["Week Num"]) || null,
      month: parseNumber(raw["Month"]) || null,
      year: parseNumber(raw["Year"]) || null,
    });
  }

  console.log(`Found ${rows.length} days with production data`);

  if (rows.length > 0) {
    const { error } = await supabase.from("assembly_daily").upsert(rows, {
      onConflict: "date",
      ignoreDuplicates: false,
    });

    if (error) {
      console.error("Daily upsert error:", error);
      return 0;
    }
  }

  return rows.length;
}

async function syncTargetData(workbook: XLSX.WorkBook): Promise<number> {
  console.log("\n--- Syncing Manufacturing Targets ---");

  const sheet = workbook.Sheets["Revised Manufacturing Targets"];
  if (!sheet) {
    console.error("Revised Manufacturing Targets sheet not found");
    return 0;
  }

  // Read as array of arrays to handle the non-standard format
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
  const rows: TargetRow[] = [];

  // SKU data starts at row 19 (index 18) and goes until row 45 (index 44)
  // Totals are at row 46 (index 45) and 47 (index 46)
  for (let i = 18; i <= 44; i++) {
    const row = rawData[i];
    if (!row || !row[0]) continue;

    const sku = String(row[0]);
    // Skip total rows
    if (sku.toLowerCase().includes("total")) continue;
    // Only process Smith- SKUs
    if (!sku.startsWith("Smith-")) continue;

    rows.push({
      sku,
      current_inventory: parseNumber(row[1]),
      demand: parseNumber(row[2]),
      current_shortage: parseNumber(row[3]),
      original_plan: parseNumber(row[4]),
      revised_plan: parseNumber(row[5]),
      assembled_since_cutoff: parseNumber(row[9]),
      deficit: parseNumber(row[11]),
      category: getCategory(sku),
    });
  }

  console.log(`Found ${rows.length} SKUs with target data`);

  if (rows.length > 0) {
    const { error } = await supabase.from("assembly_targets").upsert(rows, {
      onConflict: "sku",
      ignoreDuplicates: false,
    });

    if (error) {
      console.error("Targets upsert error:", error);
      return 0;
    }
  }

  // Also extract and save config values
  const configUpdates: { key: string; value: string }[] = [];

  // Row 12 (index 11) has Manufacturing Cutoff date
  if (rawData[11] && rawData[11][1]) {
    const cutoff = parseExcelDate(rawData[11][1]);
    if (cutoff) {
      configUpdates.push({ key: "manufacturing_cutoff", value: cutoff });
    }
  }

  // Row 6 (index 5) has Revised Manufacturing Need
  if (rawData[5] && rawData[5][1]) {
    configUpdates.push({ key: "revised_manufacturing_need", value: String(parseNumber(rawData[5][1])) });
  }

  // Row 9 (index 8) has Assembled Since 10.21
  if (rawData[8] && rawData[8][1]) {
    configUpdates.push({ key: "assembled_since_cutoff", value: String(parseNumber(rawData[8][1])) });
  }

  for (const cfg of configUpdates) {
    await supabase.from("assembly_config").upsert(cfg, { onConflict: "key" });
  }

  return rows.length;
}

async function main() {
  console.log("Assembly Tracking Sync");
  console.log("======================\n");

  // Wait for OneDrive to finish syncing
  console.log(`Waiting ${STARTUP_DELAY_SECONDS}s for OneDrive sync...`);
  await sleep(STARTUP_DELAY_SECONDS);

  // Check if file exists
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error("Excel file not found:", EXCEL_PATH);
    console.error("Make sure OneDrive is synced.");
    process.exit(1);
  }

  console.log("Reading Excel file...");
  const workbook = XLSX.readFile(EXCEL_PATH);
  console.log("Sheets:", workbook.SheetNames);

  const dailyCount = await syncDailyData(workbook);
  const targetCount = await syncTargetData(workbook);
  const skuDailyCount = await syncSkuDailyData(workbook);

  // Get summary stats
  const { data: latestDaily } = await supabase
    .from("assembly_daily")
    .select("*")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  const { data: targetTotals } = await supabase
    .from("assembly_targets")
    .select("deficit, assembled_since_cutoff, revised_plan")
    .returns<{ deficit: number; assembled_since_cutoff: number; revised_plan: number }[]>();

  if (latestDaily) {
    console.log("\n--- Summary ---");
    console.log(`Latest production: ${latestDaily.date} - ${latestDaily.daily_total.toLocaleString()} units`);
  }

  if (targetTotals) {
    const totalDeficit = targetTotals.reduce((sum, t) => sum + (t.deficit > 0 ? t.deficit : 0), 0);
    const totalAssembled = targetTotals.reduce((sum, t) => sum + t.assembled_since_cutoff, 0);
    const totalPlan = targetTotals.reduce((sum, t) => sum + t.revised_plan, 0);

    console.log(`Total Remaining to Produce: ${totalDeficit.toLocaleString()}`);
    console.log(`Total Assembled (since cutoff): ${totalAssembled.toLocaleString()}`);
    console.log(`Progress: ${((totalAssembled / totalPlan) * 100).toFixed(1)}%`);
  }

  console.log("\n✅ Assembly tracking sync complete!");
  console.log(`   ${dailyCount} daily records`);
  console.log(`   ${targetCount} SKU targets`);
  console.log(`   ${skuDailyCount} SKU daily records`);
}

main().catch(console.error);
