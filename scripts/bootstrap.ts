/**
 * Bootstrap Script - Import existing Shopify orders into Supabase
 *
 * Run with: npx tsx scripts/bootstrap.ts
 *
 * Requires environment variables:
 * - SHOPIFY_STORE_URL
 * - SHOPIFY_ADMIN_TOKEN
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// Configuration
const DAYS_TO_IMPORT = 60; // Import orders from last 60 days
const BATCH_SIZE = 250; // Shopify GraphQL limit

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Shopify GraphQL query
const ORDERS_QUERY = `
  query GetOrders($cursor: String, $query: String!) {
    orders(first: ${BATCH_SIZE}, after: $cursor, query: $query) {
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

async function fetchShopifyOrders(): Promise<ShopifyOrderNode[]> {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!storeUrl || !token) {
    throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN");
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_IMPORT);
  const query = `created_at:>${cutoffDate.toISOString().split("T")[0]}`;

  const allOrders: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;

  console.log(`Fetching orders from last ${DAYS_TO_IMPORT} days...`);

  while (hasNextPage) {
    pageCount++;
    console.log(`Fetching page ${pageCount}...`);

    const response: Response = await fetch(
      `https://${storeUrl}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: ORDERS_QUERY,
          variables: { cursor, query },
        }),
      }
    );

    if (!response.ok) {
      const text: string = await response.text();
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

    // Respect rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`Fetched ${allOrders.length} orders total`);
  return allOrders;
}

function extractWarehouse(tags: string[]): string | null {
  const tagList = tags.map((t) => t.toLowerCase().trim());
  if (tagList.includes("smithey")) return "smithey";
  if (tagList.includes("selery")) return "selery";
  return null;
}

function parseShopifyGid(gid: string): number {
  // gid://shopify/Order/12345 -> 12345
  const parts = gid.split("/");
  return parseInt(parts[parts.length - 1], 10);
}

function mapFulfillmentStatus(
  status: string | null
): "partial" | "fulfilled" | null {
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

async function importOrders(orders: ShopifyOrderNode[]) {
  console.log(`\nImporting ${orders.length} orders to Supabase...`);

  let successCount = 0;
  let errorCount = 0;

  for (const order of orders) {
    try {
      const orderId = parseShopifyGid(order.id);
      const warehouse = extractWarehouse(order.tags);
      const fulfillmentStatus = mapFulfillmentStatus(order.displayFulfillmentStatus);
      const fulfilledAt = calculateFulfilledAt(
        order.displayFulfillmentStatus,
        order.fulfillments
      );

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
        console.error(`Error upserting order ${order.name}:`, orderError);
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
          console.error(
            `Error upserting line items for ${order.name}:`,
            lineItemsError
          );
          errorCount++;
          continue;
        }
      }

      successCount++;

      // Progress indicator
      if (successCount % 100 === 0) {
        console.log(`Progress: ${successCount}/${orders.length}`);
      }
    } catch (err) {
      console.error(`Error processing order ${order.name}:`, err);
      errorCount++;
    }
  }

  console.log(`\nImport complete!`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
}

async function main() {
  console.log("=".repeat(50));
  console.log("Smithey Warehouse - Bootstrap Import");
  console.log("=".repeat(50));

  // Check environment
  const required = [
    "SHOPIFY_STORE_URL",
    "SHOPIFY_ADMIN_TOKEN",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`\nMissing environment variables: ${missing.join(", ")}`);
    console.error("Please set these in .env.local or your environment");
    process.exit(1);
  }

  try {
    const orders = await fetchShopifyOrders();
    await importOrders(orders);
  } catch (err) {
    console.error("\nFatal error:", err);
    process.exit(1);
  }
}

main();
