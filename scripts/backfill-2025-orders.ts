/**
 * Backfill Missing 2025 Orders
 *
 * Fetches ALL orders from Shopify for 2025 and inserts any missing ones into Supabase.
 * This fills the gap where webhooks may have missed orders.
 *
 * Run with: npx tsx scripts/backfill-2025-orders.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 250;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// GraphQL query - fetches ALL order data needed
const ORDERS_QUERY = `
  query GetOrders($cursor: String, $query: String!) {
    orders(first: ${BATCH_SIZE}, after: $cursor, query: $query, sortKey: CREATED_AT) {
      edges {
        node {
          id
          name
          tags
          createdAt
          cancelledAt
          displayFulfillmentStatus
          fulfillments(first: 50) {
            createdAt
            trackingInfo(first: 10) {
              number
              company
            }
            fulfillmentLineItems(first: 100) {
              edges {
                node {
                  lineItem {
                    id
                  }
                  quantity
                }
              }
            }
          }
          lineItems(first: 100) {
            edges {
              node {
                id
                sku
                title
                quantity
                fulfillableQuantity
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

interface GraphQLResponse {
  data?: {
    orders: {
      edges: Array<{ node: ShopifyOrderNode }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  errors?: Array<{ message: string }>;
  extensions?: {
    cost: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

interface ShopifyOrderNode {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string | null;
  fulfillments: {
    createdAt: string;
    trackingInfo: Array<{
      number: string;
      company: string | null;
    }>;
    fulfillmentLineItems: {
      edges: Array<{
        node: {
          lineItem: { id: string };
          quantity: number;
        };
      }>;
    };
  }[];
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        title: string;
        quantity: number;
        fulfillableQuantity: number;
      };
    }>;
  };
}

function parseShopifyGid(gid: string): number {
  const parts = gid.split("/");
  return parseInt(parts[parts.length - 1], 10);
}

function extractWarehouse(tags: string[]): string | null {
  const tagList = tags.map((t) => t.toLowerCase().trim());
  if (tagList.includes("smithey")) return "smithey";
  if (tagList.includes("selery")) return "selery";
  return null;
}

function mapFulfillmentStatus(status: string | null): "partial" | "fulfilled" | null {
  if (!status) return null;
  const lower = status.toLowerCase();
  if (lower === "fulfilled") return "fulfilled";
  if (lower === "partial" || lower === "partially_fulfilled") return "partial";
  return null;
}

function calculateFulfilledAt(
  status: string | null,
  fulfillments: ShopifyOrderNode["fulfillments"]
): string | null {
  if (status?.toLowerCase() !== "fulfilled" || !fulfillments?.length) {
    return null;
  }
  const dates = fulfillments.map((f) => new Date(f.createdAt).getTime());
  const mostRecent = Math.max(...dates);
  return new Date(mostRecent).toISOString();
}

async function fetchAllOrders(startDate: string, endDate: string): Promise<ShopifyOrderNode[]> {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!storeUrl || !token) {
    throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN");
  }

  const allOrders: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;

  // Query for ALL orders in the date range (no fulfillment status filter)
  const queryStr = `created_at:>=${startDate} created_at:<=${endDate}`;
  console.log(`Query: ${queryStr}`);

  while (hasNextPage) {
    pageCount++;

    const response = await fetch(
      `https://${storeUrl}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: ORDERS_QUERY,
          variables: { cursor, query: queryStr },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify API error: ${response.status} - ${text}`);
    }

    const data: GraphQLResponse = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    if (!data.data) {
      throw new Error("No data returned from Shopify");
    }

    const orders = data.data.orders;
    const nodes = orders.edges.map((e) => e.node);
    allOrders.push(...nodes);

    hasNextPage = orders.pageInfo.hasNextPage;
    cursor = orders.pageInfo.endCursor;

    // Progress logging
    if (pageCount % 10 === 0) {
      console.log(`  Page ${pageCount}: ${allOrders.length} orders fetched...`);
    }

    // Respect rate limits - check throttle status if available
    const throttle = data.extensions?.cost?.throttleStatus;
    if (throttle && throttle.currentlyAvailable < 500) {
      // Low on credits, wait longer
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  console.log(`Fetched ${allOrders.length} total orders from Shopify (${pageCount} pages)`);
  return allOrders;
}

async function getExistingOrderIds(): Promise<Set<number>> {
  console.log("Fetching existing order IDs from Supabase...");

  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .gte("created_at", "2025-01-01T00:00:00Z");

  if (error) {
    throw new Error(`Failed to fetch existing orders: ${error.message}`);
  }

  const ids = new Set(data?.map((o) => o.id) || []);
  console.log(`Found ${ids.size} existing 2025 orders in database`);
  return ids;
}

async function upsertOrders(orders: ShopifyOrderNode[], existingIds: Set<number>) {
  const missing = orders.filter((o) => !existingIds.has(parseShopifyGid(o.id)));
  console.log(`\nFound ${missing.length} missing orders to insert`);

  if (missing.length === 0) {
    console.log("No missing orders to backfill!");
    return;
  }

  let successCount = 0;
  let errorCount = 0;
  let shipmentCount = 0;

  // Process in batches for database efficiency
  const UPSERT_BATCH = 100;

  for (let i = 0; i < missing.length; i += UPSERT_BATCH) {
    const batch = missing.slice(i, i + UPSERT_BATCH);

    for (const order of batch) {
      try {
        const orderId = parseShopifyGid(order.id);
        const warehouse = extractWarehouse(order.tags);
        const fulfillmentStatus = mapFulfillmentStatus(order.displayFulfillmentStatus);
        const fulfilledAt = calculateFulfilledAt(order.displayFulfillmentStatus, order.fulfillments);

        // Build fulfilled quantities map
        const fulfilledQuantities = new Map<number, number>();
        for (const fulfillment of order.fulfillments || []) {
          for (const edge of fulfillment.fulfillmentLineItems?.edges || []) {
            const lineItemId = parseShopifyGid(edge.node.lineItem.id);
            const current = fulfilledQuantities.get(lineItemId) || 0;
            fulfilledQuantities.set(lineItemId, current + edge.node.quantity);
          }
        }

        // Upsert order
        const { error: orderError } = await supabase.from("orders").upsert(
          {
            id: orderId,
            order_name: order.name,
            warehouse,
            fulfillment_status: fulfillmentStatus,
            canceled: !!order.cancelledAt,
            created_at: order.createdAt,
            fulfilled_at: fulfilledAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );

        if (orderError) {
          console.error(`Error upserting order ${order.name}:`, orderError.message);
          errorCount++;
          continue;
        }

        // Upsert line items
        const lineItems = order.lineItems.edges.map((edge) => {
          const lineItemId = parseShopifyGid(edge.node.id);
          return {
            id: lineItemId,
            order_id: orderId,
            sku: edge.node.sku,
            title: edge.node.title,
            quantity: edge.node.quantity,
            fulfilled_quantity: fulfilledQuantities.get(lineItemId) || 0,
          };
        });

        if (lineItems.length > 0) {
          const { error: lineItemsError } = await supabase
            .from("line_items")
            .upsert(lineItems, { onConflict: "id" });

          if (lineItemsError) {
            console.error(`Error upserting line items for ${order.name}:`, lineItemsError.message);
            errorCount++;
            continue;
          }
        }

        // Upsert shipments if any
        for (const fulfillment of order.fulfillments || []) {
          for (const tracking of fulfillment.trackingInfo || []) {
            if (!tracking.number) continue;

            const { error: shipmentError } = await supabase.from("shipments").upsert(
              {
                order_id: orderId,
                tracking_number: tracking.number,
                carrier: tracking.company || null,
                shipped_at: fulfillment.createdAt,
                status: "in_transit",
              },
              { onConflict: "order_id,tracking_number" }
            );

            if (!shipmentError) {
              shipmentCount++;
            }
          }
        }

        successCount++;
      } catch (err) {
        console.error(`Error processing order ${order.name}:`, err);
        errorCount++;
      }
    }

    // Progress update
    const processed = Math.min(i + UPSERT_BATCH, missing.length);
    console.log(`Progress: ${processed}/${missing.length} (${successCount} success, ${errorCount} errors)`);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`BACKFILL COMPLETE`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Orders inserted: ${successCount}`);
  console.log(`Shipments added: ${shipmentCount}`);
  console.log(`Errors: ${errorCount}`);
}

async function main() {
  console.log("=".repeat(60));
  console.log("BACKFILL 2025 ORDERS");
  console.log("=".repeat(60));

  // Verify environment
  const required = [
    "SHOPIFY_STORE_URL",
    "SHOPIFY_ADMIN_TOKEN",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`Store: ${process.env.SHOPIFY_STORE_URL}`);

  try {
    // Step 1: Get existing order IDs from Supabase
    const existingIds = await getExistingOrderIds();

    // Step 2: Fetch ALL 2025 orders from Shopify
    console.log("\nFetching ALL 2025 orders from Shopify...");
    const orders = await fetchAllOrders("2025-01-01", "2025-12-31");

    // Step 3: Insert missing orders
    await upsertOrders(orders, existingIds);

    // Step 4: Final verification
    console.log("\n--- VERIFICATION ---");
    const { count: finalCount } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .gte("created_at", "2025-01-01T00:00:00Z")
      .lt("created_at", "2026-01-01T00:00:00Z");

    console.log(`Final 2025 order count in database: ${finalCount}`);
    console.log(`Shopify 2025 order count: ${orders.length}`);

    if (finalCount === orders.length) {
      console.log("\n✅ SUCCESS: Database matches Shopify!");
    } else {
      console.log(`\n⚠️  Difference: ${orders.length - (finalCount || 0)} orders`);
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    process.exit(1);
  }
}

main();
