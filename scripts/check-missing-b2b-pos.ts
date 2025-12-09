import { config } from "dotenv";
config({ path: ".env.local" });

const SHOPIFY_B2B_URL = process.env.SHOPIFY_B2B_STORE_URL || "";
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN || "";

async function shopifyGraphQL(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(
    `https://${SHOPIFY_B2B_URL}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  return response.json();
}

async function checkPOsInShopify() {
  const missingPOs = ["PO-11437", "PO-11443", "PO-11382", "PO-11498"];

  console.log("=== CHECKING POs IN B2B SHOPIFY ===\n");

  for (const po of missingPOs) {
    const query = `
      query {
        orders(first: 1, query: "name:${po}") {
          edges {
            node {
              id
              name
              createdAt
              displayFulfillmentStatus
              cancelledAt
              fulfillments {
                createdAt
                status
                fulfillmentLineItems(first: 50) {
                  edges {
                    node {
                      lineItem {
                        sku
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query);

    console.log(`>>> ${po}:`);
    if (result.errors) {
      console.log("   Error:", result.errors);
    } else if (result.data?.orders?.edges?.length > 0) {
      const order = result.data.orders.edges[0].node;
      console.log(`   Status: ${order.displayFulfillmentStatus}`);
      console.log(`   Cancelled: ${order.cancelledAt ? "YES" : "NO"}`);
      console.log(`   Fulfillments: ${order.fulfillments?.length || 0}`);

      for (const fulfillment of order.fulfillments || []) {
        console.log(`   - Fulfilled: ${fulfillment.createdAt?.split("T")[0]} (${fulfillment.status})`);
        for (const lineEdge of fulfillment.fulfillmentLineItems?.edges || []) {
          const li = lineEdge.node.lineItem;
          console.log(`     * ${li.sku}: ${li.quantity}`);
        }
      }
    } else {
      console.log("   NOT FOUND in Shopify B2B");
    }
    console.log("");
    await new Promise(r => setTimeout(r, 200));
  }
}

checkPOsInShopify().catch(console.error);
