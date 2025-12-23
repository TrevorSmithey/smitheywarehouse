import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function shopifyGraphQL(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(
    `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  return response.json();
}

async function main() {
  console.log("=== FINDING MISSING ORDERS ===\n");

  // Get recent unfulfilled order IDs from Shopify
  const query = `
    query($cursor: String) {
      orders(first: 250, after: $cursor, query: "fulfillment_status:unfulfilled created_at:>=2025-09-01") {
        edges {
          node {
            id
            name
            createdAt
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const shopifyOrderIds: number[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  console.log("Fetching unfulfilled from Shopify (since Sept 1, 2025)...");
  while (hasMore) {
    const result = await shopifyGraphQL(query, { cursor });
    const orders = result.data?.orders;

    for (const edge of orders?.edges || []) {
      // Parse GID: gid://shopify/Order/12345 -> 12345
      const gid = edge.node.id;
      const id = parseInt(gid.split("/").pop()!, 10);
      shopifyOrderIds.push(id);
    }

    hasMore = orders?.pageInfo?.hasNextPage || false;
    cursor = orders?.pageInfo?.endCursor;
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`Found ${shopifyOrderIds.length} unfulfilled orders in Shopify (Dec 2025)`);

  // Check which ones exist in Supabase (batch to avoid URL length limits)
  const supabaseIds = new Set<number>();
  const batchSize = 100;

  for (let i = 0; i < shopifyOrderIds.length; i += batchSize) {
    const batch = shopifyOrderIds.slice(i, i + batchSize);
    const { data: supabaseOrders, error } = await supabase
      .from("orders")
      .select("id, order_name")
      .in("id", batch);

    if (error) {
      console.error(`Supabase error at batch ${i}:`, error);
      continue;
    }

    for (const o of supabaseOrders || []) {
      supabaseIds.add(o.id);
    }
  }

  const missing = shopifyOrderIds.filter(id => !supabaseIds.has(id));

  console.log(`Found ${supabaseIds.size} of those in Supabase`);
  console.log(`Missing from Supabase: ${missing.length}`);

  if (missing.length > 0) {
    console.log("\nMissing order IDs (first 20):");
    for (const id of missing.slice(0, 20)) {
      console.log(`  - ${id}`);
    }
  }

  // Check what status these orders have in Supabase
  console.log("\n--- Status check in Supabase for orders we DO have ---");
  const { data: statusCheck } = await supabase
    .from("orders")
    .select("fulfillment_status, canceled")
    .in("id", shopifyOrderIds.slice(0, 100));

  let nullCount = 0, partialCount = 0, fulfilledCount = 0, canceledCount = 0;
  for (const order of statusCheck || []) {
    if (order.canceled) canceledCount++;
    else if (order.fulfillment_status === null) nullCount++;
    else if (order.fulfillment_status === "partial") partialCount++;
    else if (order.fulfillment_status === "fulfilled") fulfilledCount++;
  }

  console.log(`  Unfulfilled (null): ${nullCount}`);
  console.log(`  Partial: ${partialCount}`);
  console.log(`  Fulfilled: ${fulfilledCount}`);
  console.log(`  Canceled: ${canceledCount}`);
}

main().catch(console.error);
