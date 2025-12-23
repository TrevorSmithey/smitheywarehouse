/**
 * Full re-sync of 2025 B2B data with SOLD logic
 * Clears all 2025 data and re-imports from Shopify
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY as string;

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
  fulfilled_at: string;
  created_at: string;
}

async function fetchOrders(fromDate: string): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;
  let hasMore = true;
  let page = 1;

  while (hasMore) {
    let url: string;
    if (pageInfo) {
      url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/orders.json?page_info=${pageInfo}`;
    } else {
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
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data = await response.json();
    const orders = data.orders || [];
    allOrders.push(...orders);

    process.stdout.write(`\r  Fetching... Page ${page}, ${allOrders.length} orders`);

    const linkHeader = response.headers.get("link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>; rel="next"/);
      pageInfo = match ? match[1] : null;
      hasMore = !!pageInfo;
    } else {
      hasMore = false;
    }

    page++;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(""); // newline after progress
  return allOrders;
}

function extractSoldItems(orders: ShopifyOrder[]): B2BSold[] {
  const items: B2BSold[] = [];
  let cancelled = 0;

  for (const order of orders) {
    if (order.cancelled_at) {
      cancelled++;
      continue;
    }

    const customerName = order.customer
      ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(" ") ||
        order.customer.email ||
        null
      : null;

    for (const lineItem of order.line_items || []) {
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
        fulfilled_at: order.created_at,
        created_at: order.created_at,
      });
    }
  }

  console.log(`  Skipped ${cancelled} cancelled orders`);
  return items;
}

async function main() {
  const startTime = Date.now();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Full Re-sync: 2025 B2B Data (Sold Logic)                 ");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Step 1: Delete all 2025 data
  console.log("Step 1: Clearing all 2025 B2B data...");
  const { error: deleteError, count: deleteCount } = await supabase
    .from("b2b_fulfilled")
    .delete({ count: "exact" })
    .gte("fulfilled_at", "2025-01-01")
    .lt("fulfilled_at", "2026-01-01");

  if (deleteError) {
    console.error("Delete error:", deleteError);
    return;
  }
  console.log(`  Deleted ${deleteCount} records\n`);

  // Step 2: Fetch all 2025 orders
  console.log("Step 2: Fetching all 2025 orders from Shopify...");
  const orders = await fetchOrders("2025-01-01T00:00:00-05:00");
  console.log(`  Total orders fetched: ${orders.length}\n`);

  // Step 3: Extract sold items
  console.log("Step 3: Extracting sold line items...");
  const items = extractSoldItems(orders);
  console.log(`  Extracted ${items.length} line items\n`);

  // Dedupe
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
  console.log(`  Deduped to ${uniqueItems.length} unique records\n`);

  // Step 4: Upsert in batches
  console.log("Step 4: Upserting to Supabase...");
  const chunkSize = 500;
  for (let i = 0; i < uniqueItems.length; i += chunkSize) {
    const chunk = uniqueItems.slice(i, i + chunkSize);
    const { error } = await supabase.from("b2b_fulfilled").upsert(chunk, {
      onConflict: "order_id,sku,fulfilled_at",
      ignoreDuplicates: false,
    });

    if (error) {
      console.error("Upsert error:", error);
      return;
    }
    process.stdout.write(`\r  Upserted ${Math.min(i + chunkSize, uniqueItems.length)}/${uniqueItems.length}`);
  }
  console.log("\n");

  // Step 5: Monthly summary
  console.log("Step 5: Monthly Summary:");
  console.log("─".repeat(40));

  const monthlyTotals: Record<string, number> = {};
  for (const item of uniqueItems) {
    const month = item.created_at.slice(0, 7); // YYYY-MM
    monthlyTotals[month] = (monthlyTotals[month] || 0) + item.quantity;
  }

  const sortedMonths = Object.keys(monthlyTotals).sort();
  for (const month of sortedMonths) {
    console.log(`  ${month}: ${monthlyTotals[month].toLocaleString()} units`);
  }

  const totalUnits = Object.values(monthlyTotals).reduce((a, b) => a + b, 0);
  console.log("─".repeat(40));
  console.log(`  TOTAL: ${totalUnits.toLocaleString()} units`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Full re-sync complete in ${elapsed}s`);
}

main().catch(console.error);
