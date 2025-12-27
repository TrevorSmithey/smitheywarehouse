/**
 * Backfill B2B Annual Sales Tracking
 *
 * One-time script to aggregate ns_wholesale_transactions by day
 * and insert into annual_sales_tracking with channel='b2b'
 *
 * Run with: npx tsx scripts/backfill-b2b-annual-sales.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// D2C customer ID in NetSuite to exclude from B2B metrics
const D2C_CUSTOMER_ID = 2501;

interface TransactionRow {
  tran_date: string;
  foreign_total: number;
}

/**
 * Get day of year from a date string (1-366)
 * Parses YYYY-MM-DD as local date to avoid timezone issues
 */
function getDayOfYear(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day); // Local date
  const start = new Date(year, 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Get quarter from a date string (1-4)
 */
function getQuarterFromDateStr(dateStr: string): number {
  const month = parseInt(dateStr.split("-")[1], 10);
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Fetch all B2B transactions and aggregate by day
 */
async function fetchB2BDataByYear(year: number): Promise<Map<string, { orders: number; revenue: number }>> {
  console.log(`  Fetching B2B transactions for ${year}...`);

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // Fetch all transactions for the year (excluding D2C customer)
  // NetSuite transactions don't have a limit like ShopifyQL
  const { data, error } = await supabase
    .from("ns_wholesale_transactions")
    .select("tran_date, foreign_total")
    .neq("ns_customer_id", D2C_CUSTOMER_ID)
    .gte("tran_date", startDate)
    .lte("tran_date", endDate)
    .order("tran_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch transactions: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.warn(`  No B2B transactions found for ${year}`);
    return new Map();
  }

  console.log(`  Found ${data.length} B2B transactions for ${year}`);

  // Aggregate by day
  const dailyData = new Map<string, { orders: number; revenue: number }>();

  for (const row of data as TransactionRow[]) {
    if (!row.tran_date) continue;

    const dateStr = row.tran_date.split("T")[0]; // Ensure YYYY-MM-DD format
    const existing = dailyData.get(dateStr) || { orders: 0, revenue: 0 };

    existing.orders += 1;
    existing.revenue += row.foreign_total || 0;

    dailyData.set(dateStr, existing);
  }

  console.log(`  Aggregated into ${dailyData.size} unique days`);
  return dailyData;
}

/**
 * Backfill B2B data for a single year
 */
async function backfillYear(year: number): Promise<number> {
  console.log(`\nBackfilling B2B data for ${year}...`);

  const dailyData = await fetchB2BDataByYear(year);

  if (dailyData.size === 0) {
    console.warn(`  No B2B data found for ${year}`);
    return 0;
  }

  // Prepare records for upsert
  const records: Array<{
    year: number;
    day_of_year: number;
    date: string;
    quarter: number;
    orders: number;
    revenue: number;
    channel: string;
    synced_at: string;
  }> = [];

  for (const [dateStr, data] of dailyData) {
    const dayOfYear = getDayOfYear(dateStr);
    const quarter = getQuarterFromDateStr(dateStr);

    records.push({
      year,
      day_of_year: dayOfYear,
      date: dateStr,
      quarter,
      orders: data.orders,
      revenue: Math.round(data.revenue * 100) / 100,
      channel: "b2b",
      synced_at: new Date().toISOString(),
    });
  }

  // Upsert in batches of 100
  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase.from("annual_sales_tracking").upsert(batch, {
      onConflict: "year,day_of_year,channel",
    });

    if (error) {
      console.error(`  Error inserting batch ${i / batchSize + 1}:`, error);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  Inserted/updated ${inserted} B2B records for ${year}`);
  return inserted;
}

/**
 * Verify data by comparing counts
 */
async function verifyData(): Promise<void> {
  console.log("\nVerifying data by channel...");

  const { data, error } = await supabase
    .from("annual_sales_tracking")
    .select("year, channel, revenue")
    .order("year")
    .order("channel");

  if (error) {
    console.error("Error verifying data:", error);
    return;
  }

  // Aggregate by year and channel
  const summary: Record<number, Record<string, { days: number; revenue: number }>> = {};

  for (const row of data || []) {
    if (!summary[row.year]) summary[row.year] = {};
    if (!summary[row.year][row.channel]) {
      summary[row.year][row.channel] = { days: 0, revenue: 0 };
    }
    summary[row.year][row.channel].days++;
    summary[row.year][row.channel].revenue += parseFloat(row.revenue) || 0;
  }

  console.log("\nData Summary by Year & Channel:");
  console.log("─".repeat(70));

  for (const year of Object.keys(summary).map(Number).sort()) {
    console.log(`\n${year}:`);
    for (const channel of ["d2c", "b2b"]) {
      const stats = summary[year][channel];
      if (stats) {
        console.log(
          `  ${channel.toUpperCase().padEnd(4)}: ${stats.days.toString().padStart(3)} days | $${stats.revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        );
      } else {
        console.log(`  ${channel.toUpperCase().padEnd(4)}: No data`);
      }
    }
  }

  console.log("\n" + "─".repeat(70));
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║     B2B Annual Sales Tracking - Historical Backfill    ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  // First verify the channel column exists
  const { error: testError } = await supabase
    .from("annual_sales_tracking")
    .select("channel")
    .limit(1);

  if (testError && testError.message.includes("channel")) {
    console.error("\n============================================================");
    console.error("CHANNEL COLUMN DOES NOT EXIST!");
    console.error("Please run the migration first:");
    console.error("  supabase/migrations/20251227_add_channel_column.sql");
    console.error("============================================================\n");
    process.exit(1);
  }

  const currentYear = new Date().getFullYear();
  let totalRecords = 0;

  // Backfill 2023 (for YoY comparison when viewing 2024)
  totalRecords += await backfillYear(2023);

  // Backfill 2024 (full year)
  totalRecords += await backfillYear(2024);

  // Backfill 2025 (year to date)
  totalRecords += await backfillYear(currentYear);

  console.log(`\n✓ Total B2B records: ${totalRecords}`);

  await verifyData();

  console.log("\n✓ B2B backfill complete!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
