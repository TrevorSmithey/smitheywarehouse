/**
 * Shopify Daily Stats Sync
 * Syncs daily order counts and revenue from Shopify to Supabase
 *
 * Triggered by Vercel cron daily at 5:30 AM UTC (12:30 AM EST)
 *
 * Syncs:
 * - Total orders per day
 * - Total revenue per day
 * - Average order value
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 1 minute - must be literal for Next.js static analysis

const SHOPIFY_API_VERSION = "2024-04";

interface ShopifyOrdersResponse {
  orders: Array<{
    id: number;
    total_price: string;
    created_at: string;
    cancelled_at: string | null;
    financial_status: string;
  }>;
}

async function fetchShopifyOrders(startDate: Date, endDate: Date): Promise<ShopifyOrdersResponse["orders"]> {
  const shop = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!shop || !accessToken) {
    throw new Error("Missing Shopify credentials");
  }

  const orders: ShopifyOrdersResponse["orders"] = [];
  let pageInfo: string | null = null;
  let hasNextPage = true;

  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  while (hasNextPage) {
    let url: string;

    if (pageInfo) {
      url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?page_info=${pageInfo}&limit=250`;
    } else {
      url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?created_at_min=${startIso}&created_at_max=${endIso}&status=any&limit=250&fields=id,total_price,created_at,cancelled_at,financial_status`;
    }

    const response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[SHOPIFY STATS] API error: ${response.status} - ${errorText}`);
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data: ShopifyOrdersResponse = await response.json();
    orders.push(...data.orders);

    // Handle pagination via Link header
    const linkHeader = response.headers.get("Link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/);
      pageInfo = match ? match[1] : null;
      hasNextPage = !!pageInfo;
    } else {
      hasNextPage = false;
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return orders;
}

export async function GET(request: Request) {
  // Always verify cron secret - no exceptions
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const stats = {
    daysUpdated: 0,
    ordersProcessed: 0,
    errors: 0,
  };

  try {
    console.log("[SHOPIFY STATS] Starting sync...");

    const supabase = createServiceClient();

    // Sync last 7 days (to catch any late updates)
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    console.log(`[SHOPIFY STATS] Fetching orders from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const orders = await fetchShopifyOrders(startDate, endDate);
    console.log(`[SHOPIFY STATS] Fetched ${orders.length} orders`);
    stats.ordersProcessed = orders.length;

    // Group orders by date
    const dailyStats = new Map<string, { orders: number; revenue: number }>();

    for (const order of orders) {
      // Skip cancelled orders and orders without payment
      if (order.cancelled_at) continue;
      if (order.financial_status !== "paid" && order.financial_status !== "partially_paid") continue;

      const orderDate = order.created_at.split("T")[0];
      const revenue = parseFloat(order.total_price) || 0;

      const current = dailyStats.get(orderDate) || { orders: 0, revenue: 0 };
      current.orders++;
      current.revenue += revenue;
      dailyStats.set(orderDate, current);
    }

    console.log(`[SHOPIFY STATS] Aggregated into ${dailyStats.size} days`);

    // Upsert daily stats
    for (const [date, data] of dailyStats) {
      const avgOrderValue = data.orders > 0 ? data.revenue / data.orders : 0;

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

    return NextResponse.json({
      success: true,
      ...stats,
      duration,
    });

  } catch (error) {
    console.error("[SHOPIFY STATS] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    // Send email alert
    await sendSyncFailureAlert({
      syncType: "Shopify Daily Stats",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Log to sync_logs
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

    return NextResponse.json(
      {
        error: errorMessage,
        duration: elapsed,
      },
      { status: 500 }
    );
  }
}

// POST handler for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
