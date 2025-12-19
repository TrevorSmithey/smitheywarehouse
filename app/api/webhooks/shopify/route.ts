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

    // Success - no need to log every webhook (was creating 34K rows/day)
    // Failures are still logged below for debugging
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

  // Check if any line item is a restoration SKU (contains "-Rest-")
  const isRestoration = order.line_items.some(
    (item) => item.sku && item.sku.toLowerCase().includes("-rest-")
  );

  // Determine if this is the customer's first order
  const isFirstOrder = order.customer?.orders_count === 1;

  // Extract shipping cost from nested structure
  const totalShipping = order.total_shipping_price_set?.shop_money?.amount
    ? parseFloat(order.total_shipping_price_set.shop_money.amount)
    : null;

  // Upsert order with enhanced analytics fields
  const { error: orderError } = await supabase.from("orders").upsert(
    {
      id: order.id,
      order_name: order.name,
      warehouse,
      fulfillment_status: order.fulfillment_status || null,
      canceled: !!order.cancelled_at,
      created_at: order.created_at,
      fulfilled_at: fulfilledAt,
      is_restoration: isRestoration,
      updated_at: new Date().toISOString(),
      // Enhanced fields for ecommerce analytics
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
      is_first_order: isFirstOrder,
      order_sequence: order.customer?.orders_count || null,
    },
    { onConflict: "id" }
  );

  if (orderError) {
    console.error("Error upserting order:", orderError);
    throw orderError;
  }

  // Upsert line items
  // Use Shopify's fulfillable_quantity directly - it's more reliable than manual calculation
  // fulfilled_quantity = quantity - fulfillable_quantity
  const lineItems = order.line_items.map((item) => ({
    id: item.id,
    order_id: order.id,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    fulfilled_quantity: item.quantity - (item.fulfillable_quantity || 0),
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

  // Throw on shipment errors so Shopify retries the webhook
  // Shipments are critical for transit analytics - we can't afford to silently lose them
  if (shipmentErrors.length > 0) {
    const errorMsg = `[SHIPMENT ERROR] Order ${order.name} (${order.id}): ` +
      `Failed to upsert ${shipmentErrors.length} shipment(s): ` +
      shipmentErrors.map(e => `${e.trackingNumber}: ${e.error}`).join("; ");
    console.error(errorMsg);
    throw new Error(errorMsg);
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
