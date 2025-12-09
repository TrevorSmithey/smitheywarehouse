import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const SHOPIFY_B2B_URL = process.env.SHOPIFY_B2B_STORE_URL!;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN!;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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

async function main() {
  console.log("=== CHECKING B2B SHOPIFY STORE ===\n");
  console.log(`Store: ${SHOPIFY_B2B_URL}\n`);

  const castIronSkus = [
    "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
    "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
    "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
    "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
    "smith-ci-dual12", "smith-ci-sauce1"
  ];

  // Query B2B Shopify for December 2025 orders
  const query = `
    query($cursor: String) {
      orders(first: 250, after: $cursor, query: "created_at:>=2025-12-01") {
        edges {
          node {
            id
            name
            createdAt
            cancelledAt
            displayFinancialStatus
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

  let b2bOrderCount = 0;
  let b2bCastIron = 0;
  let cursor: string | null = null;
  let hasMore = true;

  console.log("Fetching December orders from B2B Shopify...");
  while (hasMore) {
    const result = await shopifyGraphQL(query, { cursor });

    if (result.errors) {
      console.error("Shopify errors:", result.errors);
      break;
    }

    const orders = result.data?.orders;

    for (const edge of orders?.edges || []) {
      const order = edge.node;
      const isCancelled = !!order.cancelledAt;
      if (isCancelled) continue;

      b2bOrderCount++;

      for (const lineEdge of order.lineItems?.edges || []) {
        const sku = lineEdge.node.sku?.toLowerCase() || "";
        const qty = lineEdge.node.quantity || 0;

        if (castIronSkus.includes(sku)) {
          b2bCastIron += qty;
        }
      }
    }

    hasMore = orders?.pageInfo?.hasNextPage || false;
    cursor = orders?.pageInfo?.endCursor;
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n>>> B2B SHOPIFY (Dec 2025):`);
  console.log(`   Orders: ${b2bOrderCount}`);
  console.log(`   Cast Iron: ${b2bCastIron}`);

  // Check what's in b2b_fulfilled table
  const decStart = "2025-12-01T05:00:00.000Z";
  const { data: b2bFulfilled } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", decStart)
    .limit(100000);

  let supabaseB2BCastIron = 0;
  for (const item of b2bFulfilled || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      supabaseB2BCastIron += item.quantity || 0;
    }
  }

  console.log(`\n>>> SUPABASE b2b_fulfilled (Dec 2025):`);
  console.log(`   Cast Iron: ${supabaseB2BCastIron}`);
  console.log(`\n>>> B2B Gap: ${b2bCastIron - supabaseB2BCastIron}`);

  // Now calculate total
  const { data: retailItems } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", decStart)
    .eq("orders.canceled", false)
    .limit(1000000);

  let retailCastIron = 0;
  for (const item of retailItems || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      retailCastIron += item.quantity || 0;
    }
  }

  console.log(`\n>>> TOTAL CALCULATION:`);
  console.log(`   D2C Retail (Supabase): ${retailCastIron}`);
  console.log(`   B2B (Shopify direct): ${b2bCastIron}`);
  console.log(`   TOTAL: ${retailCastIron + b2bCastIron}`);
  console.log(`\n>>> User's Excel: 15,336`);
  console.log(`>>> Gap: ${15336 - (retailCastIron + b2bCastIron)}`);
}

main().catch(console.error);
