/**
 * Shopify Stats Reconciliation Cron
 *
 * Weekly job that verifies historical Shopify data in our database matches
 * the actual ShopifyQL data. Fixes any discrepancies found.
 *
 * Why this exists:
 * - ShopifyQL can return incomplete data during high-volume periods (e.g., Black Friday)
 * - Shopify Analytics processing can be delayed for large order volumes
 * - Network issues or rate limits can cause partial syncs
 *
 * Triggered by Vercel cron weekly on Sundays at 6:00 AM UTC (1:00 AM EST)
 *
 * Checks:
 * - Last 180 days of D2C data (covers Q4 holiday season)
 * - Compares DB totals against fresh ShopifyQL query
 * - Auto-fixes discrepancies > $100 or > 5 orders
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { withRetry } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Check last 180 days for discrepancies
const RECONCILE_LOOKBACK_DAYS = 180;

// Thresholds for auto-fix (only fix significant discrepancies)
const REVENUE_THRESHOLD = 100; // $100
const ORDER_THRESHOLD = 5; // 5 orders

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
      parseErrors?: string;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Get day of year from a date string (1-366)
 */
function getDayOfYear(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (isLeap) daysInMonth[2] = 29;
  let dayOfYear = day;
  for (let m = 1; m < month; m++) dayOfYear += daysInMonth[m];
  return dayOfYear;
}

/**
 * Get quarter from a date string (1-4)
 */
function getQuarter(dateStr: string): number {
  const month = new Date(dateStr).getMonth();
  if (month <= 2) return 1;
  if (month <= 5) return 2;
  if (month <= 8) return 3;
  return 4;
}

/**
 * Fetch daily sales data from Shopify Analytics via ShopifyQL
 */
async function fetchShopifyData(
  startDate: string,
  endDate: string
): Promise<Map<string, { orders: number; revenue: number }>> {
  const shop = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!shop || !accessToken) {
    throw new Error("Missing Shopify credentials");
  }

  const url = `https://${shop}/admin/api/unstable/graphql.json`;
  const shopifyqlQuery = `FROM sales SHOW total_sales, orders SINCE ${startDate} UNTIL ${endDate} TIMESERIES day ORDER BY day`;

  const graphqlQuery = {
    query: `{ shopifyqlQuery(query: "${shopifyqlQuery}") { tableData { columns { name dataType } rows } parseErrors } }`,
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
        throw new Error(`Shopify GraphQL API error: ${res.status}`);
      }

      return res.json();
    },
    { maxRetries: 3, baseDelayMs: 1000 },
    "ShopifyQL reconciliation fetch"
  ) as ShopifyQLResponse;

  if (response.errors?.length) {
    throw new Error(`ShopifyQL error: ${response.errors.map((e) => e.message).join(", ")}`);
  }

  const rows = response.data?.shopifyqlQuery?.tableData?.rows;
  if (!rows) {
    throw new Error("No data returned from ShopifyQL");
  }

  const dailyStats = new Map<string, { orders: number; revenue: number }>();
  for (const row of rows) {
    dailyStats.set(row.day, {
      orders: parseInt(row.orders, 10) || 0,
      revenue: parseFloat(row.total_sales) || 0,
    });
  }

  return dailyStats;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const stats = {
    daysChecked: 0,
    discrepanciesFound: 0,
    daysFixed: 0,
    totalRevenueRecovered: 0,
    totalOrdersRecovered: 0,
    errors: 0,
  };

  try {
    console.log("[RECONCILE] Starting Shopify stats reconciliation...");

    const supabase = createServiceClient();

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - RECONCILE_LOOKBACK_DAYS);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    console.log(`[RECONCILE] Checking ${startDateStr} to ${endDateStr}`);

    // Fetch fresh data from Shopify
    const shopifyData = await fetchShopifyData(startDateStr, endDateStr);
    console.log(`[RECONCILE] Got ${shopifyData.size} days from ShopifyQL`);

    // Fetch current DB data
    const { data: dbData, error: dbError } = await supabase
      .from("daily_stats")
      .select("date, total_orders, total_revenue")
      .gte("date", startDateStr)
      .lte("date", endDateStr)
      .order("date");

    if (dbError) {
      throw new Error(`Failed to fetch DB data: ${dbError.message}`);
    }

    // Build DB lookup
    const dbByDate = new Map<string, { orders: number; revenue: number }>();
    for (const row of dbData || []) {
      dbByDate.set(row.date, {
        orders: row.total_orders || 0,
        revenue: parseFloat(row.total_revenue) || 0,
      });
    }

    // Compare and fix discrepancies
    const fixes: Array<{ date: string; orderDiff: number; revenueDiff: number }> = [];

    for (const [date, shopify] of shopifyData) {
      stats.daysChecked++;
      const db = dbByDate.get(date) || { orders: 0, revenue: 0 };

      const orderDiff = shopify.orders - db.orders;
      const revenueDiff = shopify.revenue - db.revenue;

      // Check if discrepancy exceeds thresholds
      if (Math.abs(revenueDiff) > REVENUE_THRESHOLD || Math.abs(orderDiff) > ORDER_THRESHOLD) {
        stats.discrepanciesFound++;
        fixes.push({ date, orderDiff, revenueDiff });

        console.log(
          `[RECONCILE] ${date}: DB=${db.orders} orders/$${db.revenue.toFixed(2)}, ` +
            `Shopify=${shopify.orders} orders/$${shopify.revenue.toFixed(2)}, ` +
            `Diff=${orderDiff > 0 ? "+" : ""}${orderDiff} orders, ${revenueDiff > 0 ? "+" : ""}$${revenueDiff.toFixed(2)}`
        );

        // Fix daily_stats
        const avgOrderValue = shopify.orders > 0 ? shopify.revenue / shopify.orders : 0;
        const { error: dailyError } = await supabase.from("daily_stats").upsert(
          {
            date,
            total_orders: shopify.orders,
            total_revenue: Math.round(shopify.revenue * 100) / 100,
            avg_order_value: Math.round(avgOrderValue * 100) / 100,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "date" }
        );

        if (dailyError) {
          console.error(`[RECONCILE] Error fixing daily_stats ${date}: ${dailyError.message}`);
          stats.errors++;
          continue;
        }

        // Fix annual_sales_tracking
        const year = new Date(date).getFullYear();
        const dayOfYear = getDayOfYear(date);
        const quarter = getQuarter(date);

        const { error: annualError } = await supabase.from("annual_sales_tracking").upsert(
          {
            year,
            day_of_year: dayOfYear,
            date,
            quarter,
            orders: shopify.orders,
            revenue: Math.round(shopify.revenue * 100) / 100,
            channel: "d2c",
            synced_at: new Date().toISOString(),
          },
          { onConflict: "year,day_of_year,channel" }
        );

        if (annualError) {
          console.error(`[RECONCILE] Error fixing annual_sales_tracking ${date}: ${annualError.message}`);
          stats.errors++;
          continue;
        }

        stats.daysFixed++;
        stats.totalOrdersRecovered += orderDiff;
        stats.totalRevenueRecovered += revenueDiff;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[RECONCILE] Complete in ${duration}ms:`, stats);

    // Log to sync_logs
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "shopify_reconcile",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: stats.errors > 0 ? "partial" : "success",
        records_expected: stats.daysChecked,
        records_synced: stats.daysFixed,
        details: {
          lookbackDays: RECONCILE_LOOKBACK_DAYS,
          discrepanciesFound: stats.discrepanciesFound,
          daysFixed: stats.daysFixed,
          totalOrdersRecovered: stats.totalOrdersRecovered,
          totalRevenueRecovered: Math.round(stats.totalRevenueRecovered * 100) / 100,
          fixes: fixes.slice(0, 20), // Log up to 20 fixes for debugging
        },
        duration_ms: duration,
      });
    } catch (logError) {
      console.error("[RECONCILE] Failed to log sync:", logError);
    }

    // Send alert if significant revenue was recovered
    if (stats.totalRevenueRecovered > 10000) {
      console.log(`[RECONCILE] ALERT: Recovered $${stats.totalRevenueRecovered.toFixed(2)} in revenue`);
      // Could add Slack/email alert here
    }

    return NextResponse.json({
      success: true,
      ...stats,
      duration,
    });
  } catch (error) {
    console.error("[RECONCILE] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Reconciliation failed";
    const elapsed = Date.now() - startTime;

    await sendSyncFailureAlert({
      syncType: "Shopify Stats Reconciliation",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    const supabase = createServiceClient();
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "shopify_reconcile",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[RECONCILE] Failed to log failure:", logError);
    }

    return NextResponse.json({ error: errorMessage, duration: elapsed }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
