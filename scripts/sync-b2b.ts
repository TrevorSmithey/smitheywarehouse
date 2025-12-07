/**
 * Sync B2B/Wholesale SOLD orders from Shopify to Supabase
 * Tracks orders placed (sold), not fulfilled - mirrors DTC behavior
 *
 * Usage:
 *   npm run sync-b2b                    # Sync last 30 days
 *   npm run sync-b2b -- --from 2025-01-01  # Sync from specific date
 *   npm run sync-b2b -- --full          # Full sync from Jan 1, 2025
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SHOPIFY_B2B_STORE || !SHOPIFY_B2B_TOKEN) {
  console.error("Missing SHOPIFY_B2B_STORE_URL or SHOPIFY_B2B_ADMIN_TOKEN");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  customer?: { first_name?: string; last_name?: string; email?: string };
  source_name?: string;
  line_items?: ShopifyLineItem[];
  cancelled_at?: string;
}

interface ShopifyLineItem {
  id: number;
  sku: string;
  quantity: number;
  price: string;
}

interface B2BSold {
  order_id: number;
  order_name: string;
  customer_name: string | null;
  source_name: string | null;
  sku: string;
  quantity: number;
  price: number | null;
  fulfilled_at: string; // Using this to store order date (sold_at)
  created_at: string;
}

async function fetchOrders(fromDate: string): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;
  let hasMore = true;
  let page = 1;

  console.log(`Fetching B2B orders from ${fromDate}...`);

  while (hasMore) {
    // When using page_info cursor, Shopify requires ONLY page_info (no other params)
    let url: string;
    if (pageInfo) {
      url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/orders.json?page_info=${pageInfo}`;
    } else {
      // Fetch ALL orders (not just shipped) - track sold, not fulfilled
      const params = new URLSearchParams({
        status: "any",
        created_at_min: fromDate,
        limit: "250",
      });
      url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/orders.json?${params}`;
    }

    const response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_B2B_TOKEN!,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const orders = data.orders || [];
    allOrders.push(...orders);

    console.log(`  Page ${page}: ${orders.length} orders (total: ${allOrders.length})`);

    // Check for pagination
    const linkHeader = response.headers.get("link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>; rel="next"/);
      pageInfo = match ? match[1] : null;
      hasMore = !!pageInfo;
    } else {
      hasMore = false;
    }

    page++;

    // Rate limiting - Shopify allows 2 requests/second
    await new Promise((r) => setTimeout(r, 500));
  }

  return allOrders;
}

function extractSoldItems(orders: ShopifyOrder[]): B2BSold[] {
  const items: B2BSold[] = [];

  for (const order of orders) {
    // Skip cancelled orders
    if (order.cancelled_at) continue;

    const customerName = order.customer
      ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(" ") || order.customer.email || null
      : null;

    // Extract from order line_items (sold), not fulfillments
    for (const lineItem of order.line_items || []) {
      // Skip non-product SKUs
      if (!lineItem.sku || lineItem.sku === "Gift-Note" || lineItem.sku === "Smith-Eng") {
        continue;
      }

      items.push({
        order_id: order.id,
        order_name: order.name,
        customer_name: customerName,
        source_name: order.source_name || null,
        sku: lineItem.sku,
        quantity: lineItem.quantity,
        price: parseFloat(lineItem.price) || null,
        fulfilled_at: order.created_at, // Use order date as "sold" date
        created_at: order.created_at,
      });
    }
  }

  return items;
}

async function upsertItems(items: B2BSold[]): Promise<void> {
  if (items.length === 0) {
    console.log("No items to upsert");
    return;
  }

  // Dedupe items by order_id + sku (one entry per SKU per order)
  const deduped = new Map<string, B2BSold>();
  for (const item of items) {
    const key = `${item.order_id}|${item.sku}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      deduped.set(key, { ...item });
    }
  }
  const uniqueItems = Array.from(deduped.values());
  console.log(`Deduped ${items.length} items to ${uniqueItems.length} unique records`);

  // Batch upsert in chunks of 500
  const chunkSize = 500;
  let totalUpserted = 0;

  for (let i = 0; i < uniqueItems.length; i += chunkSize) {
    const chunk = uniqueItems.slice(i, i + chunkSize);

    const { error } = await supabase
      .from("b2b_fulfilled")
      .upsert(chunk, {
        onConflict: "order_id,sku,fulfilled_at",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`Error upserting chunk ${i / chunkSize + 1}:`, error);
      throw error;
    }

    totalUpserted += chunk.length;
    console.log(`  Upserted ${totalUpserted}/${uniqueItems.length} items`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  let fromDate: string;

  if (args.includes("--full")) {
    fromDate = "2025-01-01T00:00:00-05:00";
    console.log("Full sync mode: Jan 1, 2025 to present");
  } else if (args.includes("--from")) {
    const idx = args.indexOf("--from");
    const dateArg = args[idx + 1];
    if (!dateArg) {
      console.error("--from requires a date argument (e.g., --from 2025-01-01)");
      process.exit(1);
    }
    fromDate = `${dateArg}T00:00:00-05:00`;
    console.log(`Sync from: ${dateArg}`);
  } else {
    // Default: last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    fromDate = thirtyDaysAgo.toISOString();
    console.log("Default sync: last 30 days");
  }

  try {
    // Fetch orders from Shopify
    const orders = await fetchOrders(fromDate);
    console.log(`\nFetched ${orders.length} orders (excluding cancelled)`);

    // Extract sold line items (from order, not fulfillments)
    const items = extractSoldItems(orders);
    console.log(`Extracted ${items.length} sold line items`);

    // Show SKU summary
    const skuCounts = new Map<string, number>();
    for (const item of items) {
      skuCounts.set(item.sku, (skuCounts.get(item.sku) || 0) + item.quantity);
    }
    console.log("\nTop SKUs:");
    const sorted = [...skuCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [sku, qty] of sorted) {
      console.log(`  ${sku}: ${qty}`);
    }

    // Upsert to Supabase
    console.log("\nUpserting to Supabase...");
    await upsertItems(items);

    console.log("\n✅ B2B sync complete!");
  } catch (error) {
    console.error("Sync failed:", error);
    process.exit(1);
  }
}

main();
