import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

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

async function findMissingOrders() {
  console.log("=== FINDING MISSING ORDERS ===\n");

  // Get all order numbers from Shopify for Dec 1+
  const shopifyOrders = new Map<string, { castIron: number; date: string }>();

  const query = `
    query($cursor: String) {
      orders(first: 250, after: $cursor, query: "created_at:>=2025-12-01 -status:cancelled") {
        edges {
          node {
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

  console.log("Fetching Shopify orders...");
  while (hasMore) {
    const result = await shopifyGraphQL(query, { cursor });
    if (result.errors) {
      console.error("Shopify errors:", result.errors);
      break;
    }

    const orders = result.data?.orders;
    for (const edge of orders?.edges || []) {
      const order = edge.node;
      let castIron = 0;

      for (const lineEdge of order.lineItems?.edges || []) {
        const sku = lineEdge.node.sku?.toLowerCase() || "";
        if (castIronSkus.includes(sku)) {
          castIron += lineEdge.node.quantity || 0;
        }
      }

      if (castIron > 0) {
        shopifyOrders.set(order.name, { castIron, date: order.createdAt });
      }
    }

    hasMore = orders?.pageInfo?.hasNextPage || false;
    cursor = orders?.pageInfo?.endCursor;
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`Found ${shopifyOrders.size} Shopify orders with cast iron\n`);

  // Get all order numbers from Supabase for Dec 1+
  const { data: supabaseOrders } = await supabase
    .from("orders")
    .select("order_name")
    .gte("created_at", "2025-12-01T00:00:00.000Z")
    .lte("created_at", "2025-12-09T23:59:59.999Z")
    .eq("canceled", false);

  const supabaseOrderSet = new Set(
    (supabaseOrders || []).map(o => o.order_name)
  );

  console.log(`Found ${supabaseOrderSet.size} Supabase orders\n`);

  // Find orders in Shopify but not in Supabase
  let missingCount = 0;
  let missingCastIron = 0;
  const missingOrders: Array<{ name: string; castIron: number; date: string }> = [];

  for (const [orderName, data] of shopifyOrders) {
    if (!supabaseOrderSet.has(orderName)) {
      missingCount++;
      missingCastIron += data.castIron;
      missingOrders.push({ name: orderName, ...data });
    }
  }

  console.log("=== MISSING ORDERS (in Shopify but not Supabase) ===");
  console.log(`Count: ${missingCount}`);
  console.log(`Cast Iron units: ${missingCastIron}\n`);

  if (missingOrders.length > 0) {
    console.log("Sample missing orders:");
    missingOrders.slice(0, 20).forEach(o => {
      const date = new Date(o.date).toLocaleString("en-US", { timeZone: "America/New_York" });
      console.log(`  ${o.name}: ${o.castIron} cast iron (${date})`);
    });
  }

  // Also check: orders in Supabase but not in Shopify (cancelled?)
  const shopifyOrderSet = new Set(shopifyOrders.keys());
  let extraCount = 0;

  for (const orderNum of supabaseOrderSet) {
    if (orderNum && !shopifyOrderSet.has(orderNum)) {
      extraCount++;
    }
  }

  console.log(`\n=== EXTRA ORDERS (in Supabase but not Shopify active) ===`);
  console.log(`Count: ${extraCount}`);
  console.log("(These might be cancelled orders in Shopify)");
}

findMissingOrders().catch(console.error);
