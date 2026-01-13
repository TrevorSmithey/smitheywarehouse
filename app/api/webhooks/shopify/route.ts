import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  verifyShopifyWebhook,
  extractWarehouse,
  calculateFulfilledAt,
} from "@/lib/shopify";
import { extractErrorMessage } from "@/lib/database-helpers";
import type { ShopifyOrder } from "@/lib/types";

// Shopify fulfillments/create webhook payload
interface ShopifyFulfillmentWebhook {
  id: number;
  order_id: number;
  created_at: string;
  tracking_number: string | null;
  tracking_numbers: string[];
  tracking_company: string | null;
}

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
      case "orders/fulfilled":
        await upsertOrder(supabase, order);
        break;

      case "orders/cancelled":
        await markOrderCanceled(supabase, order.id);
        break;

      case "fulfillments/create":
        // Fulfillment payload has order_id at top level
        const fulfillment = JSON.parse(body) as ShopifyFulfillmentWebhook;
        await upsertFulfillmentShipment(supabase, fulfillment);
        break;

      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }

    // Success - no need to log every webhook (was creating 34K rows/day)
    // Failures are still logged below for debugging
    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    console.error("Webhook processing error:", errorMessage);

    // Log failed D2C webhook for health tracking
    const elapsed = Date.now() - startTime;
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
  // Shopify sometimes doesn't send orders_count in the webhook payload
  // If missing, check our database to see if we've seen this customer before
  let isFirstOrder = false;
  if (order.customer?.orders_count === 1) {
    // Shopify says it's the first order
    isFirstOrder = true;
  } else if (order.customer?.orders_count === undefined && order.customer?.id) {
    // orders_count not provided - check our database
    const { count } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("shopify_customer_id", order.customer.id)
      .eq("canceled", false);
    isFirstOrder = count === 0; // First order if we have no previous orders for this customer
  }

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
      archived: !!order.closed_at, // Shopify uses closed_at for archived orders
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

  // Auto-create restoration tracking record for restoration orders
  // MUST happen AFTER order upsert to satisfy FK constraint (Pattern J)
  if (isRestoration) {
    await ensureRestorationRecord(supabase, order, fulfilledAt);
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

/**
 * Handle fulfillments/create webhook - upsert shipment tracking directly
 * This is redundant with orders/updated but provides belt-and-suspenders coverage
 */
async function upsertFulfillmentShipment(
  supabase: ReturnType<typeof createServiceClient>,
  fulfillment: ShopifyFulfillmentWebhook
) {
  const trackingNumbers = fulfillment.tracking_numbers ||
    (fulfillment.tracking_number ? [fulfillment.tracking_number] : []);

  if (trackingNumbers.length === 0) {
    console.log(`Fulfillment ${fulfillment.id} has no tracking numbers, skipping`);
    return;
  }

  const shipmentErrors: Array<{ trackingNumber: string; error: string }> = [];

  for (const trackingNumber of trackingNumbers) {
    if (!trackingNumber) continue;

    const { error: shipmentError } = await supabase.from("shipments").upsert(
      {
        order_id: fulfillment.order_id,
        tracking_number: trackingNumber,
        carrier: fulfillment.tracking_company || null,
        shipped_at: fulfillment.created_at,
        status: "in_transit",
      },
      { onConflict: "order_id,tracking_number" }
    );

    if (shipmentError) {
      shipmentErrors.push({
        trackingNumber,
        error: shipmentError.message || String(shipmentError),
      });
    }
  }

  if (shipmentErrors.length > 0) {
    const errorMsg = `[FULFILLMENT SHIPMENT ERROR] Order ${fulfillment.order_id}: ` +
      `Failed to upsert ${shipmentErrors.length} shipment(s): ` +
      shipmentErrors.map(e => `${e.trackingNumber}: ${e.error}`).join("; ");
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  console.log(`Processed fulfillment ${fulfillment.id} for order ${fulfillment.order_id}`);
}

/**
 * Ensure a restoration tracking record exists for restoration orders
 * Creates if not exists, updates status on fulfillment
 *
 * Restoration workflow:
 * - Order created → Create record with status "pending_label"
 * - Aftership webhook → Updates to label_sent/in_transit/delivered
 * - Order fulfilled → Update to "shipped"
 */
async function ensureRestorationRecord(
  supabase: ReturnType<typeof createServiceClient>,
  order: ShopifyOrder,
  fulfilledAt: string | null
) {
  try {
    // Check if restoration record already exists for this order
    const { data: existing } = await supabase
      .from("restorations")
      .select("id, status")
      .eq("order_id", order.id)
      .maybeSingle();

    if (existing) {
      // If order is fulfilled, mark restoration as shipped regardless of current status
      // This prevents stale cards from lingering in the ops board
      if (fulfilledAt && existing.status !== "shipped") {
        const { error } = await supabase
          .from("restorations")
          .update({
            status: "shipped",
            shipped_at: fulfilledAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (!error) {
          // Log shipment event (note if it skipped stages)
          const skippedStages = existing.status !== "ready_to_ship";
          await supabase.from("restoration_events").insert({
            restoration_id: existing.id,
            event_type: "shipped",
            event_timestamp: fulfilledAt,
            event_data: {
              order_name: order.name,
              fulfillment_status: order.fulfillment_status,
              previous_status: existing.status,
              skipped_stages: skippedStages,
            },
            source: "shopify_webhook",
            created_by: "system",
          });

          console.log(`[RESTORATION] Marked ${order.name} as shipped (was: ${existing.status})`);
        }
      }
      return;
    }

    // Create new restoration record for this order
    // Status is "pending_label" - will be updated when Aftership generates label
    const isPOS = order.source_name === "pos";
    const { data: newRecord, error } = await supabase
      .from("restorations")
      .insert({
        order_id: order.id,
        status: "pending_label",
        is_pos: isPOS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      // Duplicate key is OK - record was created by Aftership sync
      if (!error.message.includes("duplicate key")) {
        console.error("[RESTORATION] Error creating record:", error);
      }
      return;
    }

    // Log creation event
    await supabase.from("restoration_events").insert({
      restoration_id: newRecord.id,
      event_type: "order_created",
      event_timestamp: order.created_at,
      event_data: {
        order_name: order.name,
        order_id: order.id,
        customer_email: order.customer?.email,
      },
      source: "shopify_webhook",
      created_by: "system",
    });

    console.log(`[RESTORATION] Created tracking record for ${order.name}`);
  } catch (error) {
    // Don't fail the entire webhook on restoration tracking errors
    // The main order processing should still succeed
    console.error("[RESTORATION] Error in ensureRestorationRecord:", error);
  }
}
