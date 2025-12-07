import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-shopify-hmac-sha256");
    const topic = request.headers.get("x-shopify-topic");

    // Verify webhook signature using B2B secret
    if (!verifyB2BWebhook(body, signature)) {
      console.error("B2B webhook signature verification failed");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const order = JSON.parse(body);
    const supabase = createServiceClient();

    switch (topic) {
      case "orders/create":
      case "orders/updated":
        await upsertB2BOrder(supabase, order);
        break;

      case "orders/cancelled":
        await deleteB2BOrder(supabase, order.id);
        break;

      default:
        console.log(`Unhandled B2B webhook topic: ${topic}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("B2B webhook processing error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function verifyB2BWebhook(body: string, signature: string | null): boolean {
  if (!signature || !process.env.SHOPIFY_B2B_WEBHOOK_SECRET) {
    return false;
  }

  const hmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_B2B_WEBHOOK_SECRET)
    .update(body, "utf8")
    .digest("base64");

  // Check buffer lengths match to prevent timingSafeEqual from throwing
  const hmacBuffer = Buffer.from(hmac);
  const signatureBuffer = Buffer.from(signature);
  if (hmacBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hmacBuffer, signatureBuffer);
}

interface B2BOrder {
  id: number;
  name: string;
  created_at: string;
  cancelled_at?: string;
  customer?: { first_name?: string; last_name?: string; email?: string };
  source_name?: string;
  line_items?: Array<{
    id: number;
    sku: string;
    quantity: number;
    price: string;
  }>;
}

async function upsertB2BOrder(supabase: ReturnType<typeof createServiceClient>, order: B2BOrder) {
  // Skip cancelled orders
  // TODO: Consider including cancelled orders in the future for apples-to-apples
  // comparison with Excel reports that include all orders placed
  if (order.cancelled_at) {
    await deleteB2BOrder(supabase, order.id);
    return;
  }

  const customerName = order.customer
    ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(" ") ||
      order.customer.email ||
      null
    : null;

  const items = [];
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
      price: isNaN(parseFloat(lineItem.price)) ? null : parseFloat(lineItem.price),
      fulfilled_at: order.created_at, // Use order date as "sold" date
      created_at: order.created_at,
    });
  }

  if (items.length > 0) {
    const { error } = await supabase.from("b2b_fulfilled").upsert(items, {
      onConflict: "order_id,sku,fulfilled_at",
      ignoreDuplicates: false,
    });

    if (error) {
      console.error("Error upserting B2B order:", error);
      throw error;
    }
  }

  console.log(`Processed B2B order ${order.name} (${order.id})`);
}

async function deleteB2BOrder(supabase: ReturnType<typeof createServiceClient>, orderId: number) {
  const { error } = await supabase
    .from("b2b_fulfilled")
    .delete()
    .eq("order_id", orderId);

  if (error) {
    console.error("Error deleting B2B order:", error);
    throw error;
  }

  console.log(`Deleted B2B order ${orderId}`);
}
