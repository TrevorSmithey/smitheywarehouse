/**
 * Sync Channel Budgets from CSV
 *
 * Parses the retail/wholesale budget CSV and upserts to Supabase budgets table.
 *
 * CSV Format:
 * - First column: SKU
 * - Columns 2+: Month values (Jan-25, Feb-25, etc.)
 * - "RETAIL" row marks start of retail section
 * - "WHOLESALE" row marks start of wholesale section
 * - Blank cells = 0
 * - Numbers may be quoted with commas: "1,499 "
 *
 * Usage:
 *   npx ts-node scripts/sync-channel-budgets.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Parse CSV line handling quoted fields with commas
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current); // Don't forget the last field

  return result;
}

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse month header like "Jan-25" to { year: 2025, month: 1 }
function parseMonthHeader(header: string): { year: number; month: number } | null {
  const match = header.trim().match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!match) return null;

  const monthNames: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  const monthName = match[1].toLowerCase();
  const yearShort = parseInt(match[2], 10);
  const month = monthNames[monthName];

  if (!month) return null;

  // Assume 20XX for two-digit years
  const year = 2000 + yearShort;

  return { year, month };
}

// Parse number string like "1,499 " or "0 " or "" to number
function parseNumber(value: string): number {
  if (!value || value.trim() === "") return 0;
  // Remove commas and spaces, then parse
  const cleaned = value.replace(/,/g, "").trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

interface BudgetRow {
  sku: string;
  year: number;
  month: number;
  channel: "retail" | "wholesale";
  budget: number;
}

async function main() {
  const csvPath = "/Users/trevorfunderburk/Library/CloudStorage/OneDrive-SmitheyIronwareCompany,LLC/retail wholesale budget backfill.csv";

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  console.log("Reading CSV file...");
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const lines = csvContent.split("\n");

  if (lines.length < 2) {
    console.error("CSV file is empty or has no data rows");
    process.exit(1);
  }

  // Parse header row to get month columns
  const headerRow = parseCSVLine(lines[0]);
  const months: Array<{ year: number; month: number; colIndex: number }> = [];

  for (let i = 1; i < headerRow.length; i++) {
    const parsed = parseMonthHeader(headerRow[i]);
    if (parsed) {
      months.push({ ...parsed, colIndex: i });
    }
  }

  console.log(`Found ${months.length} month columns: ${months.map(m => `${m.month}/${m.year}`).join(", ")}`);

  // Parse data rows
  const budgets: BudgetRow[] = [];
  let currentChannel: "retail" | "wholesale" | null = null;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    const firstCol = cols[0]?.trim().toUpperCase();

    // Check for section markers
    if (firstCol === "RETAIL") {
      currentChannel = "retail";
      console.log(`Line ${lineIndex + 1}: Switching to RETAIL section`);
      continue;
    }
    if (firstCol === "WHOLESALE") {
      currentChannel = "wholesale";
      console.log(`Line ${lineIndex + 1}: Switching to WHOLESALE section`);
      continue;
    }

    // Skip empty rows or rows without a SKU
    if (!firstCol || !currentChannel) continue;

    // This is a data row
    const sku = cols[0].trim(); // Keep original case for SKU

    for (const month of months) {
      const value = cols[month.colIndex] || "";
      const budget = parseNumber(value);

      // Only add non-zero budgets (or all if you want to track zeros)
      budgets.push({
        sku,
        year: month.year,
        month: month.month,
        channel: currentChannel,
        budget,
      });
    }
  }

  console.log(`\nParsed ${budgets.length} budget entries`);

  // Group by channel for summary
  const retailCount = budgets.filter(b => b.channel === "retail").length;
  const wholesaleCount = budgets.filter(b => b.channel === "wholesale").length;
  console.log(`  Retail: ${retailCount} entries`);
  console.log(`  Wholesale: ${wholesaleCount} entries`);

  // Sample output
  console.log("\nSample entries:");
  budgets.slice(0, 5).forEach(b => {
    console.log(`  ${b.sku} | ${b.year}-${b.month.toString().padStart(2, "0")} | ${b.channel} | ${b.budget}`);
  });

  // First, check if channel column exists in budgets table
  console.log("\nChecking budgets table schema...");

  // Try to add channel column (will fail gracefully if exists)
  const { error: alterError } = await supabase.rpc("exec_sql", {
    sql: `ALTER TABLE budgets ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'retail';`
  }).single();

  if (alterError) {
    console.log("Note: Could not add channel column via RPC (may already exist or need manual migration)");
    console.log("Error:", alterError.message);
  }

  // Clear existing budgets for the date range we're importing
  const yearsInData = [...new Set(budgets.map(b => b.year))];
  console.log(`\nClearing existing budgets for years: ${yearsInData.join(", ")}`);

  for (const year of yearsInData) {
    const { error: deleteError } = await supabase
      .from("budgets")
      .delete()
      .eq("year", year);

    if (deleteError) {
      console.error(`Error clearing year ${year}:`, deleteError.message);
    }
  }

  // Upsert budgets in batches
  const BATCH_SIZE = 500;
  let inserted = 0;
  let errors = 0;

  console.log(`\nInserting ${budgets.length} budget entries in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < budgets.length; i += BATCH_SIZE) {
    const batch = budgets.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("budgets")
      .upsert(
        batch.map(b => ({
          sku: b.sku,
          year: b.year,
          month: b.month,
          channel: b.channel,
          budget: b.budget,
        })),
        { onConflict: "sku,year,month,channel" }
      );

    if (error) {
      console.error(`Batch error at ${i}:`, error.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`\r  Inserted: ${inserted} / ${budgets.length}`);
    }
  }

  console.log(`\n\nSync complete!`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Errors: ${errors}`);

  // Verify by querying
  const { data: sample, error: sampleError } = await supabase
    .from("budgets")
    .select("sku, year, month, channel, budget")
    .eq("year", 2025)
    .eq("month", 12)
    .limit(10);

  if (sampleError) {
    console.error("Error verifying:", sampleError.message);
  } else {
    console.log("\nSample Dec 2025 budgets:");
    sample?.forEach(b => {
      console.log(`  ${b.sku} | ${b.channel} | ${b.budget}`);
    });
  }
}

main().catch(console.error);
