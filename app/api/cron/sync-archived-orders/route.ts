/**
 * Sync Archived Orders from Shopify
 *
 * Backfills the `archived` field for orders in our database by checking
 * Shopify's `closed_at` timestamp. Orders with closed_at set are archived.
 *
 * This cron runs daily to catch any orders archived in Shopify that weren't
 * caught by the webhook (e.g., manual archiving in Shopify admin).
 *
 * The webhook handler now sets archived=true for new orders with closed_at,
 * so this cron mainly catches:
 * - Historical orders archived before we added this field
 * - Orders archived directly in Shopify admin (bypasses webhook)
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { withRetry, SHOPIFY_API_VERSION } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// How many days back to check for archived orders
const LOOKBACK_DAYS = 365;

// Shopify pagination limit (max 250)
const PAGE_LIMIT = 250;

interface ShopifyOrder {
  id: number;
  name: string;
  closed_at: string | null;
}

interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}

/**
 * Fetch archived orders from Shopify REST API
 * status=closed returns orders where closed_at is set
 */
async function fetchArchivedOrders(
  shop: string,
  accessToken: string,
  createdAtMin: string,
  pageInfo?: string
): Promise<{ orders: ShopifyOrder[]; nextPageInfo: string | null }> {
  let url: string;

  if (pageInfo) {
    // Cursor-based pagination
    url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${PAGE_LIMIT}&page_info=${pageInfo}`;
  } else {
    // Initial request with filters
    url =
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
      `?status=closed` +
      `&created_at_min=${createdAtMin}` +
      `&limit=${PAGE_LIMIT}` +
      `&fields=id,name,closed_at`;
  }

  const response = await withRetry(
    async () => {
      const res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
        },
      });

      if (!res.ok) {
        throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
      }

      // Parse Link header for pagination
      const linkHeader = res.headers.get("Link");
      let nextPage: string | null = null;

      if (linkHeader) {
        // Format: <url>; rel="next", <url>; rel="previous"
        const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        if (nextMatch) {
          nextPage = nextMatch[1];
        }
      }

      const data: ShopifyOrdersResponse = await res.json();
      return { orders: data.orders, nextPageInfo: nextPage };
    },
    { maxRetries: 3, baseDelayMs: 1000 },
    "Fetch archived orders"
  );

  return response;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const stats = {
    ordersChecked: 0,
    ordersMarkedArchived: 0,
    ordersAlreadyArchived: 0,
    ordersNotFound: 0,
    errors: 0,
  };

  try {
    console.log("[SYNC-ARCHIVED] Starting archived orders sync...");

    const shop = process.env.SHOPIFY_STORE_URL;
    const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!shop || !accessToken) {
      throw new Error("Missing Shopify credentials");
    }

    const supabase = createServiceClient();

    // Calculate lookback date
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
    const createdAtMin = lookbackDate.toISOString();

    console.log(`[SYNC-ARCHIVED] Fetching orders archived since ${createdAtMin}`);

    // Paginate through all archived orders
    let pageInfo: string | null = null;
    let allArchivedOrders: ShopifyOrder[] = [];

    do {
      const result = await fetchArchivedOrders(shop, accessToken, createdAtMin, pageInfo || undefined);
      allArchivedOrders = allArchivedOrders.concat(result.orders);
      pageInfo = result.nextPageInfo;

      console.log(`[SYNC-ARCHIVED] Fetched ${result.orders.length} orders (total: ${allArchivedOrders.length})`);
    } while (pageInfo);

    console.log(`[SYNC-ARCHIVED] Total archived orders from Shopify: ${allArchivedOrders.length}`);

    // Get current archived status from our DB for these orders
    const orderIds = allArchivedOrders.map((o) => o.id);

    // Process in batches to avoid query size limits
    const batchSize = 500;
    for (let i = 0; i < orderIds.length; i += batchSize) {
      const batchIds = orderIds.slice(i, i + batchSize);

      const { data: dbOrders, error: fetchError } = await supabase
        .from("orders")
        .select("id, archived")
        .in("id", batchIds);

      if (fetchError) {
        console.error(`[SYNC-ARCHIVED] Error fetching batch: ${fetchError.message}`);
        stats.errors++;
        continue;
      }

      // Build lookup of DB orders
      const dbOrderMap = new Map(dbOrders?.map((o) => [o.id, o.archived]) || []);

      // Find orders that need updating (in DB but not marked archived)
      const ordersToUpdate: number[] = [];

      for (const shopifyOrder of allArchivedOrders.slice(i, i + batchSize)) {
        stats.ordersChecked++;
        const currentArchived = dbOrderMap.get(shopifyOrder.id);

        if (currentArchived === undefined) {
          // Order not in our DB (might be older than our sync history)
          stats.ordersNotFound++;
        } else if (currentArchived === true) {
          // Already marked archived
          stats.ordersAlreadyArchived++;
        } else {
          // Needs to be marked archived
          ordersToUpdate.push(shopifyOrder.id);
        }
      }

      // Batch update orders that need archiving
      if (ordersToUpdate.length > 0) {
        const { error: updateError } = await supabase
          .from("orders")
          .update({
            archived: true,
            updated_at: new Date().toISOString(),
          })
          .in("id", ordersToUpdate);

        if (updateError) {
          console.error(`[SYNC-ARCHIVED] Error updating batch: ${updateError.message}`);
          stats.errors++;
        } else {
          stats.ordersMarkedArchived += ordersToUpdate.length;
          console.log(`[SYNC-ARCHIVED] Marked ${ordersToUpdate.length} orders as archived`);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[SYNC-ARCHIVED] Complete in ${duration}ms:`, stats);

    // Log to sync_logs
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "archived_orders",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: stats.errors > 0 ? "partial" : "success",
        records_expected: stats.ordersChecked,
        records_synced: stats.ordersMarkedArchived,
        details: {
          lookbackDays: LOOKBACK_DAYS,
          shopifyTotal: allArchivedOrders.length,
          alreadyArchived: stats.ordersAlreadyArchived,
          notInDb: stats.ordersNotFound,
          newlyArchived: stats.ordersMarkedArchived,
        },
        duration_ms: duration,
      });
    } catch (logError) {
      console.error("[SYNC-ARCHIVED] Failed to log sync:", logError);
    }

    return NextResponse.json({
      success: true,
      ...stats,
      duration,
    });
  } catch (error) {
    console.error("[SYNC-ARCHIVED] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    // Log failure
    const supabase = createServiceClient();
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "archived_orders",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[SYNC-ARCHIVED] Failed to log failure:", logError);
    }

    return NextResponse.json({ error: errorMessage, duration: elapsed }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
