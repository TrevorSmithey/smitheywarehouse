/**
 * Show Excel Assembly Data for Dec 1-5
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as XLSX from "xlsx";
import * as path from "path";

const EXCEL_PATH = path.join(
  process.env.HOME || "",
  "Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC",
  "Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards",
  "Cookware Assembly Tracking.xlsx"
);

const START_DATE = "2025-12-01";
const END_DATE = "2025-12-05";

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

async function main() {
  console.log(`\n📊 Reading Excel file...`);
  console.log(`Path: ${EXCEL_PATH}`);
  console.log(`Date range: ${START_DATE} to ${END_DATE}\n`);

  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets["Raw_Data"];

  if (!sheet) {
    console.error("❌ Raw_Data sheet not found");
    return;
  }

  const rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });

  // Aggregate by date and sku
  const data = new Map<string, { date: string; sku: string; qty: number }>();

  for (const raw of rawData as Record<string, unknown>[]) {
    const dateStr = parseExcelDate(raw["Date"]);
    const sku = raw["Item"] as string;
    const qty = Number(raw["Quantity"]) || 0;

    if (!dateStr || !sku || qty === 0) continue;
    if (!sku.startsWith("Smith-")) continue;
    if (dateStr < START_DATE || dateStr > END_DATE) continue;

    const key = `${dateStr}|${sku}`;
    const existing = data.get(key);
    if (existing) {
      existing.qty += qty;
    } else {
      data.set(key, { date: dateStr, sku, qty });
    }
  }

  // Sort and display
  const sorted = Array.from(data.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.sku.localeCompare(b.sku);
  });

  console.log("┌────────────┬──────────────────────────┬──────────┐");
  console.log("│ Date       │ SKU                      │ Quantity │");
  console.log("├────────────┼──────────────────────────┼──────────┤");

  let currentDate = "";
  let dateTotal = 0;
  let grandTotal = 0;

  for (const row of sorted) {
    if (currentDate && currentDate !== row.date) {
      console.log(`├────────────┼──────────────────────────┼──────────┤`);
      console.log(`│            │ Day Total                │ ${String(dateTotal).padStart(8)} │`);
      console.log(`├────────────┼──────────────────────────┼──────────┤`);
      dateTotal = 0;
    }
    currentDate = row.date;
    dateTotal += row.qty;
    grandTotal += row.qty;

    const skuTrunc = row.sku.length > 24 ? row.sku.slice(0, 21) + "..." : row.sku.padEnd(24);
    console.log(`│ ${row.date} │ ${skuTrunc} │ ${String(row.qty).padStart(8)} │`);
  }

  // Final day total
  if (dateTotal > 0) {
    console.log(`├────────────┼──────────────────────────┼──────────┤`);
    console.log(`│            │ Day Total                │ ${String(dateTotal).padStart(8)} │`);
  }

  console.log("├────────────┼──────────────────────────┼──────────┤");
  console.log(`│            │ GRAND TOTAL              │ ${String(grandTotal).padStart(8)} │`);
  console.log("└────────────┴──────────────────────────┴──────────┘");

  console.log(`\n📈 Summary:`);
  console.log(`   Total records: ${sorted.length}`);
  console.log(`   Unique SKUs: ${new Set(sorted.map((r) => r.sku)).size}`);
  console.log(`   Total units assembled: ${grandTotal.toLocaleString()}`);
}

main().catch(console.error);
