import { config } from "dotenv";
config({ path: ".env.local" });

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || "";
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";

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

const castIronSkus = [
  "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
  "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
  "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
  "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
  "smith-ci-dual12", "smith-ci-sauce1"
];

async function checkTodayShopify() {
  console.log("=== TODAY'S SHOPIFY ORDERS (Dec 9) ===\n");

  const query = `
    query($cursor: String) {
      orders(first: 250, after: $cursor, query: "created_at:>=2025-12-09 -status:cancelled") {
        edges {
          node {
            id
            name
            createdAt
            lineItems(first: 50) {
              edges {
                node {
                  sku
                  quantity
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

  let cursor: string | null = null;
  let hasMore = true;
  let orderCount = 0;
  let castIronTotal = 0;
  const skuTotals: Record<string, number> = {};

  while (hasMore) {
    const result = await shopifyGraphQL(query, { cursor });

    if (result.errors) {
      console.error("Shopify errors:", result.errors);
      break;
    }

    const orders = result.data?.orders;

    for (const edge of orders?.edges || []) {
      const order = edge.node;
      orderCount++;

      for (const lineEdge of order.lineItems?.edges || []) {
        const sku = lineEdge.node.sku?.toLowerCase() || "";
        const qty = lineEdge.node.quantity || 0;

        if (castIronSkus.includes(sku)) {
          castIronTotal += qty;
          skuTotals[sku] = (skuTotals[sku] || 0) + qty;
        }
      }
    }

    hasMore = orders?.pageInfo?.hasNextPage || false;
    cursor = orders?.pageInfo?.endCursor;
    await new Promise(r => setTimeout(r, 100));
  }

  console.log("Shopify D2C orders today:", orderCount);
  console.log("Cast iron units today:", castIronTotal);
  console.log("\nTop SKUs today:");
  const sorted = Object.entries(skuTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [sku, qty] of sorted) {
    console.log(`  ${sku}: ${qty}`);
  }
}

checkTodayShopify().catch(console.error);
