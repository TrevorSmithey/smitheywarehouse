import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { SHOPIFY_API_VERSION, withRetry } from "@/lib/shopify";
import { SERVICE_SKUS } from "@/lib/constants";

const LOCK_NAME = "sync-b2b-drafts";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 1 minute - draft orders are quick to sync

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;

// GraphQL query for open draft orders
// Note: customer field removed - B2B token doesn't have read_customers scope
const DRAFT_ORDERS_QUERY = `
  query DraftOrders($cursor: String) {
    draftOrders(first: 100, query: "status:open", after: $cursor) {
      edges {
        node {
          id
          name
          createdAt
          lineItems(first: 100) {
            edges {
              node {
                sku
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface DraftOrderLineItem {
  sku: string | null;
  quantity: number;
  originalUnitPriceSet?: {
    shopMoney?: {
      amount: string;
    };
  };
}

interface DraftOrder {
  id: string; // GID format: gid://shopify/DraftOrder/123456
  name: string;
  createdAt: string;
  // Note: customer field intentionally omitted - B2B token lacks read_customers scope
  lineItems: {
    edges: Array<{
      node: DraftOrderLineItem;
    }>;
  };
}

interface B2BDraftItem {
  draft_order_id: number;
  draft_order_name: string;
  customer_name: string | null;
  sku: string;
  quantity: number;
  price: number | null;
  created_at: string;
  sync_batch_id?: string; // Added for atomic sync
}

// Extract numeric ID from Shopify GID
function extractId(gid: string): number {
  const match = gid.match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

async function fetchOpenDraftOrders(): Promise<DraftOrder[]> {
  const allDraftOrders: DraftOrder[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const { draftOrders } = await withRetry(
      async () => {
        const response = await fetch(
          `https://${SHOPIFY_B2B_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: DRAFT_ORDERS_QUERY,
              variables: { cursor },
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        if (!data.data) {
          throw new Error("GraphQL returned empty data");
        }

        return data.data;
      },
      { maxRetries: 3, baseDelayMs: 1000 },
      "B2B draft orders fetch"
    );

    const orders = draftOrders.edges.map((e: { node: DraftOrder }) => e.node);
    allDraftOrders.push(...orders);

    if (draftOrders.pageInfo.hasNextPage) {
      cursor = draftOrders.pageInfo.endCursor;
    } else {
      hasMore = false;
    }
  }

  return allDraftOrders;
}

function extractLineItems(draftOrders: DraftOrder[]): B2BDraftItem[] {
  const items: B2BDraftItem[] = [];

  for (const order of draftOrders) {
    const draftOrderId = extractId(order.id);

    for (const { node: lineItem } of order.lineItems.edges) {
      // Skip items without SKU
      if (!lineItem.sku) continue;

      // Skip service SKUs (uses centralized constant)
      if (SERVICE_SKUS.includes(lineItem.sku as typeof SERVICE_SKUS[number])) continue;

      const price = lineItem.originalUnitPriceSet?.shopMoney?.amount
        ? parseFloat(lineItem.originalUnitPriceSet.shopMoney.amount)
        : null;

      items.push({
        draft_order_id: draftOrderId,
        draft_order_name: order.name,
        customer_name: null, // Not available without read_customers scope
        sku: lineItem.sku,
        quantity: lineItem.quantity,
        price: price,
        created_at: order.createdAt,
      });
    }
  }

  return items;
}

async function syncDraftOrders(
  supabase: ReturnType<typeof createServiceClient>,
  items: B2BDraftItem[]
): Promise<number> {
  // Atomic sync using batch ID approach:
  // 1. Insert new data with unique batch ID
  // 2. Delete old data (different batch ID)
  // This ensures we never have an empty table state - if insert fails, old data remains
  const batchId = new Date().toISOString();

  // Dedupe items by draft_order_id + sku (combine quantities if same SKU appears multiple times)
  const deduped = new Map<string, B2BDraftItem>();
  for (const item of items) {
    const key = `${item.draft_order_id}|${item.sku}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      deduped.set(key, { ...item, sync_batch_id: batchId });
    }
  }
  const uniqueItems = Array.from(deduped.values());

  // Step 1: Insert new items with batch ID (even if empty - marks this batch as complete)
  if (uniqueItems.length > 0) {
    const { error: insertError } = await supabase
      .from("b2b_draft_orders")
      .insert(uniqueItems);

    if (insertError) {
      console.error("Failed to insert draft orders:", insertError);
      throw insertError;
    }
  }

  // Step 2: Delete old items (different batch ID OR null) - only after insert succeeds
  // This ensures we always have data in the table
  // Note: neq() doesn't match NULL values, so we need to explicitly include them
  const { error: deleteError } = await supabase
    .from("b2b_draft_orders")
    .delete()
    .or(`sync_batch_id.neq.${batchId},sync_batch_id.is.null`);

  if (deleteError) {
    // Log but don't fail - old data will be cleaned up next sync
    console.warn("Failed to clean up old draft orders:", deleteError);
  }

  return uniqueItems.length;
}

export async function GET(request: Request) {
  // Always verify cron secret
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[B2B DRAFTS] Skipping - another sync is in progress`);
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

    console.log("[B2B DRAFTS] Starting sync...");

    // Fetch open draft orders from Shopify
    const draftOrders = await fetchOpenDraftOrders();
    console.log(`Fetched ${draftOrders.length} open draft orders`);

    // Extract line items
    const items = extractLineItems(draftOrders);
    console.log(`Extracted ${items.length} line items`);

    // Sync to database (truncate + insert)
    const synced = await syncDraftOrders(supabase, items);

    const elapsed = Date.now() - startTime;
    const elapsedSec = (elapsed / 1000).toFixed(1);

    // Calculate totals
    const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
    const uniqueSkus = new Set(items.map(i => i.sku)).size;

    // Log sync result
    await supabase.from("sync_logs").insert({
      sync_type: "b2b_draft_orders",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: items.length,
      records_synced: synced,
      details: {
        draftOrdersFound: draftOrders.length,
        lineItemsExtracted: items.length,
        totalUnits,
        uniqueSkus,
      },
      duration_ms: elapsed,
    });

    return NextResponse.json({
      success: true,
      status: "success",
      elapsed: `${elapsedSec}s`,
      draftOrdersFound: draftOrders.length,
      lineItemsSynced: synced,
      totalUnits,
      uniqueSkus,
    });
  } catch (error) {
    console.error("B2B draft orders sync failed:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Send email alert
    await sendSyncFailureAlert({
      syncType: "B2B Draft Orders",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Log failure
    const elapsed = Date.now() - startTime;
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "b2b_draft_orders",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[B2B DRAFTS SYNC] Failed to log sync failure:", logError);
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
    // Always release the lock, even on error
    await releaseCronLock(supabase, LOCK_NAME);
  }
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
