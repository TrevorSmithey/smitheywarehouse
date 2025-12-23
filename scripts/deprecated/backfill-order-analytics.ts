/**
 * Backfill Order Analytics Fields
 *
 * Database-driven approach: queries our orders table for orders needing backfill,
 * then fetches those specific orders from Shopify API.
 *
 * Fetches orders from Shopify API and updates our database with enhanced analytics fields:
 * - shopify_customer_id
 * - total_price, subtotal_price, total_discounts, total_tax, total_shipping
 * - discount_codes (JSONB)
 * - referring_site, source_name, landing_site
 * - financial_status, payment_gateway
 * - shipping address fields
 * - is_first_order, order_sequence
 *
 * Usage: npx ts-node scripts/backfill-order-analytics.ts [--limit=1000] [--batch=50]
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  customer?: {
    id: number;
    orders_count?: number;
  } | null;
  total_price?: string;
  subtotal_price?: string;
  total_discounts?: string;
  total_tax?: string;
  total_shipping_price_set?: {
    shop_money?: { amount?: string };
  };
  discount_codes?: Array<{ code: string; amount: string; type: string }>;
  referring_site?: string | null;
  source_name?: string | null;
  landing_site?: string | null;
  financial_status?: string | null;
  payment_gateway_names?: string[];
  shipping_address?: {
    city?: string;
    province?: string;
    province_code?: string;
    country?: string;
    country_code?: string;
    zip?: string;
  } | null;
}

async function fetchShopifyOrdersByIds(orderIds: number[]): Promise<ShopifyOrder[]> {
  if (orderIds.length === 0) return [];

  const idsParam = orderIds.join(",");
  const params = new URLSearchParams({
    ids: idsParam,
    status: "any",
    limit: "250", // Required to get all IDs - Shopify defaults to 50
    fields: "id,name,created_at,customer,total_price,subtotal_price,total_discounts,total_tax,total_shipping_price_set,discount_codes,referring_site,source_name,landing_site,financial_status,payment_gateway_names,shipping_address",
  });

  const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/orders.json?${params}`;

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) {
      // Rate limited - wait and return empty to retry
      console.log("  Rate limited, waiting 2s...");
      await new Promise(resolve => setTimeout(resolve, 2000));
      return fetchShopifyOrdersByIds(orderIds);
    }
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.orders || [];
}

async function updateOrdersInDatabase(orders: ShopifyOrder[]): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;

  for (const order of orders) {
    const totalShipping = order.total_shipping_price_set?.shop_money?.amount
      ? parseFloat(order.total_shipping_price_set.shop_money.amount)
      : null;

    const { error } = await supabase
      .from("orders")
      .update({
        shopify_customer_id: order.customer?.id || null,
        total_price: order.total_price ? parseFloat(order.total_price) : null,
        subtotal_price: order.subtotal_price ? parseFloat(order.subtotal_price) : null,
        total_discounts: order.total_discounts ? parseFloat(order.total_discounts) : 0,
        total_tax: order.total_tax ? parseFloat(order.total_tax) : null,
        total_shipping: totalShipping,
        discount_codes: order.discount_codes && order.discount_codes.length > 0
          ? order.discount_codes
          : null,
        referring_site: order.referring_site || null,
        source_name: order.source_name || null,
        landing_site: order.landing_site || null,
        financial_status: order.financial_status || null,
        payment_gateway: order.payment_gateway_names?.[0] || null,
        shipping_city: order.shipping_address?.city || null,
        shipping_province: order.shipping_address?.province || null,
        shipping_province_code: order.shipping_address?.province_code || null,
        shipping_country: order.shipping_address?.country || null,
        shipping_country_code: order.shipping_address?.country_code || null,
        shipping_zip: order.shipping_address?.zip || null,
        order_sequence: order.customer?.orders_count || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (error) {
      errors++;
    } else {
      updated++;
    }
  }

  return { updated, errors };
}

async function computeFirstOrderFlags(): Promise<void> {
  console.log("\nComputing is_first_order flags...");

  // Reset all flags first
  console.log("  Resetting existing flags...");

  // Use batched approach to avoid timeout
  let offset = 0;
  const batchSize = 50000;

  while (true) {
    const { data: orders } = await supabase
      .from("orders")
      .select("id, shopify_customer_id, created_at")
      .not("shopify_customer_id", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (!orders || orders.length === 0) break;

    const seenCustomers = new Set<number>();
    const firstOrderIds: number[] = [];

    for (const order of orders) {
      if (!seenCustomers.has(order.shopify_customer_id)) {
        seenCustomers.add(order.shopify_customer_id);
        firstOrderIds.push(order.id);
      }
    }

    // Update first orders in this batch
    if (firstOrderIds.length > 0) {
      const updateBatchSize = 500;
      for (let i = 0; i < firstOrderIds.length; i += updateBatchSize) {
        const batch = firstOrderIds.slice(i, i + updateBatchSize);
        await supabase
          .from("orders")
          .update({ is_first_order: true })
          .in("id", batch);
      }
      console.log(`  Marked ${firstOrderIds.length} first orders (batch offset ${offset})`);
    }

    offset += batchSize;
    if (orders.length < batchSize) break;
  }

  console.log("First order flags computed.");
}

async function main() {
  console.log("=== Order Analytics Backfill (Database-Driven) ===\n");

  // Parse args
  const args = process.argv.slice(2);
  let maxOrders = Infinity;
  let batchSize = 50; // Shopify allows up to 250 IDs per request, but we'll be conservative

  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      maxOrders = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--batch=")) {
      batchSize = parseInt(arg.split("=")[1], 10);
    }
  }

  console.log(`Configuration:`);
  console.log(`  Max orders: ${maxOrders === Infinity ? "unlimited" : maxOrders}`);
  console.log(`  Batch size: ${batchSize}`);
  console.log("");

  // Get count of orders needing backfill
  const { count: totalNeedingBackfill } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .is("shopify_customer_id", null);

  console.log(`Orders needing backfill: ${totalNeedingBackfill}`);

  let processedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  let notFoundCount = 0;

  const startTime = Date.now();

  while (processedCount < maxOrders) {
    // Fetch batch of order IDs from our database that need backfill
    const { data: ordersToBackfill, error: fetchError } = await supabase
      .from("orders")
      .select("id")
      .is("shopify_customer_id", null)
      .order("created_at", { ascending: false }) // Start with recent orders
      .limit(batchSize);

    if (fetchError) {
      console.error("Error fetching orders from database:", fetchError);
      break;
    }

    if (!ordersToBackfill || ordersToBackfill.length === 0) {
      console.log("No more orders to backfill.");
      break;
    }

    const orderIds = ordersToBackfill.map(o => o.id);

    // Fetch these orders from Shopify
    try {
      const shopifyOrders = await fetchShopifyOrdersByIds(orderIds);

      if (shopifyOrders.length > 0) {
        // Update in database
        const stats = await updateOrdersInDatabase(shopifyOrders);
        updatedCount += stats.updated;
        errorCount += stats.errors;
      }

      // Track orders not found in Shopify (might be deleted/archived)
      const foundIds = new Set(shopifyOrders.map(o => o.id));
      const notFoundIds = orderIds.filter(id => !foundIds.has(id));
      notFoundCount += notFoundIds.length;

      // Mark not-found orders with a placeholder to skip them next iteration
      if (notFoundIds.length > 0) {
        await supabase
          .from("orders")
          .update({ shopify_customer_id: -1 }) // Use -1 to indicate "checked but no customer"
          .in("id", notFoundIds);
      }

      processedCount += orderIds.length;

      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedCount / elapsed;
      const remaining = (totalNeedingBackfill || 0) - processedCount;
      const eta = remaining > 0 ? Math.round(remaining / rate / 60) : 0;

      console.log(
        `Processed: ${processedCount} | Updated: ${updatedCount} | Not in Shopify: ${notFoundCount} | Errors: ${errorCount} | Rate: ${rate.toFixed(1)}/sec | ETA: ${eta}min`
      );

      // Rate limiting - Shopify allows 2 req/sec for REST API
      await new Promise(resolve => setTimeout(resolve, 550));

    } catch (error) {
      console.error("Batch error:", error);
      // Wait and continue
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Compute first order flags after all data is loaded
  if (updatedCount > 0) {
    await computeFirstOrderFlags();
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log("\n=== Backfill Complete ===");
  console.log(`Total processed: ${processedCount}`);
  console.log(`Successfully updated: ${updatedCount}`);
  console.log(`Not found in Shopify: ${notFoundCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total time: ${totalTime} minutes`);
}

main().catch(console.error);
