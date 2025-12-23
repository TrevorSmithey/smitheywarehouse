/**
 * Backfill Abandoned Checkouts from Shopify
 *
 * Fetches all abandoned checkouts from the last 30 days (Shopify's limit)
 * and populates the abandoned_checkouts table.
 *
 * Usage: npx ts-node scripts/backfill-abandoned-checkouts.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ShopifyCheckoutLineItem {
  id: number;
  variant_id: number;
  title: string;
  quantity: number;
  sku: string | null;
  price: string;
  line_price: string;
  product_id: number;
}

interface ShopifyAbandonedCheckout {
  id: number;
  token: string;
  email: string | null;
  customer?: {
    id: number;
  } | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  currency: string;
  subtotal_price: string;
  total_price: string;
  total_tax: string;
  total_discounts: string;
  line_items: ShopifyCheckoutLineItem[];
  abandoned_checkout_url: string;
  billing_address?: {
    city?: string;
    province?: string;
    province_code?: string;
    country?: string;
    country_code?: string;
    zip?: string;
  } | null;
  shipping_address?: {
    city?: string;
    province?: string;
    province_code?: string;
    country?: string;
    country_code?: string;
    zip?: string;
  } | null;
}

function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const links = linkHeader.split(",");
  for (const link of links) {
    const [urlPart, relPart] = link.split(";").map((s) => s.trim());
    if (relPart === 'rel="next"') {
      return urlPart.slice(1, -1);
    }
  }
  return null;
}

async function fetchCheckoutsPage(
  url: string
): Promise<{ checkouts: ShopifyAbandonedCheckout[]; nextUrl: string | null }> {
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 429) {
      console.log("Rate limited, waiting 10s...");
      await new Promise((r) => setTimeout(r, 10000));
      return fetchCheckoutsPage(url);
    }
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const linkHeader = res.headers.get("Link");
  const nextUrl = parseNextPageUrl(linkHeader);

  return { checkouts: data.checkouts || [], nextUrl };
}

function transformCheckout(checkout: ShopifyAbandonedCheckout) {
  const lineItems = checkout.line_items.map((item) => ({
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    price: parseFloat(item.price),
    variant_id: item.variant_id,
    product_id: item.product_id,
  }));

  let recoveryStatus: "abandoned" | "recovered" = "abandoned";
  if (checkout.completed_at) {
    recoveryStatus = "recovered";
  }

  // Match actual table schema (no address/currency columns)
  return {
    shopify_checkout_id: checkout.id,
    checkout_token: checkout.token,
    email: checkout.email,
    shopify_customer_id: checkout.customer?.id || null,
    cart_total: parseFloat(checkout.total_price),
    subtotal_price: parseFloat(checkout.subtotal_price),
    total_tax: parseFloat(checkout.total_tax),
    total_discounts: parseFloat(checkout.total_discounts),
    line_items_count: checkout.line_items.length,
    line_items: lineItems,
    created_at: checkout.created_at,
    updated_at: checkout.updated_at,
    completed_at: checkout.completed_at,
    abandoned_checkout_url: checkout.abandoned_checkout_url,
    recovery_status: recoveryStatus,
    recovered_order_id: null,
    synced_at: new Date().toISOString(),
  };
}

async function main() {
  console.log("=".repeat(60));
  console.log("ABANDONED CHECKOUTS BACKFILL");
  console.log("=".repeat(60));

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

  console.log(`\nShopify Store: ${SHOPIFY_STORE}`);
  console.log("Note: Shopify only keeps abandoned checkouts for ~30 days\n");

  const startTime = Date.now();

  // Fetch all checkouts (no date filter to get everything available)
  const baseUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/checkouts.json`;
  const params = new URLSearchParams({
    limit: "250",
  });

  let url: string | null = `${baseUrl}?${params}`;
  const allCheckouts: ShopifyAbandonedCheckout[] = [];
  let pageCount = 0;

  console.log("Fetching abandoned checkouts from Shopify...");

  while (url) {
    pageCount++;
    const { checkouts, nextUrl } = await fetchCheckoutsPage(url);
    allCheckouts.push(...checkouts);

    if (pageCount % 5 === 0 || checkouts.length > 0) {
      console.log(`  Page ${pageCount}: ${allCheckouts.length} checkouts fetched`);
    }

    url = nextUrl;
    await new Promise((r) => setTimeout(r, 550));
  }

  console.log(`\nFetched ${allCheckouts.length} total checkouts from Shopify`);

  if (allCheckouts.length === 0) {
    console.log("No abandoned checkouts found.");
    return;
  }

  // Transform and upsert
  console.log("\nUpserting to database...");
  const records = allCheckouts.map(transformCheckout);

  // Batch upsert in chunks of 500
  const BATCH_SIZE = 500;
  let upsertedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("abandoned_checkouts")
      .upsert(batch, { onConflict: "shopify_checkout_id" });

    if (error) {
      console.error(`Batch error:`, error.message);
      errorCount += batch.length;
    } else {
      upsertedCount += batch.length;
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
  }

  const elapsed = Date.now() - startTime;

  console.log("\n" + "=".repeat(60));
  console.log("BACKFILL COMPLETE");
  console.log("=".repeat(60));
  console.log(`Checkouts fetched: ${allCheckouts.length}`);
  console.log(`Checkouts upserted: ${upsertedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Time: ${(elapsed / 1000).toFixed(1)}s`);

  // Stats breakdown
  const abandoned = allCheckouts.filter((c) => !c.completed_at).length;
  const recovered = allCheckouts.filter((c) => c.completed_at).length;
  const totalValue = allCheckouts
    .filter((c) => !c.completed_at)
    .reduce((sum, c) => sum + parseFloat(c.total_price), 0);

  console.log("\n--- STATS ---");
  console.log(`Still abandoned: ${abandoned}`);
  console.log(`Recovered: ${recovered}`);
  console.log(`Abandoned cart value: $${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
