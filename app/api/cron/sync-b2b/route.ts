import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { BATCH_SIZES, SYNC_WINDOWS, RATE_LIMIT_DELAYS } from "@/lib/constants";
import { SHOPIFY_API_VERSION, withRetry } from "@/lib/shopify";

const LOCK_NAME = "sync-b2b";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes - must be literal for Next.js static analysis

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  customer?: { first_name?: string; last_name?: string; email?: string };
  source_name?: string;
  line_items?: ShopifyLineItem[];
  cancelled_at?: string;
}

interface ShopifyLineItem {
  id: number;
  sku: string;
  quantity: number;
  price: string;
}

interface B2BSold {
  order_id: number;
  order_name: string;
  customer_name: string | null;
  source_name: string | null;
  sku: string;
  quantity: number;
  price: number | null;
  fulfilled_at: string; // Using this field to store sold_at (order date)
  created_at: string;
}

async function fetchOrders(fromDate: string): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;
  let hasMore = true;

  while (hasMore) {
    let url: string;
    if (pageInfo) {
      url = `https://${SHOPIFY_B2B_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders.json?page_info=${pageInfo}`;
    } else {
      // Fetch ALL orders (not just shipped) - track sold, not fulfilled
      const params = new URLSearchParams({
        status: "any",
        created_at_min: fromDate,
        limit: "250",
      });
      url = `https://${SHOPIFY_B2B_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`;
    }

    const { orders, linkHeader } = await withRetry(
      async () => {
        const response = await fetch(url, {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN!,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
          orders: data.orders || [],
          linkHeader: response.headers.get("link"),
        };
      },
      { maxRetries: 3, baseDelayMs: 1000 },
      "B2B orders fetch"
    );
    allOrders.push(...orders);

    // Check for pagination
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>; rel="next"/);
      pageInfo = match ? match[1] : null;
      hasMore = !!pageInfo;
    } else {
      hasMore = false;
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAYS.SHOPIFY));
  }

  return allOrders;
}

function extractSoldItems(orders: ShopifyOrder[]): B2BSold[] {
  const items: B2BSold[] = [];

  for (const order of orders) {
    // Skip cancelled orders
    // TODO: Consider including cancelled orders in the future for apples-to-apples
    // comparison with Excel reports that include all orders placed
    if (order.cancelled_at) continue;

    const customerName = order.customer
      ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(" ") ||
        order.customer.email ||
        null
      : null;

    // Extract from order line_items (sold), not fulfillments
    for (const lineItem of order.line_items || []) {
      if (!lineItem.sku || lineItem.sku === "Gift-Note" || lineItem.sku === "Smith-Eng") {
        continue;
      }

      items.push({
        order_id: order.id,
        order_name: order.name,
        customer_name: customerName,
        source_name: order.source_name || null,
        sku: lineItem.sku,
        quantity: lineItem.quantity,
        price: isNaN(parseFloat(lineItem.price)) ? null : parseFloat(lineItem.price),
        fulfilled_at: order.created_at, // Use order date as "sold" date
        created_at: order.created_at,
      });
    }
  }

  return items;
}

async function upsertItems(
  supabase: ReturnType<typeof createServiceClient>,
  items: B2BSold[]
): Promise<number> {
  if (items.length === 0) return 0;

  // Dedupe items by order_id + sku (one entry per SKU per order)
  const deduped = new Map<string, B2BSold>();
  for (const item of items) {
    const key = `${item.order_id}|${item.sku}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      deduped.set(key, { ...item });
    }
  }
  const uniqueItems = Array.from(deduped.values());

  // Batch upsert
  let totalUpserted = 0;

  for (let i = 0; i < uniqueItems.length; i += BATCH_SIZES.DEFAULT) {
    const chunk = uniqueItems.slice(i, i + BATCH_SIZES.DEFAULT);
    const { error } = await supabase.from("b2b_fulfilled").upsert(chunk, {
      onConflict: "order_id,sku,fulfilled_at",
      ignoreDuplicates: false,
    });

    if (error) throw error;
    totalUpserted += chunk.length;
  }

  return totalUpserted;
}

export async function GET(request: Request) {
  // Always verify cron secret - no exceptions
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[B2B] Skipping sync - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  try {
    if (!SHOPIFY_B2B_STORE || !SHOPIFY_B2B_TOKEN) {
      return NextResponse.json(
        { error: "Missing B2B Shopify credentials" },
        { status: 500 }
      );
    }

    console.log("Starting B2B sync (orders sold)...");

    // Sync last 7 days using EST timezone (Smithey is US-based)
    // This ensures consistent window regardless of server location
    const now = new Date();
    const estFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const estParts = estFormatter.formatToParts(now);
    const estYear = parseInt(estParts.find(p => p.type === "year")?.value || "2025");
    const estMonth = parseInt(estParts.find(p => p.type === "month")?.value || "1") - 1;
    const estDay = parseInt(estParts.find(p => p.type === "day")?.value || "1");

    // Create date at midnight EST, then subtract sync window days
    const todayEST = new Date(Date.UTC(estYear, estMonth, estDay, 5, 0, 0)); // 5 AM UTC = midnight EST
    const syncStart = new Date(todayEST.getTime() - SYNC_WINDOWS.DEFAULT_DAYS * SYNC_WINDOWS.MS_PER_DAY);
    const fromDate = syncStart.toISOString();

    // Fetch orders
    const orders = await fetchOrders(fromDate);
    console.log(`Fetched ${orders.length} B2B orders`);

    // Extract sold items (from order line_items, not fulfillments)
    const items = extractSoldItems(orders);
    console.log(`Extracted ${items.length} sold line items`);

    // Upsert to Supabase
    const upserted = await upsertItems(supabase, items);

    const elapsed = Date.now() - startTime;
    const elapsedSec = (elapsed / 1000).toFixed(1);

    // Get totals for response
    const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);

    // Log sync result
    await supabase.from("sync_logs").insert({
      sync_type: "b2b",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: items.length,
      records_synced: upserted,
      details: {
        ordersFound: orders.length,
        itemsExtracted: items.length,
        unitsInPeriod: totalUnits,
      },
      duration_ms: elapsed,
    });

    return NextResponse.json({
      success: true,
      status: "success",
      elapsed: `${elapsedSec}s`,
      ordersFound: orders.length,
      itemsExtracted: items.length,
      recordsUpserted: upserted,
      unitsInPeriod: totalUnits,
    });
  } catch (error) {
    console.error("B2B sync failed:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log failure (wrapped in try-catch to not fail if logging fails)
    const elapsed = Date.now() - startTime;
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "b2b",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      // Don't fail the main operation if logging fails, but do log it
      console.error("[B2B SYNC] Failed to log sync failure to sync_logs:", logError);
    }

    return NextResponse.json(
      {
        success: false,
        status: "failed",
        error: errorMessage,
      },
      { status: 500 }
    );
  } finally {
    // Always release the lock
    await releaseCronLock(supabase, LOCK_NAME);
  }
}
