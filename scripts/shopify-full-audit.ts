import { config } from "dotenv";
config({ path: ".env.local" });

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const SHOPIFY_B2B_URL = process.env.SHOPIFY_B2B_STORE_URL!;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN!;

async function shopifyGraphQL(url: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(
    `https://${url}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
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

async function countFromShopify(storeUrl: string, token: string, storeName: string, queryFilter: string) {
  const query = `
    query($cursor: String) {
      orders(first: 250, after: $cursor, query: "${queryFilter}") {
        edges {
          node {
            id
            name
            createdAt
            cancelledAt
            displayFinancialStatus
            lineItems(first: 100) {
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

  let orderCount = 0;
  let castIron = 0;
  let cancelledCI = 0;
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const result = await shopifyGraphQL(storeUrl, token, query, { cursor });

    if (result.errors) {
      console.error(`  Shopify errors:`, result.errors);
      break;
    }

    const orders = result.data?.orders;

    for (const edge of orders?.edges || []) {
      const order = edge.node;
      orderCount++;
      const isCancelled = !!order.cancelledAt;

      for (const lineEdge of order.lineItems?.edges || []) {
        const sku = lineEdge.node.sku?.toLowerCase() || "";
        const qty = lineEdge.node.quantity || 0;

        if (castIronSkus.includes(sku)) {
          if (isCancelled) {
            cancelledCI += qty;
          } else {
            castIron += qty;
          }
        }
      }
    }

    hasMore = orders?.pageInfo?.hasNextPage || false;
    cursor = orders?.pageInfo?.endCursor;
    await new Promise(r => setTimeout(r, 100));
  }

  return { orderCount, castIron, cancelledCI };
}

async function main() {
  console.log("=== FULL SHOPIFY AUDIT ===\n");

  // Test different date ranges and filters
  const tests = [
    { name: "Dec 1+ (no filter)", filter: "created_at:>=2025-12-01" },
    { name: "Dec 1+ paid only", filter: "created_at:>=2025-12-01 financial_status:paid" },
    { name: "Dec 1+ not cancelled", filter: "created_at:>=2025-12-01 -status:cancelled" },
    { name: "Nov 30+ (wider range)", filter: "created_at:>=2025-11-30" },
  ];

  console.log(">>> D2C STORE (smithey-ironware):");
  for (const test of tests) {
    console.log(`\n  ${test.name}:`);
    const result = await countFromShopify(SHOPIFY_STORE_URL, SHOPIFY_ADMIN_TOKEN, "D2C", test.filter);
    console.log(`    Orders: ${result.orderCount}`);
    console.log(`    Cast Iron (active): ${result.castIron}`);
    console.log(`    Cast Iron (cancelled): ${result.cancelledCI}`);
  }

  console.log("\n\n>>> B2B STORE (wholesale-smithey):");
  for (const test of tests) {
    console.log(`\n  ${test.name}:`);
    const result = await countFromShopify(SHOPIFY_B2B_URL, SHOPIFY_B2B_TOKEN, "B2B", test.filter);
    console.log(`    Orders: ${result.orderCount}`);
    console.log(`    Cast Iron (active): ${result.castIron}`);
    console.log(`    Cast Iron (cancelled): ${result.cancelledCI}`);
  }

  // Final totals with widest range
  console.log("\n\n>>> CALCULATING TOTALS (Nov 30+, no filter):");
  const d2c = await countFromShopify(SHOPIFY_STORE_URL, SHOPIFY_ADMIN_TOKEN, "D2C", "created_at:>=2025-11-30");
  const b2b = await countFromShopify(SHOPIFY_B2B_URL, SHOPIFY_B2B_TOKEN, "B2B", "created_at:>=2025-11-30");

  console.log(`  D2C Cast Iron: ${d2c.castIron}`);
  console.log(`  B2B Cast Iron: ${b2b.castIron}`);
  console.log(`  TOTAL: ${d2c.castIron + b2b.castIron}`);
  console.log(`\n>>> User's Excel: 15,336`);
  console.log(`>>> Gap: ${15336 - (d2c.castIron + b2b.castIron)}`);
}

main().catch(console.error);
