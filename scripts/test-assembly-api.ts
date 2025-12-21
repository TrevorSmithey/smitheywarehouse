/**
 * Test Assembly API vs Excel Data
 *
 * Compares NetSuite API results with Excel file to verify data accuracy
 *
 * Usage: npx tsx scripts/test-assembly-api.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as XLSX from "xlsx";
import * as path from "path";
import { fetchAssemblyBuilds } from "../lib/netsuite";

const EXCEL_PATH = path.join(
  process.env.HOME || "",
  "Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC",
  "Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards",
  "Cookware Assembly Tracking.xlsx"
);

// Test date range
const START_DATE = "2025-12-01";
const END_DATE = "2025-12-05";

interface ExcelRow {
  date: string;
  sku: string;
  quantity: number;
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

async function readExcelData(): Promise<ExcelRow[]> {
  console.log(`\n📊 Reading Excel file: ${EXCEL_PATH}`);

  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets["Raw_Data"];

  if (!sheet) {
    console.error("❌ Raw_Data sheet not found");
    return [];
  }

  const rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const rows: ExcelRow[] = [];

  for (const raw of rawData as Record<string, unknown>[]) {
    const dateStr = parseExcelDate(raw["Date"]);
    const sku = raw["Item"] as string;
    const qty = Number(raw["Quantity"]) || 0;

    if (!dateStr || !sku || qty === 0) continue;
    if (!sku.startsWith("Smith-")) continue;

    // Filter to our date range
    if (dateStr >= START_DATE && dateStr <= END_DATE) {
      rows.push({ date: dateStr, sku, quantity: qty });
    }
  }

  return rows;
}

function aggregateByDateSku(
  rows: Array<{ date: string; sku: string; quantity: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.date}|${row.sku}`;
    map.set(key, (map.get(key) || 0) + row.quantity);
  }
  return map;
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║       ASSEMBLY DATA COMPARISON: Excel vs NetSuite API        ║");
  console.log(`║       Date Range: ${START_DATE} to ${END_DATE}                    ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // 1. Read Excel data
  const excelRows = await readExcelData();
  const excelAgg = aggregateByDateSku(excelRows);
  console.log(`\n✅ Excel: Found ${excelRows.length} raw rows, ${excelAgg.size} aggregated (date|sku) entries`);

  // 2. Fetch from NetSuite API
  console.log(`\n🌐 Calling NetSuite API for assembly builds...`);
  const apiRows = await fetchAssemblyBuilds(START_DATE, END_DATE);
  const apiAgg = aggregateByDateSku(
    apiRows.map((r) => ({
      date: r.trandate,
      sku: r.item_sku,
      quantity: parseInt(r.quantity) || 0,
    }))
  );
  console.log(`✅ API: Found ${apiRows.length} rows, ${apiAgg.size} aggregated entries`);

  // 3. Compare results
  console.log("\n" + "═".repeat(70));
  console.log("COMPARISON BY DATE + SKU");
  console.log("═".repeat(70));

  const allKeys = new Set([...excelAgg.keys(), ...apiAgg.keys()]);
  const sortedKeys = Array.from(allKeys).sort();

  let matchCount = 0;
  let mismatchCount = 0;
  const mismatches: Array<{ key: string; excel: number; api: number }> = [];

  for (const key of sortedKeys) {
    const excelQty = excelAgg.get(key) || 0;
    const apiQty = apiAgg.get(key) || 0;

    if (excelQty === apiQty) {
      matchCount++;
    } else {
      mismatchCount++;
      mismatches.push({ key, excel: excelQty, api: apiQty });
    }
  }

  // Print all data sorted by date
  console.log("\n┌────────────┬──────────────────────────┬─────────┬─────────┬────────┐");
  console.log("│ Date       │ SKU                      │ Excel   │ API     │ Match  │");
  console.log("├────────────┼──────────────────────────┼─────────┼─────────┼────────┤");

  for (const key of sortedKeys) {
    const [date, sku] = key.split("|");
    const excelQty = excelAgg.get(key) || 0;
    const apiQty = apiAgg.get(key) || 0;
    const match = excelQty === apiQty ? "✓" : "✗";
    const skuTrunc = sku.length > 24 ? sku.slice(0, 21) + "..." : sku.padEnd(24);
    console.log(
      `│ ${date} │ ${skuTrunc} │ ${String(excelQty).padStart(7)} │ ${String(apiQty).padStart(7)} │   ${match}    │`
    );
  }

  console.log("└────────────┴──────────────────────────┴─────────┴─────────┴────────┘");

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("SUMMARY");
  console.log("═".repeat(70));
  console.log(`Total entries: ${allKeys.size}`);
  console.log(`Matches: ${matchCount} (${((matchCount / allKeys.size) * 100).toFixed(1)}%)`);
  console.log(`Mismatches: ${mismatchCount}`);

  if (mismatches.length > 0) {
    console.log("\n⚠️  MISMATCHES:");
    for (const m of mismatches) {
      const diff = m.api - m.excel;
      console.log(`   ${m.key}: Excel=${m.excel}, API=${m.api} (diff: ${diff > 0 ? "+" : ""}${diff})`);
    }
  }

  // Daily totals
  console.log("\n" + "═".repeat(70));
  console.log("DAILY TOTALS");
  console.log("═".repeat(70));

  const excelByDate = new Map<string, number>();
  const apiByDate = new Map<string, number>();

  for (const [key, qty] of excelAgg) {
    const date = key.split("|")[0];
    excelByDate.set(date, (excelByDate.get(date) || 0) + qty);
  }
  for (const [key, qty] of apiAgg) {
    const date = key.split("|")[0];
    apiByDate.set(date, (apiByDate.get(date) || 0) + qty);
  }

  console.log("┌────────────┬─────────────┬─────────────┬────────┐");
  console.log("│ Date       │ Excel Total │ API Total   │ Match  │");
  console.log("├────────────┼─────────────┼─────────────┼────────┤");

  const allDates = new Set([...excelByDate.keys(), ...apiByDate.keys()]);
  for (const date of Array.from(allDates).sort()) {
    const excelTotal = excelByDate.get(date) || 0;
    const apiTotal = apiByDate.get(date) || 0;
    const match = excelTotal === apiTotal ? "✓" : "✗";
    console.log(
      `│ ${date} │ ${String(excelTotal).padStart(11)} │ ${String(apiTotal).padStart(11)} │   ${match}    │`
    );
  }
  console.log("└────────────┴─────────────┴─────────────┴────────┘");

  // Grand total
  const excelGrandTotal = Array.from(excelAgg.values()).reduce((a, b) => a + b, 0);
  const apiGrandTotal = Array.from(apiAgg.values()).reduce((a, b) => a + b, 0);
  console.log(`\nGrand Total: Excel=${excelGrandTotal}, API=${apiGrandTotal}`);

  if (matchCount === allKeys.size) {
    console.log("\n✅ SUCCESS: All data matches perfectly!");
  } else {
    console.log("\n⚠️  WARNING: Some data doesn't match. Review mismatches above.");
  }
}

main().catch(console.error);
