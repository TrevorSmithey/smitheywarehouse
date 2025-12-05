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
  console.log("=== STATUS MISMATCH INVESTIGATION ===\n");

  // Get unfulfilled orders from Shopify that are NOT unfulfilled in Supabase
  const query = `
    query($cursor: String) {
      orders(first: 100, after: $cursor, query: "fulfillment_status:unfulfilled created_at:>=2025-09-01 created_at:<2025-12-01") {
        edges {
          node {
            id
            name
            createdAt
            displayFulfillmentStatus
            cancelledAt
            tags
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  // Get a sample of 100 unfulfilled orders from before December
  const result = await shopifyGraphQL(query, { cursor: null });
  const shopifyOrders = result.data?.orders?.edges || [];

  console.log(`Fetched ${shopifyOrders.length} unfulfilled orders from Shopify (Sept-Nov)\n`);

  // Get their status in Supabase
  const orderIds = shopifyOrders.map((edge: { node: { id: string } }) => {
    const gid = edge.node.id;
    return parseInt(gid.split("/").pop()!, 10);
  });

  const { data: supabaseOrders, error } = await supabase
    .from("orders")
    .select("id, order_name, fulfillment_status, canceled")
    .in("id", orderIds);

  if (error) {
    console.error("Supabase error:", error);
    return;
  }

  // Create map for easy lookup
  const supabaseMap = new Map(
    (supabaseOrders || []).map((o) => [o.id, o])
  );

  // Categorize mismatches
  let fulfilledInSupabase = 0;
  let canceledInSupabase = 0;
  let matchingUnfulfilled = 0;
  let partialInSupabase = 0;
  let notFound = 0;

  const examples = {
    fulfilled: [] as string[],
    canceled: [] as string[],
  };

  for (const edge of shopifyOrders) {
    const gid = edge.node.id;
    const id = parseInt(gid.split("/").pop()!, 10);
    const name = edge.node.name;
    const supabaseOrder = supabaseMap.get(id);

    if (!supabaseOrder) {
      notFound++;
      continue;
    }

    if (supabaseOrder.canceled) {
      canceledInSupabase++;
      if (examples.canceled.length < 5) {
        examples.canceled.push(`${name} (Shopify: unfulfilled, Supabase: canceled)`);
      }
    } else if (supabaseOrder.fulfillment_status === "fulfilled") {
      fulfilledInSupabase++;
      if (examples.fulfilled.length < 5) {
        examples.fulfilled.push(`${name} (Shopify: unfulfilled, Supabase: fulfilled)`);
      }
    } else if (supabaseOrder.fulfillment_status === "partial") {
      partialInSupabase++;
    } else {
      matchingUnfulfilled++;
    }
  }

  console.log("=== MISMATCH SUMMARY (sample of 100 orders from Sept-Nov) ===");
  console.log(`Matching (unfulfilled in both): ${matchingUnfulfilled}`);
  console.log(`Fulfilled in Supabase but unfulfilled in Shopify: ${fulfilledInSupabase}`);
  console.log(`Canceled in Supabase but unfulfilled in Shopify: ${canceledInSupabase}`);
  console.log(`Partial in Supabase: ${partialInSupabase}`);
  console.log(`Not found in Supabase: ${notFound}`);

  if (examples.fulfilled.length > 0) {
    console.log("\n--- Example Fulfilled Mismatches ---");
    examples.fulfilled.forEach((e) => console.log(`  ${e}`));
  }

  if (examples.canceled.length > 0) {
    console.log("\n--- Example Canceled Mismatches ---");
    examples.canceled.forEach((e) => console.log(`  ${e}`));
  }

  // Let's also verify a specific order in Shopify
  if (examples.fulfilled.length > 0 || examples.canceled.length > 0) {
    console.log("\n=== INVESTIGATING FIRST MISMATCH ===");
    const firstMismatch = examples.fulfilled[0] || examples.canceled[0];
    const orderName = firstMismatch.split(" ")[0];

    const verifyQuery = `
      query {
        orders(first: 1, query: "name:${orderName}") {
          edges {
            node {
              id
              name
              createdAt
              displayFulfillmentStatus
              cancelledAt
              fullyPaid
              fulfillments {
                createdAt
                status
              }
            }
          }
        }
      }
    `;

    const verifyResult = await shopifyGraphQL(verifyQuery);
    const order = verifyResult.data?.orders?.edges?.[0]?.node;

    if (order) {
      console.log(`Order: ${order.name}`);
      console.log(`Shopify Status: ${order.displayFulfillmentStatus}`);
      console.log(`Shopify Cancelled: ${order.cancelledAt || "No"}`);
      console.log(`Fulfillments: ${JSON.stringify(order.fulfillments)}`);
    }
  }
}

main().catch(console.error);
