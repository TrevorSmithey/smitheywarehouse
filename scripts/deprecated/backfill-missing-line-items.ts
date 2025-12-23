/**
 * Backfill Missing Line Items
 *
 * Finds orders in Supabase that have no line_items,
 * fetches their line_items from Shopify, and inserts them.
 *
 * Safe to run multiple times - uses upsert (idempotent).
 *
 * Run with: npx tsx scripts/backfill-missing-line-items.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ORDER_QUERY = `
  query GetOrder($id: ID!) {
    order(id: $id) {
      id
      name
      lineItems(first: 100) {
        edges {
          node {
            id
            sku
            title
            quantity
            fulfillableQuantity
          }
        }
      }
      fulfillments(first: 50) {
        fulfillmentLineItems(first: 100) {
          edges {
            node {
              lineItem { id }
              quantity
            }
          }
        }
      }
    }
  }
`;

interface ShopifyOrderNode {
  id: string;
  name: string;
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        title: string;
        quantity: number;
        fulfillableQuantity: number;
      };
    }>;
  };
  fulfillments: Array<{
    fulfillmentLineItems: {
      edges: Array<{
        node: {
          lineItem: { id: string };
          quantity: number;
        };
      }>;
    };
  }>;
}

function parseGid(gid: string): number {
  return parseInt(gid.split("/").pop()!, 10);
}

function toGid(orderId: number): string {
  return `gid://shopify/Order/${orderId}`;
}

async function fetchOrder(orderId: number): Promise<ShopifyOrderNode | null> {
  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN!,
      },
      body: JSON.stringify({
        query: ORDER_QUERY,
        variables: { id: toGid(orderId) },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Shopify ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors.map((e: { message: string }) => e.message).join(", "));
  }

  return data.data?.order || null;
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("BACKFILL MISSING LINE ITEMS");
  console.log("=".repeat(60) + "\n");

  // Validate environment
  const required = ["SHOPIFY_STORE_URL", "SHOPIFY_ADMIN_TOKEN", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Find orders without line_items
  // Using two separate queries to avoid expensive left join with IS NULL
  console.log("Finding orders missing line_items...\n");

  // Step 1: Get all order IDs that HAVE line_items
  const { data: ordersWithItems, error: withItemsErr } = await supabase
    .from("line_items")
    .select("order_id");

  if (withItemsErr) {
    console.error("Query failed:", withItemsErr.message);
    process.exit(1);
  }

  const orderIdsWithItems = new Set((ordersWithItems || []).map((r) => r.order_id));
  console.log(`Orders with line_items: ${orderIdsWithItems.size}`);

  // Step 2: Get all orders
  const { data: allOrders, error } = await supabase
    .from("orders")
    .select("id, order_name, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  console.log(`Total orders: ${(allOrders || []).length}`);

  // Step 3: Filter to orders WITHOUT line_items (in-memory set difference)
  const orders = (allOrders || [])
    .filter((o) => !orderIdsWithItems.has(o.id))
    .map((o) => ({
      id: o.id,
      name: o.order_name,
      date: o.created_at.split("T")[0],
    }));

  if (orders.length === 0) {
    console.log("All orders have line_items. Nothing to do.\n");
    return;
  }

  // Summary by date
  const byDate = orders.reduce((acc, o) => {
    acc[o.date] = (acc[o.date] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`Found ${orders.length} orders missing line_items:\n`);
  Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => console.log(`  ${date}: ${count}`));

  console.log("\nProcessing...\n");

  // Process each order
  let success = 0, skipped = 0, errors = 0, lineItemsInserted = 0;

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const prefix = `[${i + 1}/${orders.length}] ${order.name}`;

    try {
      const shopifyOrder = await fetchOrder(order.id);

      if (!shopifyOrder) {
        console.log(`${prefix}: Skipped (not in Shopify)`);
        skipped++;
        continue;
      }

      const edges = shopifyOrder.lineItems.edges;
      if (edges.length === 0) {
        console.log(`${prefix}: Skipped (no line items)`);
        skipped++;
        continue;
      }

      // Calculate fulfilled quantities
      const fulfilled = new Map<number, number>();
      for (const f of shopifyOrder.fulfillments || []) {
        for (const e of f.fulfillmentLineItems?.edges || []) {
          const id = parseGid(e.node.lineItem.id);
          fulfilled.set(id, (fulfilled.get(id) || 0) + e.node.quantity);
        }
      }

      // Build line items
      const lineItems = edges.map((e) => {
        const id = parseGid(e.node.id);
        return {
          id,
          order_id: order.id,
          sku: e.node.sku,
          title: e.node.title,
          quantity: e.node.quantity,
          fulfilled_quantity: fulfilled.get(id) || 0,
        };
      });

      // Upsert (idempotent)
      const { error: upsertErr } = await supabase
        .from("line_items")
        .upsert(lineItems, { onConflict: "id" });

      if (upsertErr) {
        console.log(`${prefix}: ERROR - ${upsertErr.message}`);
        errors++;
      } else {
        console.log(`${prefix}: Inserted ${lineItems.length} items`);
        success++;
        lineItemsInserted += lineItems.length;
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 150));

    } catch (err) {
      console.log(`${prefix}: ERROR - ${err instanceof Error ? err.message : err}`);
      errors++;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Results
  console.log("\n" + "=".repeat(60));
  console.log("COMPLETE");
  console.log("=".repeat(60));
  console.log(`Orders backfilled:    ${success}`);
  console.log(`Line items inserted:  ${lineItemsInserted}`);
  console.log(`Skipped (not found):  ${skipped}`);
  console.log(`Errors:               ${errors}`);

  // Verify (using same two-query approach)
  const { data: verifyWithItems } = await supabase
    .from("line_items")
    .select("order_id");

  const verifySet = new Set((verifyWithItems || []).map((r) => r.order_id));

  const { data: verifyAllOrders } = await supabase
    .from("orders")
    .select("id");

  const remaining = (verifyAllOrders || []).filter((o) => !verifySet.has(o.id)).length;

  console.log(`\nRemaining orders without line_items: ${remaining}`);
  if (remaining === 0) {
    console.log("\nAll orders now have line_items.\n");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
