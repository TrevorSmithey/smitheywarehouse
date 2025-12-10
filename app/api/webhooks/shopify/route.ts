import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  verifyShopifyWebhook,
  extractWarehouse,
  calculateFulfilledAt,
} from "@/lib/shopify";
import type { ShopifyOrder } from "@/lib/types";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Get raw body for HMAC verification
    const body = await request.text();
    const signature = request.headers.get("x-shopify-hmac-sha256");
    const topic = request.headers.get("x-shopify-topic");

    // Verify webhook signature
    if (!verifyShopifyWebhook(body, signature)) {
      console.error("Webhook signature verification failed");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const order: ShopifyOrder = JSON.parse(body);
    const supabase = createServiceClient();

    // Handle different webhook topics
    switch (topic) {
      case "orders/create":
      case "orders/updated":
        await upsertOrder(supabase, order);
        break;

      case "orders/cancelled":
        await markOrderCanceled(supabase, order.id);
        break;

      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }

    // Log successful D2C webhook processing for health tracking
    const elapsed = Date.now() - startTime;
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "d2c",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "success",
        records_expected: 1,
        records_synced: 1,
        details: {
          topic,
          orderId: order.id,
          orderName: order.name,
        },
        duration_ms: elapsed,
      });
    } catch (logError) {
      // Don't fail the webhook if logging fails
      console.error("Failed to log D2C webhook health:", logError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook processing error:", error);

    // Log failed D2C webhook for health tracking
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    try {
      const supabase = createServiceClient();
      await supabase.from("sync_logs").insert({
        sync_type: "d2c",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 1,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      // Don't fail if logging fails, but log for visibility
      console.error("Failed to log webhook failure to sync_logs:", logError);
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function upsertOrder(supabase: ReturnType<typeof createServiceClient>, order: ShopifyOrder) {
  const warehouse = extractWarehouse(order.tags);
  const fulfilledAt = calculateFulfilledAt(
    order.fulfillment_status,
    order.fulfillments
  );

  // Upsert order
  const { error: orderError } = await supabase.from("orders").upsert(
    {
      id: order.id,
      order_name: order.name,
      warehouse,
      fulfillment_status: order.fulfillment_status || null,
      canceled: !!order.cancelled_at,
      created_at: order.created_at,
      fulfilled_at: fulfilledAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (orderError) {
    console.error("Error upserting order:", orderError);
    throw orderError;
  }

  // Calculate fulfilled quantities from fulfillments
  const fulfilledQuantities = new Map<number, number>();
  if (order.fulfillments) {
    for (const fulfillment of order.fulfillments) {
      for (const item of fulfillment.line_items || []) {
        const current = fulfilledQuantities.get(item.id) || 0;
        fulfilledQuantities.set(item.id, current + item.quantity);
      }
    }
  }

  // Upsert line items
  const lineItems = order.line_items.map((item) => ({
    id: item.id,
    order_id: order.id,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    fulfilled_quantity: fulfilledQuantities.get(item.id) || 0,
  }));

  if (lineItems.length > 0) {
    const { error: lineItemsError } = await supabase
      .from("line_items")
      .upsert(lineItems, { onConflict: "id" });

    if (lineItemsError) {
      console.error("Error upserting line items:", lineItemsError);
      throw lineItemsError;
    }
  }

  // Upsert shipment tracking data
  // Track failures for visibility - shipments are important for transit analytics
  const shipmentErrors: Array<{ trackingNumber: string; error: string }> = [];

  if (order.fulfillments) {
    for (const fulfillment of order.fulfillments) {
      // Get tracking numbers (can be single or array)
      const trackingNumbers = fulfillment.tracking_numbers ||
        (fulfillment.tracking_number ? [fulfillment.tracking_number] : []);

      for (const trackingNumber of trackingNumbers) {
        if (!trackingNumber) continue;

        const { error: shipmentError } = await supabase.from("shipments").upsert(
          {
            order_id: order.id,
            tracking_number: trackingNumber,
            carrier: fulfillment.tracking_company || null,
            shipped_at: fulfillment.created_at,
            status: "in_transit",
          },
          { onConflict: "order_id,tracking_number" }
        );

        if (shipmentError) {
          // Track error with context for debugging
          shipmentErrors.push({
            trackingNumber,
            error: shipmentError.message || String(shipmentError),
          });
        }
      }
    }
  }

  // Log shipment errors with full context (order + tracking info)
  // These are visible in Vercel logs for debugging
  if (shipmentErrors.length > 0) {
    console.error(
      `[SHIPMENT ERROR] Order ${order.name} (${order.id}): ` +
      `Failed to upsert ${shipmentErrors.length} shipment(s): ` +
      shipmentErrors.map(e => `${e.trackingNumber}: ${e.error}`).join("; ")
    );
  }

  console.log(`Processed order ${order.name} (${order.id})`);
}

async function markOrderCanceled(supabase: ReturnType<typeof createServiceClient>, orderId: number) {
  const { error } = await supabase
    .from("orders")
    .update({
      canceled: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (error) {
    console.error("Error marking order as canceled:", error);
    throw error;
  }

  console.log(`Marked order ${orderId} as canceled`);
}
