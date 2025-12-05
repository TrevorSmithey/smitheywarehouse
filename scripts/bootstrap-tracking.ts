/**
 * Bootstrap Tracking Script - Import existing tracking data from Shopify
 *
 * Run with: npx tsx scripts/bootstrap-tracking.ts
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
// Only import from Nov 15, 2025 onwards to limit EasyPost API costs
const TRACKING_START_DATE = "2025-11-15";
const BATCH_SIZE = 250; // Shopify GraphQL limit

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Shopify GraphQL query for fulfilled orders with tracking
const FULFILLMENTS_QUERY = `
  query GetFulfillments($cursor: String, $query: String!) {
    orders(first: ${BATCH_SIZE}, after: $cursor, query: $query) {
      edges {
        node {
          id
          name
          tags
          fulfillments(first: 20) {
            id
            createdAt
            trackingInfo {
              number
              company
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
      edges: Array<{ node: OrderWithFulfillments }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

interface OrderWithFulfillments {
  id: string;
  name: string;
  tags: string[];
  fulfillments: {
    id: string;
    createdAt: string;
    trackingInfo: Array<{
      number: string | null;
      company: string | null;
    }>;
  }[];
}

interface ShipmentRecord {
  order_id: number;
  tracking_number: string;
  carrier: string | null;
  shipped_at: string;
  status: string;
}

async function fetchShopifyFulfillments(): Promise<OrderWithFulfillments[]> {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!storeUrl || !token) {
    throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN");
  }

  // Only get fulfilled orders from Nov 15+ to limit EasyPost costs
  const query = `created_at:>${TRACKING_START_DATE} fulfillment_status:shipped`;

  const allOrders: OrderWithFulfillments[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;

  console.log(`Fetching fulfilled orders from ${TRACKING_START_DATE} onwards...`);

  while (hasNextPage) {
    pageCount++;
    console.log(`Fetching page ${pageCount}...`);

    const response = await fetch(
      `https://${storeUrl}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: FULFILLMENTS_QUERY,
          variables: { cursor, query },
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

    // Respect rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`Fetched ${allOrders.length} fulfilled orders`);
  return allOrders;
}

function parseShopifyGid(gid: string): number {
  const parts = gid.split("/");
  return parseInt(parts[parts.length - 1], 10);
}

function extractShipments(orders: OrderWithFulfillments[]): ShipmentRecord[] {
  const shipments: ShipmentRecord[] = [];

  for (const order of orders) {
    const orderId = parseShopifyGid(order.id);

    for (const fulfillment of order.fulfillments || []) {
      for (const tracking of fulfillment.trackingInfo || []) {
        if (!tracking.number) continue;

        shipments.push({
          order_id: orderId,
          tracking_number: tracking.number,
          carrier: tracking.company,
          shipped_at: fulfillment.createdAt,
          status: "in_transit", // Will be updated by tracking check
        });
      }
    }
  }

  return shipments;
}

async function importShipments(shipments: ShipmentRecord[]) {
  console.log(`\nImporting ${shipments.length} shipments to Supabase...`);

  // Filter out duplicates (same order + tracking combo)
  const uniqueShipments = new Map<string, ShipmentRecord>();
  for (const s of shipments) {
    const key = `${s.order_id}-${s.tracking_number}`;
    if (!uniqueShipments.has(key)) {
      uniqueShipments.set(key, s);
    }
  }

  const toImport = Array.from(uniqueShipments.values());
  console.log(`${toImport.length} unique shipments after deduplication`);

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  // Process in batches of 100
  const batchSize = 100;
  for (let i = 0; i < toImport.length; i += batchSize) {
    const batch = toImport.slice(i, i + batchSize);

    const { error } = await supabase
      .from("shipments")
      .upsert(batch, { onConflict: "order_id,tracking_number" });

    if (error) {
      // Check if it's a foreign key error (order doesn't exist)
      if (error.code === "23503") {
        // Insert individually to skip missing orders
        for (const shipment of batch) {
          const { error: singleError } = await supabase
            .from("shipments")
            .upsert(shipment, { onConflict: "order_id,tracking_number" });

          if (singleError) {
            if (singleError.code === "23503") {
              skippedCount++;
            } else {
              console.error(`Error importing shipment:`, singleError);
              errorCount++;
            }
          } else {
            successCount++;
          }
        }
      } else {
        console.error(`Error importing batch:`, error);
        errorCount += batch.length;
      }
    } else {
      successCount += batch.length;
    }

    // Progress indicator
    if ((i + batchSize) % 500 === 0 || i + batchSize >= toImport.length) {
      console.log(`Progress: ${Math.min(i + batchSize, toImport.length)}/${toImport.length}`);
    }
  }

  console.log(`\nImport complete!`);
  console.log(`Success: ${successCount}`);
  console.log(`Skipped (order not in DB): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
}

async function main() {
  console.log("=".repeat(50));
  console.log("Smithey Warehouse - Tracking Bootstrap");
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
    const orders = await fetchShopifyFulfillments();
    const shipments = extractShipments(orders);
    console.log(`\nExtracted ${shipments.length} tracking numbers`);

    if (shipments.length > 0) {
      await importShipments(shipments);
    } else {
      console.log("No tracking data to import");
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    process.exit(1);
  }
}

main();
