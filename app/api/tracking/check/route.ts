import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";

const EASYPOST_API_KEY = process.env.EASYPOST_API_KEY;
const EASYPOST_API_URL = "https://api.easypost.com/v2";

export const dynamic = "force-dynamic";

interface EasyPostTracker {
  id: string;
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
}

// GET for Vercel cron, POST for manual triggers
// Both require CRON_SECRET authentication
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }
  return checkTracking();
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }
  return checkTracking();
}

async function checkTracking() {
  if (!EASYPOST_API_KEY) {
    return NextResponse.json(
      { error: "EasyPost API key not configured" },
      { status: 500 }
    );
  }

  try {
    const supabase = createServiceClient();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Get shipments that need checking:
    // - Status is 'in_transit' (not delivered/returned)
    // - Either never checked or checked more than 1 hour ago
    // - Only shipments from Dec 8, 2025 onwards (to limit EasyPost costs)
    const trackingStartDate = "2025-12-08T00:00:00.000Z";

    const { data: shipments, error: fetchError } = await supabase
      .from("shipments")
      .select("id, tracking_number, carrier, easypost_tracker_id")
      .eq("status", "in_transit")
      .gte("shipped_at", trackingStartDate)
      .or(`checked_at.is.null,checked_at.lt.${oneHourAgo.toISOString()}`)
      .limit(400); // Process 400/hour - clears 8k backlog in ~20 hours

    if (fetchError) {
      console.error("Error fetching shipments:", fetchError);
      throw fetchError;
    }

    if (!shipments || shipments.length === 0) {
      return NextResponse.json({ message: "No shipments to check", updated: 0 });
    }

    let updated = 0;
    const errors: string[] = [];

    for (const shipment of shipments) {
      try {
        let tracker: EasyPostTracker;

        if (shipment.easypost_tracker_id) {
          // Retrieve existing tracker
          const response = await fetch(
            `${EASYPOST_API_URL}/trackers/${shipment.easypost_tracker_id}`,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(EASYPOST_API_KEY + ":").toString("base64")}`,
              },
            }
          );

          if (!response.ok) {
            throw new Error(`EasyPost API error: ${response.status}`);
          }

          tracker = await response.json();
        } else {
          // Create new tracker
          const response = await fetch(`${EASYPOST_API_URL}/trackers`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(EASYPOST_API_KEY + ":").toString("base64")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tracker: {
                tracking_code: shipment.tracking_number,
                carrier: normalizeCarrier(shipment.carrier),
              },
            }),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`EasyPost API error: ${response.status} - ${errorBody}`);
          }

          tracker = await response.json();
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
            (now.getTime() - lastScanDate.getTime()) / (24 * 60 * 60 * 1000)
          );
        }

        // Map EasyPost status to our status
        const status = mapEasyPostStatus(tracker.status);

        // Find delivery info if delivered
        let deliveredAt: string | null = null;
        let deliveryState: string | null = null;
        let transitDays: number | null = null;

        if (tracker.status === "delivered") {
          // Find the delivery event
          const deliveryEvent = tracker.tracking_details?.find(
            (d) => d.status === "delivered"
          );
          if (deliveryEvent) {
            deliveredAt = deliveryEvent.datetime;
            deliveryState = deliveryEvent.state;
          }
        }

        // Get destination state from last tracking detail if not delivered
        if (!deliveryState && latestDetail?.state) {
          deliveryState = latestDetail.state;
        }

        // Update shipment - we need shipped_at for transit calc
        const updateData: Record<string, unknown> = {
          easypost_tracker_id: tracker.id,
          status,
          last_scan_at: lastScanAt,
          last_scan_location: lastScanLocation,
          days_without_scan: daysWithoutScan,
          checked_at: now.toISOString(),
          delivery_state: deliveryState,
        };

        if (deliveredAt) {
          updateData.delivered_at = deliveredAt;
        }

        // Update shipment
        const { error: updateError } = await supabase
          .from("shipments")
          .update(updateData)
          .eq("id", shipment.id);

        // Calculate transit days if delivered (need to query shipped_at)
        if (deliveredAt && !updateError) {
          const { data: shipmentData } = await supabase
            .from("shipments")
            .select("shipped_at")
            .eq("id", shipment.id)
            .single();

          if (shipmentData?.shipped_at) {
            const shippedDate = new Date(shipmentData.shipped_at);
            const deliveredDate = new Date(deliveredAt);
            transitDays = Math.ceil(
              (deliveredDate.getTime() - shippedDate.getTime()) / (24 * 60 * 60 * 1000)
            );

            await supabase
              .from("shipments")
              .update({ transit_days: transitDays })
              .eq("id", shipment.id);
          }
        }

        if (updateError) {
          throw updateError;
        }

        updated++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push(`${shipment.tracking_number}: ${message}`);
        console.error(`Error checking ${shipment.tracking_number}:`, err);
      }
    }

    return NextResponse.json({
      message: `Checked ${shipments.length} shipments`,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error in tracking check:", error);
    return NextResponse.json(
      { error: "Failed to check tracking" },
      { status: 500 }
    );
  }
}

function normalizeCarrier(carrier: string | null): string | undefined {
  if (!carrier) return undefined;

  const normalized = carrier.toLowerCase();
  if (normalized.includes("fedex")) return "FedEx";
  if (normalized.includes("ups")) return "UPS";
  if (normalized.includes("usps")) return "USPS";
  if (normalized.includes("dhl")) return "DHL";

  return carrier;
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
