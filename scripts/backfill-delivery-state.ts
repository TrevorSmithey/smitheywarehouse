/**
 * Backfill Delivery State Script
 *
 * Updates shipments with delivery_state from order shipping address.
 * This is needed because the transit map requires state-level data.
 *
 * Run with: npx tsx scripts/backfill-delivery-state.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 250;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Get order IDs that have shipments without delivery_state
async function getOrdersNeedingState(): Promise<number[]> {
  const { data, error } = await supabase
    .from("shipments")
    .select("order_id")
    .is("delivery_state", null)
    .limit(10000);

  if (error) throw error;

  const uniqueOrderIds = [...new Set(data?.map(s => s.order_id) || [])];
  console.log(`Found ${uniqueOrderIds.length} orders with shipments missing delivery_state`);
  return uniqueOrderIds;
}

// Fetch shipping addresses from Shopify for given order IDs
async function fetchShippingStates(orderIds: number[]): Promise<Map<number, string>> {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!storeUrl || !token) {
    throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN");
  }

  const stateMap = new Map<number, string>();

  // Process in batches of 50 (Shopify ID query limit)
  for (let i = 0; i < orderIds.length; i += 50) {
    const batch = orderIds.slice(i, i + 50);
    const idQuery = batch.map(id => `id:${id}`).join(" OR ");

    const query = `
      query GetOrderShippingAddress($query: String!) {
        orders(first: 50, query: $query) {
          edges {
            node {
              id
              shippingAddress {
                provinceCode
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${storeUrl}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables: { query: idQuery } }),
      }
    );

    if (!response.ok) {
      console.error(`API error on batch ${i}: ${response.status}`);
      continue;
    }

    const data = await response.json();

    for (const edge of data.data?.orders?.edges || []) {
      const orderId = parseInt(edge.node.id.split("/").pop(), 10);
      const state = edge.node.shippingAddress?.provinceCode;
      if (state) {
        stateMap.set(orderId, state.toUpperCase());
      }
    }

    console.log(`Fetched batch ${Math.floor(i/50) + 1}/${Math.ceil(orderIds.length/50)} - ${stateMap.size} states found`);

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  return stateMap;
}

// Update shipments with delivery_state
async function updateShipments(stateMap: Map<number, string>): Promise<void> {
  console.log(`\nUpdating shipments with ${stateMap.size} states...`);

  let updated = 0;
  let errors = 0;

  for (const [orderId, state] of stateMap) {
    const { error } = await supabase
      .from("shipments")
      .update({ delivery_state: state })
      .eq("order_id", orderId)
      .is("delivery_state", null);

    if (error) {
      console.error(`Error updating order ${orderId}:`, error.message);
      errors++;
    } else {
      updated++;
    }

    if (updated % 100 === 0) {
      console.log(`Progress: ${updated} updated`);
    }
  }

  console.log(`\nComplete: ${updated} orders updated, ${errors} errors`);
}

async function main() {
  console.log("=".repeat(50));
  console.log("Backfill Delivery State");
  console.log("=".repeat(50));

  const required = [
    "SHOPIFY_STORE_URL",
    "SHOPIFY_ADMIN_TOKEN",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
  ];

  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  try {
    const orderIds = await getOrdersNeedingState();

    if (orderIds.length === 0) {
      console.log("All shipments already have delivery_state populated!");
      return;
    }

    const stateMap = await fetchShippingStates(orderIds);
    await updateShipments(stateMap);

    console.log("\n✓ Backfill complete! Refresh your dashboard to see state data on the map.");
  } catch (err) {
    console.error("\nFatal error:", err);
    process.exit(1);
  }
}

main();
