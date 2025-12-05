import { config } from "dotenv";
config({ path: ".env.local" });

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

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

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status}`);
  }

  return response.json();
}

async function main() {
  console.log("=== SHOPIFY VERIFICATION ===\n");

  // Get unfulfilled order count directly from Shopify
  const unfulfilledQuery = `
    query {
      orders(first: 1, query: "fulfillment_status:unfulfilled created_at:>=2025-09-01") {
        pageInfo {
          hasNextPage
        }
      }
      ordersCount(query: "fulfillment_status:unfulfilled created_at:>=2025-09-01") {
        count
      }
    }
  `;

  const partialQuery = `
    query {
      ordersCount(query: "fulfillment_status:partial created_at:>=2025-09-01") {
        count
      }
    }
  `;

  const fulfilledQuery = `
    query {
      ordersCount(query: "fulfillment_status:shipped created_at:>=2025-09-01") {
        count
      }
    }
  `;

  try {
    const [unfulfilledResult, partialResult, fulfilledResult] = await Promise.all([
      shopifyGraphQL(unfulfilledQuery),
      shopifyGraphQL(partialQuery),
      shopifyGraphQL(fulfilledQuery),
    ]);

    console.log("Shopify counts (since Sept 1, 2025):");
    console.log("  Unfulfilled:", unfulfilledResult.data?.ordersCount?.count);
    console.log("  Partial:", partialResult.data?.ordersCount?.count);
    console.log("  Fulfilled:", fulfilledResult.data?.ordersCount?.count);

    // Get unfulfilled with smithey tag
    const smitheyUnfulfilledQuery = `
      query {
        ordersCount(query: "fulfillment_status:unfulfilled tag:smithey created_at:>=2025-09-01") {
          count
        }
      }
    `;
    const seleryUnfulfilledQuery = `
      query {
        ordersCount(query: "fulfillment_status:unfulfilled tag:selery created_at:>=2025-09-01") {
          count
        }
      }
    `;

    const [smitheyResult, seleryResult] = await Promise.all([
      shopifyGraphQL(smitheyUnfulfilledQuery),
      shopifyGraphQL(seleryUnfulfilledQuery),
    ]);

    console.log("\nUnfulfilled by warehouse:");
    console.log("  Smithey:", smitheyResult.data?.ordersCount?.count);
    console.log("  Selery:", seleryResult.data?.ordersCount?.count);

    // Get most recent orders
    const recentQuery = `
      query {
        orders(first: 5, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              name
              createdAt
              displayFulfillmentStatus
              tags
            }
          }
        }
      }
    `;

    const recentResult = await shopifyGraphQL(recentQuery);
    console.log("\nMost recent orders in Shopify:");
    for (const edge of recentResult.data?.orders?.edges || []) {
      const order = edge.node;
      console.log(`  ${order.name} | ${order.displayFulfillmentStatus} | ${order.createdAt} | tags: ${order.tags?.slice(0, 50)}...`);
    }

  } catch (error) {
    console.error("Error querying Shopify:", error);
  }
}

main();
