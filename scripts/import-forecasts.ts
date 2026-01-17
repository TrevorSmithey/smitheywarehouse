/**
 * Import Forecast Script
 *
 * Reads 2026 cast iron forecast from Excel and imports to Supabase.
 * Run with: npx tsx scripts/import-forecasts.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Map Excel product names to SKUs
// Excel uses full names like "8" Chef", our system uses SKUs like "Smith-CI-Skil8"
// Note: Some Excel names have trailing spaces - we trim before lookup
const EXCEL_TO_SKU: Record<string, string> = {
  // Cast Iron
  '8" Chef': "Smith-CI-Skil8",
  '10" Chef': "Smith-CI-Chef10",
  '10" Flattop': "Smith-CI-Flat10",
  '12" Flattop': "Smith-CI-Flat12",
  '6" Traditional': "Smith-CI-Skil6",
  '10" Traditional': "Smith-CI-Skil10",
  '12" Traditional': "Smith-CI-Skil12",
  '14" Traditional': "Smith-CI-TradSkil14",
  '14" Dual Handle': "Smith-CI-Skil14",
  '11" Deep Skillet': "Smith-CI-DSkil11",
  '12" Grill Pan': "Smith-CI-Grill12",
  "3.5 Quart Dutch Oven": "Smith-CI-Dutch4",
  "5.5 Quart Dutch Oven": "Smith-CI-Dutch5",
  "7.5 Quart Dutch Oven": "Smith-CI-Dutch7",
  '6" Dual': "Smith-CI-Dual6",
  "NEW Double Burner Griddle": "Smith-CI-Griddle18",
  '12" Dual Handle': "Smith-CI-Dual12",
  // Future products (uncomment when SKU exists)
  // "NEW Sauce Pan": "Smith-CI-SaucePan",

  // Carbon Steel (add file path and mappings when available)
  // "Wok": "Smith-CS-WokM",
  // "Fish Skillet": "Smith-CS-Fish",
  // "Farmhouse Skillet": "Smith-CS-Farm12",
  // etc.
};

interface ForecastRow {
  sku: string;
  month: string; // YYYY-MM format
  forecast_qty: number;
}

async function importForecasts() {
  console.log("Reading forecast Excel...\n");

  const workbook = XLSX.readFile(
    "/Users/trevorfunderburk/Downloads/2026 ci forecast.xlsx"
  );
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  // Row 1 has month headers (dates as Excel serial numbers or strings)
  // Row 2+ has product data
  const monthHeaders = data[1] as (string | number | Date)[];
  const months: string[] = [];

  // Parse month headers (columns 1-12)
  for (let i = 1; i <= 12; i++) {
    const header = monthHeaders[i];
    if (header) {
      // Excel stores dates as numbers or Date objects
      let date: Date;
      if (typeof header === "number") {
        // Excel serial date
        date = new Date((header - 25569) * 86400 * 1000);
      } else if (header instanceof Date) {
        date = header;
      } else {
        date = new Date(header as string);
      }
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      months.push(`${yyyy}-${mm}`);
    }
  }

  console.log("Months found:", months);

  // Parse product rows (row 2+)
  const forecasts: ForecastRow[] = [];
  const unmapped: string[] = [];

  for (let row = 2; row < data.length; row++) {
    const rowData = data[row] as (string | number)[];
    const productName = String(rowData[0] || "").trim();

    if (!productName) continue;

    const sku = EXCEL_TO_SKU[productName];
    if (!sku) {
      if (!unmapped.includes(productName)) {
        unmapped.push(productName);
      }
      continue;
    }

    // Get forecast for each month
    for (let col = 1; col <= 12; col++) {
      const qty = Number(rowData[col]) || 0;
      if (qty > 0 && months[col - 1]) {
        forecasts.push({
          sku,
          month: months[col - 1],
          forecast_qty: Math.round(qty),
        });
      }
    }
  }

  if (unmapped.length > 0) {
    console.log("\nUnmapped products (add to EXCEL_TO_SKU if needed):");
    unmapped.forEach((p) => console.log(`  - "${p}"`));
  }

  console.log(`\nParsed ${forecasts.length} forecast records`);

  // Show sample
  console.log("\nSample forecasts:");
  forecasts.slice(0, 5).forEach((f) => {
    console.log(`  ${f.sku} | ${f.month} | ${f.forecast_qty}`);
  });

  // Upsert to Supabase
  console.log("\nUpserting to forecasts table...");

  const { error } = await supabase
    .from("forecasts")
    .upsert(forecasts, { onConflict: "sku,month" });

  if (error) {
    console.error("Error upserting forecasts:", error);
    return;
  }

  console.log(`\nSuccessfully imported ${forecasts.length} forecasts!`);

  // Show current month forecast summary
  const currentMonth = new Date().toISOString().slice(0, 7);
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 7);

  const currentForecasts = forecasts.filter(
    (f) => f.month === currentMonth || f.month === nextMonth
  );
  if (currentForecasts.length > 0) {
    console.log(`\nForecasts for ${nextMonth}:`);
    currentForecasts
      .filter((f) => f.month === nextMonth)
      .sort((a, b) => b.forecast_qty - a.forecast_qty)
      .forEach((f) => {
        console.log(`  ${f.sku}: ${f.forecast_qty.toLocaleString()}`);
      });
  }
}

importForecasts().catch(console.error);
