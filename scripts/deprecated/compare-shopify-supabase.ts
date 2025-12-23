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
  console.log("=== COMPARING SHOPIFY vs SUPABASE ===\n");

  const castIronSkus = [
    "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
    "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
    "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
    "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
    "smith-ci-dual12", "smith-ci-sauce1"
  ];

  // Query Shopify for December 2025 orders
  const query = `
    query($cursor: String) {
      orders(first: 250, after: $cursor, query: "created_at:>=2025-12-01 financial_status:paid") {
        edges {
          node {
            id
            name
            createdAt
            cancelledAt
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

  let shopifyOrderCount = 0;
  let shopifyCastIron = 0;
  let shopifyCancelledCI = 0;
  let cursor: string | null = null;
  let hasMore = true;

  console.log("Fetching December orders from Shopify...");
  while (hasMore) {
    const result = await shopifyGraphQL(query, { cursor });
    const orders = result.data?.orders;

    if (result.errors) {
      console.error("Shopify errors:", result.errors);
      break;
    }

    for (const edge of orders?.edges || []) {
      const order = edge.node;
      const isCancelled = !!order.cancelledAt;
      shopifyOrderCount++;

      for (const lineEdge of order.lineItems?.edges || []) {
        const sku = lineEdge.node.sku?.toLowerCase() || "";
        const qty = lineEdge.node.quantity || 0;

        if (castIronSkus.includes(sku)) {
          if (isCancelled) {
            shopifyCancelledCI += qty;
          } else {
            shopifyCastIron += qty;
          }
        }
      }
    }

    hasMore = orders?.pageInfo?.hasNextPage || false;
    cursor = orders?.pageInfo?.endCursor;
    await new Promise(r => setTimeout(r, 100));
    process.stdout.write(`\r  Processed ${shopifyOrderCount} orders...`);
  }

  console.log(`\n\n>>> SHOPIFY (Dec 2025, financial_status:paid):`);
  console.log(`   Orders: ${shopifyOrderCount}`);
  console.log(`   Cast Iron (non-cancelled): ${shopifyCastIron}`);
  console.log(`   Cast Iron (cancelled): ${shopifyCancelledCI}`);

  // Get Supabase counts
  const decStart = "2025-12-01T05:00:00.000Z";
  const decEnd = "2025-12-10T04:59:59.999Z";

  const { count: supabaseOrderCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", decStart)
    .eq("canceled", false);

  const { data: supabaseItems } = await supabase
    .from("line_items")
    .select("sku, quantity, orders!inner(created_at, canceled)")
    .gte("orders.created_at", decStart)
    .eq("orders.canceled", false)
    .limit(1000000);

  let supabaseCastIron = 0;
  for (const item of supabaseItems || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      supabaseCastIron += item.quantity || 0;
    }
  }

  console.log(`\n>>> SUPABASE (Dec 2025 EST):`);
  console.log(`   Orders: ${supabaseOrderCount}`);
  console.log(`   Cast Iron (non-cancelled): ${supabaseCastIron}`);

  console.log(`\n>>> COMPARISON:`);
  console.log(`   Order gap: ${shopifyOrderCount - (supabaseOrderCount || 0)}`);
  console.log(`   Cast Iron gap: ${shopifyCastIron - supabaseCastIron}`);
  console.log(`\n>>> User's Excel shows: 15,336`);
  console.log(`>>> Shopify shows: ${shopifyCastIron}`);
  console.log(`>>> Supabase shows: ${supabaseCastIron}`);
}

main().catch(console.error);
