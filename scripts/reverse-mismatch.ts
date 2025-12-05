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
  console.log("=== REVERSE MISMATCH INVESTIGATION ===");
  console.log("Finding orders unfulfilled in Supabase but fulfilled in Shopify\n");

  // Get a sample of unfulfilled orders from Supabase (Sept-Nov)
  const { data: supabaseOrders, error } = await supabase
    .from("orders")
    .select("id, order_name, fulfillment_status, canceled, created_at")
    .is("fulfillment_status", null)
    .eq("canceled", false)
    .gte("created_at", "2025-09-01")
    .lt("created_at", "2025-12-01")
    .limit(100);

  if (error) {
    console.error("Supabase error:", error);
    return;
  }

  console.log(`Checking ${supabaseOrders?.length || 0} unfulfilled orders from Supabase...\n`);

  let fulfilledInShopify = 0;
  let canceledInShopify = 0;
  let matchingUnfulfilled = 0;
  let partialInShopify = 0;

  const examples: string[] = [];

  // Check each order in Shopify
  for (const order of supabaseOrders || []) {
    const orderName = order.order_name;

    const query = `
      query {
        orders(first: 1, query: "name:${orderName}") {
          edges {
            node {
              id
              name
              displayFulfillmentStatus
              cancelledAt
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query);
    const shopifyOrder = result.data?.orders?.edges?.[0]?.node;

    if (!shopifyOrder) {
      continue;
    }

    const shopifyStatus = shopifyOrder.displayFulfillmentStatus;
    const isCanceled = !!shopifyOrder.cancelledAt;

    if (isCanceled) {
      canceledInShopify++;
    } else if (shopifyStatus === "FULFILLED") {
      fulfilledInShopify++;
      if (examples.length < 10) {
        examples.push(`${orderName}: Supabase=unfulfilled, Shopify=FULFILLED`);
      }
    } else if (shopifyStatus === "PARTIALLY_FULFILLED") {
      partialInShopify++;
    } else {
      matchingUnfulfilled++;
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log("=== RESULTS ===");
  console.log(`Matching (unfulfilled in both): ${matchingUnfulfilled}`);
  console.log(`Fulfilled in Shopify but unfulfilled in Supabase: ${fulfilledInShopify}`);
  console.log(`Canceled in Shopify but unfulfilled in Supabase: ${canceledInShopify}`);
  console.log(`Partial in Shopify: ${partialInShopify}`);

  if (examples.length > 0) {
    console.log("\n--- Example Mismatches (should be fulfilled) ---");
    examples.forEach((e) => console.log(`  ${e}`));
  }

  if (fulfilledInShopify > 0 || canceledInShopify > 0) {
    console.log("\n⚠️  SYNC ISSUE DETECTED");
    console.log("Some orders in Supabase are outdated - webhooks may have failed.");
    console.log("Consider running bootstrap to resync.");
  }
}

main().catch(console.error);
