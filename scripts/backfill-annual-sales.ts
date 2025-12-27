/**
 * Backfill Annual Sales Tracking
 *
 * One-time script to:
 * 1. Create the annual_sales_tracking table (if needed)
 * 2. Pull all 2024 and 2025 daily sales data from Shopify
 * 3. Insert into the annual_sales_tracking table
 *
 * Run with: npx tsx scripts/backfill-annual-sales.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) {
  console.error("Missing Shopify credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ShopifyQL API version
const SHOPIFY_API_VERSION = "unstable";

interface ShopifyQLRow {
  day: string;
  total_sales: string;
  orders: string;
}

interface ShopifyQLResponse {
  data?: {
    shopifyqlQuery?: {
      tableData?: {
        columns: Array<{ name: string; dataType: string }>;
        rows: ShopifyQLRow[];
      };
      parseErrors?: Array<{ message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Get day of year from a date string (1-366)
 * Parses YYYY-MM-DD as local date to avoid timezone issues
 */
function getDayOfYear(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day); // Local date, no timezone shift
  const start = new Date(year, 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Get quarter from a date string (1-4)
 * Parses YYYY-MM-DD as local date
 */
function getQuarterFromDateStr(dateStr: string): number {
  const month = parseInt(dateStr.split("-")[1], 10); // 1-12
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

/**
 * Fetch daily sales from Shopify for a specific date range
 */
async function fetchShopifyData(
  startDate: string,
  endDate: string
): Promise<Map<string, { orders: number; revenue: number }>> {
  const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const shopifyqlQuery = `
    FROM sales
    SHOW total_sales, orders
    SINCE ${startDate}
    UNTIL ${endDate}
    TIMESERIES day
    ORDER BY day
  `
    .trim()
    .replace(/\s+/g, " ");

  const graphqlQuery = {
    query: `
      {
        shopifyqlQuery(query: "${shopifyqlQuery}") {
          tableData {
            columns { name dataType }
            rows
          }
          parseErrors
        }
      }
    `,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    body: JSON.stringify(graphqlQuery),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as ShopifyQLResponse;

  if (data.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${data.errors.map((e) => e.message).join(", ")}`);
  }

  if (data.data?.shopifyqlQuery?.parseErrors?.length) {
    throw new Error(
      `ShopifyQL parse error: ${data.data.shopifyqlQuery.parseErrors.map((e) => e.message).join(", ")}`
    );
  }

  const rows = data.data?.shopifyqlQuery?.tableData?.rows;
  if (!rows) {
    console.warn("No data returned for range:", startDate, "-", endDate);
    return new Map();
  }

  const result = new Map<string, { orders: number; revenue: number }>();
  for (const row of rows) {
    const date = row.day;
    const revenue = parseFloat(row.total_sales) || 0;
    const orders = parseInt(row.orders, 10) || 0;
    result.set(date, { orders, revenue });
  }

  return result;
}

/**
 * Create the table if it doesn't exist
 */
async function ensureTableExists(): Promise<void> {
  console.log("Ensuring annual_sales_tracking table exists...");

  // Use rpc to execute raw SQL
  const { error } = await supabase.rpc("exec_sql", {
    sql_query: `
      CREATE TABLE IF NOT EXISTS annual_sales_tracking (
        year INTEGER NOT NULL,
        day_of_year INTEGER NOT NULL,
        date DATE NOT NULL,
        quarter INTEGER NOT NULL,
        orders INTEGER NOT NULL DEFAULT 0,
        revenue DECIMAL(12, 2) NOT NULL DEFAULT 0,
        synced_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (year, day_of_year)
      );
      CREATE INDEX IF NOT EXISTS idx_annual_sales_year ON annual_sales_tracking(year);
      CREATE INDEX IF NOT EXISTS idx_annual_sales_quarter ON annual_sales_tracking(year, quarter);
      CREATE INDEX IF NOT EXISTS idx_annual_sales_date ON annual_sales_tracking(date);
    `,
  });

  if (error) {
    // If rpc doesn't exist, try direct insert to test table existence
    console.warn("Could not run exec_sql rpc, checking if table exists via insert test...");

    const { error: testError } = await supabase.from("annual_sales_tracking").select("year").limit(1);

    if (testError && testError.message.includes("does not exist")) {
      console.error(
        "\n============================================================"
      );
      console.error("TABLE DOES NOT EXIST!");
      console.error("Please run the following SQL in your Supabase dashboard:");
      console.error("============================================================\n");
      console.error(`
CREATE TABLE IF NOT EXISTS annual_sales_tracking (
  year INTEGER NOT NULL,
  day_of_year INTEGER NOT NULL,
  date DATE NOT NULL,
  quarter INTEGER NOT NULL,
  orders INTEGER NOT NULL DEFAULT 0,
  revenue DECIMAL(12, 2) NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (year, day_of_year)
);

CREATE INDEX IF NOT EXISTS idx_annual_sales_year ON annual_sales_tracking(year);
CREATE INDEX IF NOT EXISTS idx_annual_sales_quarter ON annual_sales_tracking(year, quarter);
CREATE INDEX IF NOT EXISTS idx_annual_sales_date ON annual_sales_tracking(date);
      `);
      console.error("\n============================================================\n");
      process.exit(1);
    }
  }

  console.log("Table check complete.");
}

/**
 * Backfill data for a single year
 */
async function backfillYear(year: number): Promise<number> {
  console.log(`\nBackfilling year ${year}...`);

  const startDate = `${year}-01-01`;
  const endDate = year === new Date().getFullYear() ? "today" : `${year}-12-31`;

  console.log(`  Fetching Shopify data: ${startDate} to ${endDate}`);
  const dailyData = await fetchShopifyData(startDate, endDate);
  console.log(`  Retrieved ${dailyData.size} days from Shopify`);

  if (dailyData.size === 0) {
    console.warn(`  No data found for ${year}`);
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
    // Use string-based parsing to avoid timezone issues
    const dayOfYear = getDayOfYear(dateStr);
    const quarter = getQuarterFromDateStr(dateStr);

    records.push({
      year,
      day_of_year: dayOfYear,
      date: dateStr,
      quarter,
      orders: data.orders,
      revenue: Math.round(data.revenue * 100) / 100,
      channel: "d2c", // D2C/Shopify data
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

  console.log(`  Inserted/updated ${inserted} records for ${year}`);
  return inserted;
}

/**
 * Verify data by comparing counts
 */
async function verifyData(): Promise<void> {
  console.log("\nVerifying data...");

  const { data, error } = await supabase
    .from("annual_sales_tracking")
    .select("year, quarter")
    .order("year")
    .order("quarter");

  if (error) {
    console.error("Error verifying data:", error);
    return;
  }

  // Count by year and quarter
  const counts: Record<number, Record<number, number>> = {};
  for (const row of data || []) {
    if (!counts[row.year]) counts[row.year] = {};
    if (!counts[row.year][row.quarter]) counts[row.year][row.quarter] = 0;
    counts[row.year][row.quarter]++;
  }

  console.log("\nData Summary:");
  console.log("─".repeat(50));

  for (const year of Object.keys(counts).map(Number).sort()) {
    const yearTotal = Object.values(counts[year]).reduce((a, b) => a + b, 0);
    console.log(`\n${year}: ${yearTotal} days total`);
    for (let q = 1; q <= 4; q++) {
      console.log(`  Q${q}: ${counts[year][q] || 0} days`);
    }
  }

  console.log("\n" + "─".repeat(50));
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║     Annual Sales Tracking - Historical Backfill        ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  await ensureTableExists();

  const currentYear = new Date().getFullYear();
  let totalRecords = 0;

  // Backfill 2023 (full year - for YoY comparison when viewing 2024)
  totalRecords += await backfillYear(2023);

  // Backfill 2024 (full year)
  totalRecords += await backfillYear(2024);

  // Backfill 2025 (year to date)
  totalRecords += await backfillYear(currentYear);

  console.log(`\n✓ Total records: ${totalRecords}`);

  await verifyData();

  console.log("\n✓ Backfill complete!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
