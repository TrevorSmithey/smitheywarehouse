import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// EasyPost webhook secret (optional but recommended)
const EASYPOST_WEBHOOK_SECRET = process.env.EASYPOST_WEBHOOK_SECRET;

interface EasyPostWebhookEvent {
  id: string;
  object: string;
  mode: string;
  description: string;
  result: {
    id: string;
    object: string;
    tracking_code: string;
    status: string;
    carrier: string;
    est_delivery_date: string | null;
    tracking_details: Array<{
      datetime: string;
      message: string;
      city: string;
      state: string;
      country: string;
      status: string;
    }>;
  };
}

function mapEasyPostStatus(status: string): string {
  switch (status) {
    case "delivered":
      return "delivered";
    case "return_to_sender":
    case "failure":
      return "exception";
    case "unknown":
    case "pre_transit":
    case "in_transit":
    case "out_for_delivery":
    case "available_for_pickup":
    default:
      return "in_transit";
  }
}

export async function POST(request: Request) {
  try {
    // Verify webhook secret if configured
    if (EASYPOST_WEBHOOK_SECRET) {
      const signature = request.headers.get("x-hmac-signature");
      // EasyPost uses HMAC-SHA256 for webhook verification
      // For now, we'll log if signature is missing but still process
      if (!signature) {
        console.warn("[EasyPost Webhook] No signature provided");
      }
      // TODO: Implement proper HMAC verification if needed
    }

    const event: EasyPostWebhookEvent = await request.json();

    // Only process tracker updates
    if (event.object !== "Event" || !event.result || event.result.object !== "Tracker") {
      return NextResponse.json({ message: "Ignored non-tracker event" });
    }

    const tracker = event.result;
    const trackingNumber = tracker.tracking_code;

    console.log(`[EasyPost Webhook] ${trackingNumber}: ${tracker.status}`);

    const supabase = createServiceClient();

    // Find the shipment by tracking number
    const { data: shipment, error: findError } = await supabase
      .from("shipments")
      .select("id, shipped_at")
      .eq("tracking_number", trackingNumber)
      .single();

    if (findError || !shipment) {
      console.log(`[EasyPost Webhook] Shipment not found for ${trackingNumber}`);
      return NextResponse.json({ message: "Shipment not found", tracking: trackingNumber });
    }

    // Get latest tracking detail
    const latestDetail = tracker.tracking_details?.[tracker.tracking_details.length - 1];
    const lastScanAt = latestDetail?.datetime || null;
    const lastScanLocation = latestDetail
      ? [latestDetail.city, latestDetail.state].filter(Boolean).join(", ")
      : null;

    // Calculate days without scan
    let daysWithoutScan = 0;
    if (lastScanAt) {
      const lastScanDate = new Date(lastScanAt);
      daysWithoutScan = Math.floor(
        (Date.now() - lastScanDate.getTime()) / (24 * 60 * 60 * 1000)
      );
    }

    const status = mapEasyPostStatus(tracker.status);

    // Find delivery info if delivered
    let deliveredAt: string | null = null;
    let deliveryState: string | null = null;
    let transitDays: number | null = null;

    if (tracker.status === "delivered") {
      const deliveryEvent = tracker.tracking_details?.find(
        (d) => d.status === "delivered"
      );
      if (deliveryEvent) {
        deliveredAt = deliveryEvent.datetime;
        deliveryState = deliveryEvent.state;

        // Calculate transit days
        if (shipment.shipped_at) {
          const shippedDate = new Date(shipment.shipped_at);
          const deliveredDate = new Date(deliveredAt);
          transitDays = Math.ceil(
            (deliveredDate.getTime() - shippedDate.getTime()) / (24 * 60 * 60 * 1000)
          );
        }
      }
    }

    // Get destination state from last tracking detail if not delivered
    if (!deliveryState && latestDetail?.state) {
      deliveryState = latestDetail.state;
    }

    // Update shipment
    const updateData: Record<string, unknown> = {
      easypost_tracker_id: tracker.id,
      status,
      last_scan_at: lastScanAt,
      last_scan_location: lastScanLocation,
      days_without_scan: daysWithoutScan,
      checked_at: new Date().toISOString(),
      delivery_state: deliveryState,
    };

    if (deliveredAt) {
      updateData.delivered_at = deliveredAt;
    }
    if (transitDays !== null) {
      updateData.transit_days = transitDays;
    }

    const { error: updateError } = await supabase
      .from("shipments")
      .update(updateData)
      .eq("id", shipment.id);

    if (updateError) {
      console.error(`[EasyPost Webhook] Update failed for ${trackingNumber}:`, updateError);
      return NextResponse.json(
        { error: "Failed to update shipment" },
        { status: 500 }
      );
    }

    console.log(`[EasyPost Webhook] Updated ${trackingNumber} -> ${status}`);

    return NextResponse.json({
      success: true,
      tracking: trackingNumber,
      status,
    });
  } catch (error) {
    console.error("[EasyPost Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

// EasyPost may send GET requests to verify the endpoint
export async function GET() {
  return NextResponse.json({ status: "EasyPost webhook endpoint active" });
}
