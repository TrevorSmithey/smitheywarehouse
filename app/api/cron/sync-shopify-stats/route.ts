/**
 * Shopify Daily Stats Sync (via ShopifyQL) + B2B Sync (via NetSuite)
 *
 * Uses Shopify's Analytics API (ShopifyQL) to sync D2C daily sales data.
 * Also syncs B2B sales from NetSuite's ns_wholesale_transactions table.
 * This pulls the SAME numbers shown in Shopify Analytics dashboard.
 *
 * Triggered by Vercel cron daily at 5:30 AM UTC (12:30 AM EST)
 *
 * Syncs:
 * - Total orders per day (from Shopify Analytics) -> channel='d2c'
 * - Total revenue per day (from Shopify Analytics) -> channel='d2c'
 * - B2B orders/revenue per day (from NetSuite) -> channel='b2b'
 * - Average order value (calculated)
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { withRetry } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// How many days to look back when syncing
// Extended to 90 days to ensure Black Friday/holiday data stays fresh
// and to catch any delayed Shopify Analytics processing
const SYNC_LOOKBACK_DAYS = 90;

/**
 * Get day of year from a date string (1-366)
 * Uses month/day arithmetic to avoid DST issues
 */
function getDayOfYear(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);

  // Days in each month (index 0 is unused, index 1-12 are Jan-Dec)
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Check for leap year
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (isLeap) daysInMonth[2] = 29;

  // Sum days from previous months + current day
  let dayOfYear = day;
  for (let m = 1; m < month; m++) {
    dayOfYear += daysInMonth[m];
  }

  return dayOfYear;
}

/**
 * Get quarter from a date string (1-4)
 */
function getQuarter(dateStr: string): number {
  const month = new Date(dateStr).getMonth(); // 0-11
  if (month <= 2) return 1; // Jan-Mar
  if (month <= 5) return 2; // Apr-Jun
  if (month <= 8) return 3; // Jul-Sep
  return 4; // Oct-Dec
}

// ShopifyQL requires API version 2025-01 or later (using unstable for now)
const SHOPIFYQL_API_VERSION = "unstable";

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
 * Fetch daily sales data from Shopify Analytics via ShopifyQL
 */
async function fetchDailyStats(): Promise<Map<string, { orders: number; revenue: number }>> {
  const shop = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!shop || !accessToken) {
    throw new Error("Missing Shopify credentials");
  }

  const url = `https://${shop}/admin/api/${SHOPIFYQL_API_VERSION}/graphql.json`;

  // ShopifyQL query - get daily sales for the lookback period
  // TIMESERIES ensures we get all days, even those with no sales
  const shopifyqlQuery = `
    FROM sales
    SHOW total_sales, orders
    SINCE -${SYNC_LOOKBACK_DAYS}d
    UNTIL today
    TIMESERIES day
    ORDER BY day
  `.trim().replace(/\s+/g, " ");

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

  const response = await withRetry(
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify(graphqlQuery),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[SHOPIFY STATS] GraphQL API error: ${res.status} - ${errorText}`);
        throw new Error(`Shopify GraphQL API error: ${res.status}`);
      }

      return res.json();
    },
    { maxRetries: 3, baseDelayMs: 1000 },
    "ShopifyQL fetch"
  ) as ShopifyQLResponse;

  // Check for GraphQL errors
  if (response.errors?.length) {
    const errorMsg = response.errors.map((e) => e.message).join(", ");
    throw new Error(`ShopifyQL GraphQL error: ${errorMsg}`);
  }

  // Check for parse errors in ShopifyQL
  const parseErrors = response.data?.shopifyqlQuery?.parseErrors;
  if (parseErrors?.length) {
    const errorMsg = parseErrors.map((e) => e.message).join(", ");
    throw new Error(`ShopifyQL parse error: ${errorMsg}`);
  }

  const rows = response.data?.shopifyqlQuery?.tableData?.rows;
  if (!rows) {
    throw new Error("No data returned from ShopifyQL");
  }

  // Parse the response into a map
  const dailyStats = new Map<string, { orders: number; revenue: number }>();

  for (const row of rows) {
    // Row format is { day: "2025-12-21", total_sales: "12345.67", orders: "123" }
    const date = row.day;
    const revenue = parseFloat(row.total_sales) || 0;
    const orders = parseInt(row.orders, 10) || 0;

    dailyStats.set(date, { orders, revenue });
  }

  return dailyStats;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const stats = {
    daysUpdated: 0,
    totalOrders: 0,
    totalRevenue: 0,
    errors: 0,
    // B2B stats
    b2bDaysUpdated: 0,
    b2bTotalOrders: 0,
    b2bTotalRevenue: 0,
  };

  try {
    console.log("[SHOPIFY STATS] Starting sync via ShopifyQL...");

    const supabase = createServiceClient();

    // Fetch daily stats from Shopify Analytics
    const dailyStats = await fetchDailyStats();
    console.log(`[SHOPIFY STATS] Retrieved ${dailyStats.size} days from ShopifyQL`);

    // Upsert each day's stats
    for (const [date, data] of dailyStats) {
      const avgOrderValue = data.orders > 0 ? data.revenue / data.orders : 0;

      stats.totalOrders += data.orders;
      stats.totalRevenue += data.revenue;

      const { error } = await supabase.from("daily_stats").upsert(
        {
          date,
          total_orders: data.orders,
          total_revenue: Math.round(data.revenue * 100) / 100,
          avg_order_value: Math.round(avgOrderValue * 100) / 100,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "date" }
      );

      if (error) {
        console.error(`[SHOPIFY STATS] Error upserting daily_stats ${date}:`, error);
        stats.errors++;
      } else {
        stats.daysUpdated++;
      }

      // Also upsert to annual_sales_tracking for full-year revenue tracker (D2C channel)
      const year = new Date(date).getFullYear();
      const dayOfYear = getDayOfYear(date);
      const quarter = getQuarter(date);

      const { error: annualError } = await supabase.from("annual_sales_tracking").upsert(
        {
          year,
          day_of_year: dayOfYear,
          date,
          quarter,
          orders: data.orders,
          revenue: Math.round(data.revenue * 100) / 100,
          channel: "d2c", // D2C/Shopify data
          synced_at: new Date().toISOString(),
        },
        { onConflict: "year,day_of_year,channel" }
      );

      if (annualError) {
        console.error(`[SHOPIFY STATS] Error upserting annual_sales_tracking ${date}:`, annualError);
      }
    }

    // =========================================================================
    // B2B SYNC: Aggregate NetSuite transactions for the same period
    // =========================================================================
    console.log("[SHOPIFY STATS] Starting B2B sync from NetSuite...");

    // D2C customer ID in NetSuite to exclude from B2B metrics
    const D2C_CUSTOMER_ID = 2501;

    // Get date range for B2B sync
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - SYNC_LOOKBACK_DAYS);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];

    // Fetch B2B transactions for the lookback period
    const { data: b2bTransactions, error: b2bError } = await supabase
      .from("ns_wholesale_transactions")
      .select("tran_date, foreign_total")
      .neq("ns_customer_id", D2C_CUSTOMER_ID)
      .gte("tran_date", formatDate(startDate))
      .lte("tran_date", formatDate(endDate))
      .order("tran_date", { ascending: true });

    if (b2bError) {
      console.error("[SHOPIFY STATS] Error fetching B2B transactions:", b2bError);
    } else if (b2bTransactions && b2bTransactions.length > 0) {
      console.log(`[SHOPIFY STATS] Found ${b2bTransactions.length} B2B transactions`);

      // Aggregate B2B transactions by day
      const b2bByDay = new Map<string, { orders: number; revenue: number }>();
      let skippedCount = 0;
      for (const tx of b2bTransactions) {
        const txDate = tx.tran_date?.split("T")[0];
        if (!txDate) {
          skippedCount++;
          continue;
        }

        const existing = b2bByDay.get(txDate) || { orders: 0, revenue: 0 };
        existing.orders += 1;
        existing.revenue += tx.foreign_total || 0;
        b2bByDay.set(txDate, existing);
      }
      if (skippedCount > 0) {
        console.warn(`[SHOPIFY STATS] Skipped ${skippedCount} B2B transactions with null tran_date`);
      }

      console.log(`[SHOPIFY STATS] Aggregated ${b2bByDay.size} B2B days`);

      // Upsert B2B data
      for (const [date, data] of b2bByDay) {
        const year = new Date(date).getFullYear();
        const dayOfYear = getDayOfYear(date);
        const quarter = getQuarter(date);

        stats.b2bTotalOrders += data.orders;
        stats.b2bTotalRevenue += data.revenue;

        const { error: b2bAnnualError } = await supabase.from("annual_sales_tracking").upsert(
          {
            year,
            day_of_year: dayOfYear,
            date,
            quarter,
            orders: data.orders,
            revenue: Math.round(data.revenue * 100) / 100,
            channel: "b2b", // B2B/NetSuite data
            synced_at: new Date().toISOString(),
          },
          { onConflict: "year,day_of_year,channel" }
        );

        if (b2bAnnualError) {
          console.error(`[SHOPIFY STATS] Error upserting B2B annual_sales_tracking ${date}:`, b2bAnnualError);
        } else {
          stats.b2bDaysUpdated++;
        }
      }

      console.log(`[SHOPIFY STATS] B2B sync complete: ${stats.b2bDaysUpdated} days updated`);
    } else {
      console.log("[SHOPIFY STATS] No B2B transactions found for period");
    }

    const duration = Date.now() - startTime;
    console.log(`[SHOPIFY STATS] Complete in ${duration}ms:`, stats);

    // Log success
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "shopify_stats",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "success",
        records_expected: SYNC_LOOKBACK_DAYS,
        records_synced: stats.daysUpdated + stats.b2bDaysUpdated,
        details: {
          source: "shopifyql",
          // D2C (Shopify) metrics
          d2c: {
            daysUpdated: stats.daysUpdated,
            totalOrders: stats.totalOrders,
            totalRevenue: Math.round(stats.totalRevenue * 100) / 100,
          },
          // B2B (NetSuite) metrics
          b2b: {
            daysUpdated: stats.b2bDaysUpdated,
            totalOrders: stats.b2bTotalOrders,
            totalRevenue: Math.round(stats.b2bTotalRevenue * 100) / 100,
          },
        },
        duration_ms: duration,
      });
    } catch (logError) {
      console.error("[SHOPIFY STATS] Failed to log sync success:", logError);
    }

    return NextResponse.json({
      success: true,
      source: "shopifyql",
      ...stats,
      duration,
    });
  } catch (error) {
    console.error("[SHOPIFY STATS] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    await sendSyncFailureAlert({
      syncType: "Shopify Daily Stats (ShopifyQL)",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    const supabase = createServiceClient();
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "shopify_stats",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[SHOPIFY STATS] Failed to log sync failure:", logError);
    }

    return NextResponse.json({ error: errorMessage, duration: elapsed }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
