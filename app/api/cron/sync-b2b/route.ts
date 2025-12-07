import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max for Vercel

const SHOPIFY_B2B_STORE = process.env.SHOPIFY_B2B_STORE_URL;
const SHOPIFY_B2B_TOKEN = process.env.SHOPIFY_B2B_ADMIN_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  customer?: { first_name?: string; last_name?: string; email?: string };
  source_name?: string;
  fulfillments?: ShopifyFulfillment[];
  cancelled_at?: string;
}

interface ShopifyFulfillment {
  id: number;
  created_at: string;
  line_items: ShopifyLineItem[];
}

interface ShopifyLineItem {
  id: number;
  sku: string;
  quantity: number;
  price: string;
}

interface B2BFulfilled {
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

  while (hasMore) {
    let url: string;
    if (pageInfo) {
      url = `https://${SHOPIFY_B2B_STORE}/admin/api/2024-01/orders.json?page_info=${pageInfo}`;
    } else {
      const params = new URLSearchParams({
        status: "any",
        fulfillment_status: "shipped",
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

    // Check for pagination
    const linkHeader = response.headers.get("link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>; rel="next"/);
      pageInfo = match ? match[1] : null;
      hasMore = !!pageInfo;
    } else {
      hasMore = false;
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  return allOrders;
}

function extractFulfilledItems(orders: ShopifyOrder[]): B2BFulfilled[] {
  const items: B2BFulfilled[] = [];

  for (const order of orders) {
    if (order.cancelled_at) continue;

    const customerName = order.customer
      ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(" ") ||
        order.customer.email ||
        null
      : null;

    for (const fulfillment of order.fulfillments || []) {
      for (const lineItem of fulfillment.line_items) {
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
          fulfilled_at: fulfillment.created_at,
          created_at: order.created_at,
        });
      }
    }
  }

  return items;
}

async function upsertItems(items: B2BFulfilled[]): Promise<number> {
  if (items.length === 0) return 0;

  // Dedupe items
  const deduped = new Map<string, B2BFulfilled>();
  for (const item of items) {
    const key = `${item.order_id}|${item.sku}|${item.fulfilled_at}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      deduped.set(key, { ...item });
    }
  }
  const uniqueItems = Array.from(deduped.values());

  // Batch upsert
  const chunkSize = 500;
  let totalUpserted = 0;

  for (let i = 0; i < uniqueItems.length; i += chunkSize) {
    const chunk = uniqueItems.slice(i, i + chunkSize);
    const { error } = await supabase.from("b2b_fulfilled").upsert(chunk, {
      onConflict: "order_id,sku,fulfilled_at",
      ignoreDuplicates: false,
    });

    if (error) throw error;
    totalUpserted += chunk.length;
  }

  return totalUpserted;
}

export async function GET(request: Request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (process.env.NODE_ENV === "production" && cronSecret) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    if (!SHOPIFY_B2B_STORE || !SHOPIFY_B2B_TOKEN) {
      return NextResponse.json(
        { error: "Missing B2B Shopify credentials" },
        { status: 500 }
      );
    }

    console.log("Starting B2B sync...");
    const startTime = Date.now();

    // Sync last 7 days (catches any delayed fulfillments)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fromDate = sevenDaysAgo.toISOString();

    // Fetch orders
    const orders = await fetchOrders(fromDate);
    console.log(`Fetched ${orders.length} B2B orders`);

    // Extract fulfilled items
    const items = extractFulfilledItems(orders);
    console.log(`Extracted ${items.length} fulfilled line items`);

    // Upsert to Supabase
    const upserted = await upsertItems(items);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Get totals for response
    const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);

    return NextResponse.json({
      success: true,
      elapsed: `${elapsed}s`,
      ordersFound: orders.length,
      itemsExtracted: items.length,
      recordsUpserted: upserted,
      unitsInPeriod: totalUnits,
    });
  } catch (error) {
    console.error("B2B sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 }
    );
  }
}
