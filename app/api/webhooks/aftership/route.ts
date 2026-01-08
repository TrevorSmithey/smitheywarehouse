/**
 * Aftership Returns Webhook Handler
 *
 * Receives real-time updates from Aftership Returns when:
 * - return.shipment.provided - Label generated with tracking number
 * - return.shipment.updated - Tracking status changed (InTransit, Delivered, etc.)
 * - return.received - Item marked as received in Aftership
 *
 * Webhook Configuration:
 * - URL: https://smitheywarehouse.vercel.app/api/webhooks/aftership
 * - Secret: Configure in Aftership dashboard and set AFTERSHIP_WEBHOOK_SECRET env var
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  verifyAftershipWebhook,
  type AftershipWebhookPayload,
  type AftershipReturn,
  AftershipClient,
} from "@/lib/aftership";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Get raw body for HMAC verification
    const body = await request.text();
    const signature = request.headers.get("as-signature");

    // Verify webhook signature
    const webhookSecret = process.env.AFTERSHIP_WEBHOOK_SECRET;
    if (webhookSecret && !verifyAftershipWebhook(body, signature, webhookSecret)) {
      console.error("[AFTERSHIP WEBHOOK] Signature verification failed");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload: AftershipWebhookPayload = JSON.parse(body);
    const supabase = createServiceClient();

    console.log(`[AFTERSHIP WEBHOOK] Received event: ${payload.event}`);

    // Skip test webhooks in production
    if (payload.is_test) {
      console.log("[AFTERSHIP WEBHOOK] Test webhook received - skipping processing");
      return NextResponse.json({ success: true, test: true });
    }

    // Handle different webhook events
    switch (payload.event) {
      case "return.shipment.provided":
        await handleShipmentProvided(supabase, payload.data);
        break;

      case "return.shipment.updated":
        await handleShipmentUpdated(supabase, payload.data);
        break;

      case "return.received":
        await handleReturnReceived(supabase, payload.data);
        break;

      case "return.approved":
        await handleReturnApproved(supabase, payload.data);
        break;

      case "return.resolved":
        await handleReturnResolved(supabase, payload.data);
        break;

      default:
        console.log(`[AFTERSHIP WEBHOOK] Unhandled event: ${payload.event}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[AFTERSHIP WEBHOOK] Processed ${payload.event} in ${elapsed}ms`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[AFTERSHIP WEBHOOK] Processing error:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const elapsed = Date.now() - startTime;

    // Log failure for debugging
    try {
      const supabase = createServiceClient();
      await supabase.from("sync_logs").insert({
        sync_type: "aftership_webhook",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 1,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[AFTERSHIP WEBHOOK] Failed to log error:", logError);
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Handle return.shipment.provided - Label was generated
 */
async function handleShipmentProvided(
  supabase: ReturnType<typeof createServiceClient>,
  data: AftershipReturn
) {
  const primaryShipment = data.shipments?.[0];
  if (!primaryShipment?.tracking_number) {
    console.log("[AFTERSHIP WEBHOOK] No tracking number in shipment.provided event");
    return;
  }

  // Find existing restoration by aftership_return_id
  const { data: existing } = await supabase
    .from("restorations")
    .select("id, status")
    .eq("aftership_return_id", data.id)
    .maybeSingle();

  if (existing) {
    // Update existing record
    const { error } = await supabase
      .from("restorations")
      .update({
        return_tracking_number: primaryShipment.tracking_number,
        return_carrier: primaryShipment.slug || primaryShipment.label?.slug,
        return_tracking_status: primaryShipment.tracking_status,
        status: "label_sent",
        label_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) throw error;

    // Log event
    await logRestorationEvent(supabase, existing.id, "label_created", {
      tracking_number: primaryShipment.tracking_number,
      carrier: primaryShipment.slug,
    });

    console.log(`[AFTERSHIP WEBHOOK] Updated restoration ${existing.id} with tracking`);
  } else {
    // Create new restoration record if not exists
    // First, try to find the order
    const orderData = await lookupOrder(supabase, data.order.order_number);

    const { data: newRecord, error } = await supabase
      .from("restorations")
      .insert({
        aftership_return_id: data.id,
        rma_number: data.rma_number,
        order_id: orderData?.id || null,
        is_pos: orderData?.isPOS || false,
        status: "label_sent",
        return_tracking_number: primaryShipment.tracking_number,
        return_carrier: primaryShipment.slug || primaryShipment.label?.slug,
        return_tracking_status: primaryShipment.tracking_status,
        label_sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) throw error;

    // Log creation event
    await logRestorationEvent(supabase, newRecord.id, "created_from_webhook", {
      event: "return.shipment.provided",
      tracking_number: primaryShipment.tracking_number,
    });

    console.log(`[AFTERSHIP WEBHOOK] Created restoration ${newRecord.id}`);
  }
}

/**
 * Handle return.shipment.updated - Tracking status changed
 */
async function handleShipmentUpdated(
  supabase: ReturnType<typeof createServiceClient>,
  data: AftershipReturn
) {
  const primaryShipment = data.shipments?.[0];
  if (!primaryShipment) {
    console.log("[AFTERSHIP WEBHOOK] No shipment in shipment.updated event");
    return;
  }

  // Find existing restoration
  const { data: existing } = await supabase
    .from("restorations")
    .select("id, status, return_tracking_status, customer_shipped_at, delivered_to_warehouse_at")
    .eq("aftership_return_id", data.id)
    .maybeSingle();

  if (!existing) {
    console.log(`[AFTERSHIP WEBHOOK] Restoration not found for ${data.id}`);
    return;
  }

  // Map tracking status to our status
  const isReceived = data.receivings && data.receivings.length > 0;
  const newStatus = AftershipClient.mapTrackingStatus(
    primaryShipment.tracking_status,
    isReceived
  );

  // Build update object
  const update: Record<string, unknown> = {
    return_tracking_status: primaryShipment.tracking_status,
    updated_at: new Date().toISOString(),
  };

  // Only update status if it advances the workflow
  // Don't regress from manual stages (received, at_restoration, etc.)
  const statusOrder = [
    "pending_label",
    "label_sent",
    "in_transit_inbound",
    "delivered_warehouse",
    "received",
    "at_restoration",
    "ready_to_ship",
    "shipped",
    "delivered",
  ];

  const currentIndex = statusOrder.indexOf(existing.status);
  const newIndex = statusOrder.indexOf(newStatus);

  if (newIndex > currentIndex && newIndex <= statusOrder.indexOf("delivered_warehouse")) {
    update.status = newStatus;

    // Set timestamp based on new status
    if (newStatus === "in_transit_inbound" && !existing.customer_shipped_at) {
      update.customer_shipped_at = new Date().toISOString();
    } else if (newStatus === "delivered_warehouse" && !existing.delivered_to_warehouse_at) {
      update.delivered_to_warehouse_at = new Date().toISOString();
    }
  }

  const { error } = await supabase
    .from("restorations")
    .update(update)
    .eq("id", existing.id);

  if (error) throw error;

  // Log tracking update
  await logRestorationEvent(supabase, existing.id, "tracking_update", {
    previous_tracking_status: existing.return_tracking_status,
    new_tracking_status: primaryShipment.tracking_status,
    previous_status: existing.status,
    new_status: update.status || existing.status,
  });

  console.log(
    `[AFTERSHIP WEBHOOK] Updated restoration ${existing.id} tracking: ${primaryShipment.tracking_status}`
  );
}

/**
 * Handle return.received - Item marked as received in Aftership
 */
async function handleReturnReceived(
  supabase: ReturnType<typeof createServiceClient>,
  data: AftershipReturn
) {
  const { data: existing } = await supabase
    .from("restorations")
    .select("id, status")
    .eq("aftership_return_id", data.id)
    .maybeSingle();

  if (!existing) {
    console.log(`[AFTERSHIP WEBHOOK] Restoration not found for ${data.id}`);
    return;
  }

  // Only update if not already past this stage
  if (["pending_label", "label_sent", "in_transit_inbound", "delivered_warehouse"].includes(existing.status)) {
    const receivedAt = data.receivings?.[0]?.received_at || new Date().toISOString();

    const { error } = await supabase
      .from("restorations")
      .update({
        status: "delivered_warehouse",
        delivered_to_warehouse_at: receivedAt,
        received_at: receivedAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) throw error;

    await logRestorationEvent(supabase, existing.id, "aftership_received", {
      received_at: receivedAt,
    });

    console.log(`[AFTERSHIP WEBHOOK] Marked restoration ${existing.id} as received`);
  }
}

/**
 * Handle return.approved - Return request approved
 */
async function handleReturnApproved(
  supabase: ReturnType<typeof createServiceClient>,
  data: AftershipReturn
) {
  const { data: existing } = await supabase
    .from("restorations")
    .select("id")
    .eq("aftership_return_id", data.id)
    .maybeSingle();

  if (existing) {
    // Just log the event - status will be updated when shipment is provided
    await logRestorationEvent(supabase, existing.id, "return_approved", {
      approved_at: data.approved_at,
    });
  }
}

/**
 * Handle return.resolved - Return marked as resolved/complete in Aftership
 */
async function handleReturnResolved(
  supabase: ReturnType<typeof createServiceClient>,
  data: AftershipReturn
) {
  const { data: existing } = await supabase
    .from("restorations")
    .select("id")
    .eq("aftership_return_id", data.id)
    .maybeSingle();

  if (existing) {
    await logRestorationEvent(supabase, existing.id, "aftership_resolved", {
      resolved_at: data.resolved_at,
    });
  }
}

/**
 * Lookup order by order number
 * Returns order ID and whether it's a POS order
 */
async function lookupOrder(
  supabase: ReturnType<typeof createServiceClient>,
  orderNumber: string
): Promise<{ id: number; isPOS: boolean } | null> {
  const { data } = await supabase
    .from("orders")
    .select("id, source_name")
    .eq("order_name", orderNumber)
    .maybeSingle();

  if (!data?.id) return null;

  return {
    id: data.id,
    isPOS: data.source_name === "pos",
  };
}

/**
 * Log a restoration event for audit trail
 */
async function logRestorationEvent(
  supabase: ReturnType<typeof createServiceClient>,
  restorationId: number,
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("restoration_events").insert({
    restoration_id: restorationId,
    event_type: eventType,
    event_timestamp: new Date().toISOString(),
    event_data: eventData,
    source: "aftership_webhook",
    created_by: "system",
  });

  if (error) {
    console.error("[AFTERSHIP WEBHOOK] Error logging event:", error);
  }
}
