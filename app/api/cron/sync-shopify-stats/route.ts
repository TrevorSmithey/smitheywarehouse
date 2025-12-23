/**
 * Shopify Daily Stats Sync (via ShopifyQL)
 *
 * Uses Shopify's Analytics API (ShopifyQL) to sync daily sales data.
 * This pulls the SAME numbers shown in Shopify Analytics dashboard.
 *
 * Triggered by Vercel cron daily at 5:30 AM UTC (12:30 AM EST)
 *
 * Syncs:
 * - Total orders per day (from Shopify Analytics)
 * - Total revenue per day (from Shopify Analytics)
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
const SYNC_LOOKBACK_DAYS = 30;

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
        console.error(`[SHOPIFY STATS] Error upserting ${date}:`, error);
        stats.errors++;
      } else {
        stats.daysUpdated++;
      }
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
        records_synced: stats.daysUpdated,
        details: {
          source: "shopifyql",
          totalOrders: stats.totalOrders,
          totalRevenue: stats.totalRevenue,
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
