/**
 * Backfill Historical Orders from Shopify
 *
 * Fetches ALL orders from Shopify REST API with complete data:
 * - Basic order info (id, name, dates, fulfillment status)
 * - Analytics fields (customer_id, prices, discounts, attribution)
 * - Geography (shipping address)
 * - Line items and shipment tracking
 *
 * This script fills the ~190K order gap from 2020-2023.
 *
 * Usage:
 *   npx ts-node scripts/backfill-historical-orders.ts
 *   npx ts-node scripts/backfill-historical-orders.ts --start=2020-01-01 --end=2023-12-31
 *   npx ts-node scripts/backfill-historical-orders.ts --dry-run
 *
 * Shopify REST API rate limits: 2 requests/second (40 requests per 20-second bucket)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Shopify REST API page size (max 250)
const PAGE_SIZE = 250;

// Fields to request from Shopify REST API
const ORDER_FIELDS = [
  "id",
  "name",
  "tags",
  "created_at",
  "cancelled_at",
  "fulfillment_status",
  "fulfillments",
  "line_items",
  "customer",
  "total_price",
  "subtotal_price",
  "total_discounts",
  "total_tax",
  "total_shipping_price_set",
  "discount_codes",
  "referring_site",
  "source_name",
  "landing_site",
  "financial_status",
  "payment_gateway_names",
  "shipping_address",
].join(",");

interface ShopifyLineItem {
  id: number;
  sku: string | null;
  title: string;
  quantity: number;
  fulfillable_quantity: number;
}

interface ShopifyFulfillment {
  id: number;
  created_at: string;
  tracking_number: string | null;
  tracking_numbers: string[];
  tracking_company: string | null;
  line_items: Array<{ id: number; quantity: number }>;
}

interface ShopifyOrder {
  id: number;
  name: string;
  tags: string;
  created_at: string;
  cancelled_at: string | null;
  fulfillment_status: string | null;
  fulfillments: ShopifyFulfillment[];
  line_items: ShopifyLineItem[];
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

interface BackfillStats {
  ordersProcessed: number;
  ordersInserted: number;
  ordersUpdated: number;
  lineItemsUpserted: number;
  shipmentsUpserted: number;
  errors: number;
  startTime: number;
}

// Parse Shopify's Link header for cursor-based pagination
function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const links = linkHeader.split(",");
  for (const link of links) {
    const [urlPart, relPart] = link.split(";").map((s) => s.trim());
    if (relPart === 'rel="next"') {
      return urlPart.slice(1, -1); // Remove < and >
    }
  }
  return null;
}

function extractWarehouse(tags: string): string | null {
  const tagList = tags
    .split(",")
    .map((t) => t.toLowerCase().trim());
  if (tagList.includes("smithey")) return "smithey";
  if (tagList.includes("selery")) return "selery";
  return null;
}

function mapFulfillmentStatus(status: string | null): "partial" | "fulfilled" | null {
  if (!status) return null;
  const lower = status.toLowerCase();
  if (lower === "fulfilled") return "fulfilled";
  if (lower === "partial" || lower === "partially_fulfilled") return "partial";
  return null;
}

function calculateFulfilledAt(
  status: string | null,
  fulfillments: ShopifyFulfillment[]
): string | null {
  if (status?.toLowerCase() !== "fulfilled" || !fulfillments?.length) {
    return null;
  }
  const dates = fulfillments.map((f) => new Date(f.created_at).getTime());
  const mostRecent = Math.max(...dates);
  return new Date(mostRecent).toISOString();
}

function isRestorationOrder(lineItems: ShopifyLineItem[]): boolean {
  return lineItems.some(
    (item) => item.sku && item.sku.toLowerCase().includes("-rest-")
  );
}

async function fetchOrdersPage(
  url: string
): Promise<{ orders: ShopifyOrder[]; nextUrl: string | null }> {
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 429) {
      // Rate limited - wait and retry
      console.log("  Rate limited, waiting 10s...");
      await new Promise((r) => setTimeout(r, 10000));
      return fetchOrdersPage(url);
    }
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const linkHeader = res.headers.get("Link");
  const nextUrl = parseNextPageUrl(linkHeader);

  return { orders: data.orders || [], nextUrl };
}

async function fetchOrdersInRange(
  startDate: string,
  endDate: string,
  onPage: (orders: ShopifyOrder[], pageNum: number) => Promise<void>
): Promise<number> {
  const baseUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/orders.json`;
  const params = new URLSearchParams({
    status: "any",
    limit: String(PAGE_SIZE),
    created_at_min: `${startDate}T00:00:00-05:00`,
    created_at_max: `${endDate}T23:59:59-05:00`,
    fields: ORDER_FIELDS,
    order: "created_at asc",
  });

  let url: string | null = `${baseUrl}?${params}`;
  let pageNum = 0;
  let totalOrders = 0;

  while (url) {
    pageNum++;
    const { orders, nextUrl } = await fetchOrdersPage(url);

    if (orders.length > 0) {
      await onPage(orders, pageNum);
      totalOrders += orders.length;
    }

    url = nextUrl;

    // Rate limiting: 2 requests/second = 500ms between requests
    // Being slightly more conservative at 550ms
    await new Promise((r) => setTimeout(r, 550));
  }

  return totalOrders;
}

// Retry helper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// Transform a Shopify order to our DB record
function transformOrder(order: ShopifyOrder) {
  const warehouse = extractWarehouse(order.tags || "");
  const fulfillmentStatus = mapFulfillmentStatus(order.fulfillment_status);
  const fulfilledAt = calculateFulfilledAt(order.fulfillment_status, order.fulfillments || []);
  const isRestoration = isRestorationOrder(order.line_items || []);
  const isFirstOrder = order.customer?.orders_count === 1;

  const totalShipping = order.total_shipping_price_set?.shop_money?.amount
    ? parseFloat(order.total_shipping_price_set.shop_money.amount)
    : null;

  return {
    id: order.id,
    order_name: order.name,
    warehouse,
    fulfillment_status: fulfillmentStatus,
    canceled: !!order.cancelled_at,
    created_at: order.created_at,
    fulfilled_at: fulfilledAt,
    is_restoration: isRestoration,
    updated_at: new Date().toISOString(),
    shopify_customer_id: order.customer?.id || null,
    total_price: order.total_price ? parseFloat(order.total_price) : null,
    subtotal_price: order.subtotal_price ? parseFloat(order.subtotal_price) : null,
    total_discounts: order.total_discounts ? parseFloat(order.total_discounts) : 0,
    total_tax: order.total_tax ? parseFloat(order.total_tax) : null,
    total_shipping: totalShipping,
    discount_codes:
      order.discount_codes && order.discount_codes.length > 0
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
    is_first_order: isFirstOrder,
    order_sequence: order.customer?.orders_count || null,
  };
}

// Transform line items
function transformLineItems(order: ShopifyOrder) {
  return (order.line_items || []).map((item) => ({
    id: item.id,
    order_id: order.id,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    fulfilled_quantity: item.quantity - (item.fulfillable_quantity || 0),
  }));
}

// Transform shipments
function transformShipments(order: ShopifyOrder) {
  const shipments: Array<{
    order_id: number;
    tracking_number: string;
    carrier: string | null;
    shipped_at: string;
    status: string;
  }> = [];

  for (const fulfillment of order.fulfillments || []) {
    const trackingNumbers =
      fulfillment.tracking_numbers ||
      (fulfillment.tracking_number ? [fulfillment.tracking_number] : []);

    for (const trackingNumber of trackingNumbers) {
      if (!trackingNumber) continue;
      shipments.push({
        order_id: order.id,
        tracking_number: trackingNumber,
        carrier: fulfillment.tracking_company || null,
        shipped_at: fulfillment.created_at,
        status: "in_transit",
      });
    }
  }

  return shipments;
}

async function processOrderBatch(
  orders: ShopifyOrder[],
  stats: BackfillStats,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    stats.ordersProcessed += orders.length;
    return;
  }

  // Transform all orders to DB records
  const orderRecords = orders.map(transformOrder);
  const allLineItems = orders.flatMap(transformLineItems);
  const allShipments = orders.flatMap(transformShipments);

  // Batch upsert orders with retry
  try {
    await withRetry(async () => {
      const { error } = await supabase
        .from("orders")
        .upsert(orderRecords, { onConflict: "id" });
      if (error) throw error;
    });
    stats.ordersInserted += orderRecords.length;
  } catch (err) {
    console.error(`Batch order upsert failed, falling back to individual:`, err);
    // Fallback: insert one by one
    for (const record of orderRecords) {
      try {
        const { error } = await supabase
          .from("orders")
          .upsert(record, { onConflict: "id" });
        if (!error) {
          stats.ordersInserted++;
        } else {
          stats.errors++;
        }
      } catch {
        stats.errors++;
      }
    }
  }

  // Batch upsert line items
  if (allLineItems.length > 0) {
    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from("line_items")
          .upsert(allLineItems, { onConflict: "id" });
        if (error) throw error;
      });
      stats.lineItemsUpserted += allLineItems.length;
    } catch (err) {
      console.error(`Batch line items upsert failed:`, err);
      stats.errors++;
    }
  }

  // Batch upsert shipments
  if (allShipments.length > 0) {
    try {
      await withRetry(async () => {
        const { error } = await supabase
          .from("shipments")
          .upsert(allShipments, { onConflict: "order_id,tracking_number" });
        if (error) throw error;
      });
      stats.shipmentsUpserted += allShipments.length;
    } catch (err) {
      console.error(`Batch shipments upsert failed:`, err);
      stats.errors++;
    }
  }

  stats.ordersProcessed += orders.length;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

async function main() {
  console.log("=".repeat(70));
  console.log("HISTORICAL ORDERS BACKFILL");
  console.log("=".repeat(70));

  // Parse arguments
  const args = process.argv.slice(2);
  let startDate = "2020-01-01";
  let endDate = "2023-12-31";
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith("--start=")) {
      startDate = arg.split("=")[1];
    } else if (arg.startsWith("--end=")) {
      endDate = arg.split("=")[1];
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  // Verify environment
  const required = [
    "SHOPIFY_STORE_URL",
    "SHOPIFY_ADMIN_TOKEN",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`\nConfiguration:`);
  console.log(`  Shopify Store: ${SHOPIFY_STORE}`);
  console.log(`  Date Range: ${startDate} to ${endDate}`);
  console.log(`  Dry Run: ${dryRun}`);

  // Get current order count for comparison
  const { count: beforeCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true });

  console.log(`  Current DB orders: ${beforeCount?.toLocaleString()}`);
  console.log("");

  const stats: BackfillStats = {
    ordersProcessed: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    lineItemsUpserted: 0,
    shipmentsUpserted: 0,
    errors: 0,
    startTime: Date.now(),
  };

  // Process orders with progress reporting
  console.log(`Fetching orders from Shopify (${startDate} to ${endDate})...\n`);

  let lastLogTime = Date.now();

  const totalOrders = await fetchOrdersInRange(startDate, endDate, async (orders, pageNum) => {
    await processOrderBatch(orders, stats, dryRun);

    // Log progress every 5 seconds
    const now = Date.now();
    if (now - lastLogTime >= 5000) {
      const elapsed = now - stats.startTime;
      const rate = stats.ordersProcessed / (elapsed / 1000);
      console.log(
        `  Page ${pageNum}: ${stats.ordersProcessed.toLocaleString()} orders | ` +
          `${stats.ordersInserted.toLocaleString()} inserted | ` +
          `${stats.errors} errors | ` +
          `${rate.toFixed(1)}/sec | ` +
          `Elapsed: ${formatDuration(elapsed)}`
      );
      lastLogTime = now;
    }
  });

  // Final stats
  const totalTime = Date.now() - stats.startTime;

  console.log("\n" + "=".repeat(70));
  console.log("BACKFILL COMPLETE");
  console.log("=".repeat(70));
  console.log(`Total orders from Shopify: ${totalOrders.toLocaleString()}`);
  console.log(`Orders processed: ${stats.ordersProcessed.toLocaleString()}`);
  console.log(`Orders upserted: ${stats.ordersInserted.toLocaleString()}`);
  console.log(`Line items upserted: ${stats.lineItemsUpserted.toLocaleString()}`);
  console.log(`Shipments upserted: ${stats.shipmentsUpserted.toLocaleString()}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Total time: ${formatDuration(totalTime)}`);

  // Verification
  if (!dryRun) {
    console.log("\n--- VERIFICATION ---");
    const { count: afterCount } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true });

    console.log(`DB orders before: ${beforeCount?.toLocaleString()}`);
    console.log(`DB orders after: ${afterCount?.toLocaleString()}`);
    console.log(`Net change: +${((afterCount || 0) - (beforeCount || 0)).toLocaleString()}`);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
