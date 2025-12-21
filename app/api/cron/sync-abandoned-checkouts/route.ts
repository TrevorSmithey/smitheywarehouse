/**
 * Sync Abandoned Checkouts from Shopify
 *
 * Fetches abandoned checkouts from Shopify and stores them in Supabase.
 * This enables cart recovery analytics in the Ecommerce dashboard.
 *
 * Shopify keeps abandoned checkouts for 1 month (can query last 30 days).
 * We sync checkouts from the last 48 hours on each run to catch new ones
 * and update existing ones.
 *
 * Schedule: Run every hour
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

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
      // Rate limited - wait and retry
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

async function fetchAllRecentCheckouts(): Promise<ShopifyAbandonedCheckout[]> {
  // Get checkouts updated in the last 48 hours
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const baseUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/checkouts.json`;
  const params = new URLSearchParams({
    limit: "250",
    updated_at_min: since,
  });

  let url: string | null = `${baseUrl}?${params}`;
  const allCheckouts: ShopifyAbandonedCheckout[] = [];

  while (url) {
    const { checkouts, nextUrl } = await fetchCheckoutsPage(url);
    allCheckouts.push(...checkouts);
    url = nextUrl;

    // Rate limiting
    await new Promise((r) => setTimeout(r, 550));
  }

  return allCheckouts;
}

function transformCheckout(checkout: ShopifyAbandonedCheckout) {
  // Simplify line items for storage
  const lineItems = checkout.line_items.map((item) => ({
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    price: parseFloat(item.price),
    variant_id: item.variant_id,
    product_id: item.product_id,
  }));

  // Determine recovery status
  let recoveryStatus: "abandoned" | "recovered" = "abandoned";
  let recoveredOrderId: number | null = null;

  // If completed_at is set, it was recovered (completed checkout becomes an order)
  if (checkout.completed_at) {
    recoveryStatus = "recovered";
    // Note: We can't directly get the order ID from the checkout API
    // Would need to match by email + created_at to find the order
  }

  // Match actual table schema
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
    recovered_order_id: recoveredOrderId,
    synced_at: new Date().toISOString(),
  };
}

export async function GET() {
  const startTime = Date.now();
  console.log("Starting abandoned checkout sync...");

  try {
    const supabase = createServiceClient();

    // Fetch recent abandoned checkouts from Shopify
    console.log("Fetching abandoned checkouts from Shopify...");
    const checkouts = await fetchAllRecentCheckouts();
    console.log(`Fetched ${checkouts.length} checkouts from Shopify`);

    if (checkouts.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No recent abandoned checkouts found",
        stats: { fetched: 0, upserted: 0 },
      });
    }

    // Transform and upsert
    const records = checkouts.map(transformCheckout);

    // Batch upsert
    const { error } = await supabase
      .from("abandoned_checkouts")
      .upsert(records, { onConflict: "shopify_checkout_id" });

    if (error) {
      console.error("Error upserting abandoned checkouts:", error);
      throw error;
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `Sync complete: ${records.length} checkouts upserted in ${elapsed}ms`
    );

    // Log to sync_logs for monitoring
    await supabase.from("sync_logs").insert({
      sync_type: "abandoned_checkouts",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: checkouts.length,
      records_synced: records.length,
      duration_ms: elapsed,
    });

    return NextResponse.json({
      success: true,
      stats: {
        fetched: checkouts.length,
        upserted: records.length,
        durationMs: elapsed,
      },
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    console.error("Abandoned checkout sync failed:", errorMessage);

    // Log failure
    try {
      const supabase = createServiceClient();
      await supabase.from("sync_logs").insert({
        sync_type: "abandoned_checkouts",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logErr) {
      console.error("Failed to log sync error:", logErr);
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// Allow POST for manual trigger
export const POST = GET;
