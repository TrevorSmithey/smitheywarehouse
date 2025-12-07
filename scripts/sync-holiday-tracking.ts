/**
 * Sync Holiday Tracking data from Excel to Supabase
 * Reads the Holiday 2025 Super Tracker Excel and upserts to holiday_tracking table
 *
 * Usage:
 *   npm run sync-holiday      # Sync from OneDrive Excel
 */

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
  "Holiday 2025 Super Tracker.xlsx"
);

interface HolidayRow {
  day_number: number;
  date_2024: string | null;
  orders_2024: number | null;
  sales_2024: number | null;
  cumulative_orders_2024: number | null;
  cumulative_sales_2024: number | null;
  date_2025: string | null;
  orders_2025: number | null;
  sales_2025: number | null;
  cumulative_orders_2025: number | null;
  cumulative_sales_2025: number | null;
  daily_orders_delta: number | null;
  daily_sales_delta: number | null;
  cumulative_orders_delta: number | null;
  cumulative_sales_delta: number | null;
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "number") {
    // Excel serial date
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  return null;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

async function main() {
  console.log("Holiday Tracking Sync");
  console.log("=====================\n");

  // Check if file exists
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error("Excel file not found:", EXCEL_PATH);
    console.error("Make sure OneDrive is synced.");
    process.exit(1);
  }

  console.log("Reading Excel file...");
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets["Sheet1"];

  if (!sheet) {
    console.error("Sheet1 not found in workbook");
    process.exit(1);
  }

  // Convert to JSON
  const rawData = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`Found ${rawData.length} rows\n`);

  // Transform to our schema
  const rows: HolidayRow[] = [];
  let validRows = 0;

  for (const raw of rawData as Record<string, unknown>[]) {
    const dayNum = parseNumber(raw["Day"]);
    if (!dayNum || dayNum < 1 || dayNum > 92) continue;

    const row: HolidayRow = {
      day_number: dayNum,
      date_2024: parseExcelDate(raw["2024 Date"]),
      orders_2024: parseNumber(raw["2024 Orders"]),
      sales_2024: parseNumber(raw["2024 Total Sales"]),
      cumulative_orders_2024: parseNumber(raw["2024 Cumulative Orders"]),
      cumulative_sales_2024: parseNumber(raw["2024 Cumulative Sales"]),
      date_2025: parseExcelDate(raw["2025 Date"]),
      orders_2025: parseNumber(raw["2025 Orders"]),
      sales_2025: parseNumber(raw["2025 Total Sales"]),
      cumulative_orders_2025: parseNumber(raw["2025 Cumulative Orders"]),
      cumulative_sales_2025: parseNumber(raw["2025 Cumulative Sales"]),
      daily_orders_delta: parseNumber(raw["Daily ∆ Orders"]),
      daily_sales_delta: parseNumber(raw["Daily ∆ Sales"]),
      cumulative_orders_delta: parseNumber(raw["Cumulative ∆ Orders"]),
      cumulative_sales_delta: parseNumber(raw["Cumulative ∆ Sales"]),
    };

    rows.push(row);
    if (row.orders_2025 !== null) validRows++;
  }

  console.log(`Parsed ${rows.length} days (${validRows} with 2025 data)\n`);

  // Upsert to Supabase
  console.log("Upserting to Supabase...");
  const { error } = await supabase.from("holiday_tracking").upsert(rows, {
    onConflict: "day_number",
    ignoreDuplicates: false,
  });

  if (error) {
    console.error("Upsert error:", error);
    process.exit(1);
  }

  // Get summary stats
  const latestWithData = rows.filter((r) => r.orders_2025 !== null).pop();
  if (latestWithData) {
    console.log("\nLatest 2025 Data:");
    console.log(`  Day ${latestWithData.day_number} (${latestWithData.date_2025})`);
    console.log(`  Orders: ${latestWithData.cumulative_orders_2025?.toLocaleString()}`);
    console.log(`  Revenue: $${latestWithData.cumulative_sales_2025?.toLocaleString()}`);

    if (latestWithData.cumulative_orders_delta !== null) {
      const ordersGrowth = (latestWithData.cumulative_orders_delta * 100).toFixed(1);
      const salesGrowth = (latestWithData.cumulative_sales_delta! * 100).toFixed(1);
      console.log(`  YoY Orders Growth: ${ordersGrowth}%`);
      console.log(`  YoY Revenue Growth: ${salesGrowth}%`);
    }
  }

  console.log("\n✅ Holiday tracking sync complete!");
}

main().catch(console.error);
