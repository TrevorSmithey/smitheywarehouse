/**
 * Restoration Update API
 *
 * PATCH /api/restorations/[id]
 * Update a restoration's status and details (check-in, handoff, etc.)
 *
 * GET /api/restorations/[id]
 * Get detailed restoration info with event history
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending_label: ["label_sent", "cancelled"],
  label_sent: ["in_transit_inbound", "cancelled"],
  in_transit_inbound: ["delivered_warehouse", "cancelled"],
  delivered_warehouse: ["received", "cancelled"], // Key transition: check-in
  received: ["at_restoration", "cancelled"],
  at_restoration: ["ready_to_ship", "cancelled"],
  ready_to_ship: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [], // Terminal state
  cancelled: [], // Terminal state
};

// Status timestamp field mapping
const STATUS_TIMESTAMP_FIELDS: Record<string, string> = {
  label_sent: "label_sent_at",
  in_transit_inbound: "customer_shipped_at",
  delivered_warehouse: "delivered_to_warehouse_at",
  received: "received_at",
  at_restoration: "sent_to_restoration_at",
  ready_to_ship: "back_from_restoration_at",
  shipped: "shipped_at",
  delivered: "delivered_at",
  cancelled: "cancelled_at",
};

interface UpdateBody {
  status?: string;
  magnet_number?: string;
  notes?: string;
  photos?: string[]; // Array of Supabase Storage URLs (max 3)
  cancellation_reason?: string;
}

// GET - Get detailed restoration with events
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const restorationId = parseInt(id, 10);

    if (isNaN(restorationId)) {
      return NextResponse.json({ error: "Invalid restoration ID" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Get restoration with order details
    const { data: restoration, error: restError } = await supabase
      .from("restorations")
      .select(`
        *,
        orders!left (
          order_name,
          customer_email,
          created_at,
          fulfilled_at,
          warehouse
        )
      `)
      .eq("id", restorationId)
      .single();

    if (restError || !restoration) {
      return NextResponse.json({ error: "Restoration not found" }, { status: 404 });
    }

    // Get event history
    const { data: events, error: eventsError } = await supabase
      .from("restoration_events")
      .select("*")
      .eq("restoration_id", restorationId)
      .order("event_timestamp", { ascending: false });

    if (eventsError) {
      console.error("[RESTORATION API] Error fetching events:", eventsError);
    }

    return NextResponse.json({
      restoration,
      events: events || [],
    });
  } catch (error) {
    console.error("[RESTORATION API] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH - Update restoration status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const restorationId = parseInt(id, 10);

    if (isNaN(restorationId)) {
      return NextResponse.json({ error: "Invalid restoration ID" }, { status: 400 });
    }

    const body: UpdateBody = await request.json();
    const supabase = createServiceClient();

    // Get current restoration
    const { data: current, error: fetchError } = await supabase
      .from("restorations")
      .select("id, status, magnet_number")
      .eq("id", restorationId)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: "Restoration not found" }, { status: 404 });
    }

    // Build update object
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Handle status transition
    if (body.status && body.status !== current.status) {
      const validNextStatuses = VALID_TRANSITIONS[current.status] || [];

      if (!validNextStatuses.includes(body.status)) {
        return NextResponse.json(
          {
            error: `Invalid status transition from '${current.status}' to '${body.status}'`,
            valid_transitions: validNextStatuses,
          },
          { status: 400 }
        );
      }

      update.status = body.status;

      // Set the appropriate timestamp
      const timestampField = STATUS_TIMESTAMP_FIELDS[body.status];
      if (timestampField) {
        update[timestampField] = new Date().toISOString();
      }

      // Handle cancellation
      if (body.status === "cancelled" && body.cancellation_reason) {
        update.cancellation_reason = body.cancellation_reason;
      }
    }

    // Update magnet number (for check-in)
    if (body.magnet_number !== undefined) {
      update.magnet_number = body.magnet_number;
    }

    // Update notes
    if (body.notes !== undefined) {
      update.notes = body.notes;
    }

    // Update photos (max 3)
    if (body.photos !== undefined) {
      update.photos = body.photos.slice(0, 3);
    }

    // Perform update
    const { data: updated, error: updateError } = await supabase
      .from("restorations")
      .update(update)
      .eq("id", restorationId)
      .select()
      .single();

    if (updateError) {
      console.error("[RESTORATION API] Update error:", updateError);
      return NextResponse.json({ error: "Failed to update restoration" }, { status: 500 });
    }

    // Log the event
    const eventData: Record<string, unknown> = {
      previous_status: current.status,
      new_status: body.status || current.status,
    };

    if (body.magnet_number) {
      eventData.magnet_number = body.magnet_number;
    }
    if (body.notes) {
      eventData.notes = body.notes;
    }
    if (body.cancellation_reason) {
      eventData.cancellation_reason = body.cancellation_reason;
    }

    // Determine event type based on what changed
    let eventType = "manual_update";
    if (body.status === "received") {
      eventType = "checked_in";
    } else if (body.status === "at_restoration") {
      eventType = "sent_to_restoration";
    } else if (body.status === "ready_to_ship") {
      eventType = "back_from_restoration";
    } else if (body.status === "cancelled") {
      eventType = "cancelled";
    } else if (body.status && body.status !== current.status) {
      eventType = "status_change";
    }

    const { error: eventError } = await supabase.from("restoration_events").insert({
      restoration_id: restorationId,
      event_type: eventType,
      event_timestamp: new Date().toISOString(),
      event_data: eventData,
      source: "manual",
      created_by: "dashboard_user", // TODO: get from auth
    });

    if (eventError) {
      console.error("[RESTORATION API] Error logging event:", eventError);
      // Don't fail the request for event logging failure
    }

    return NextResponse.json({
      success: true,
      restoration: updated,
    });
  } catch (error) {
    console.error("[RESTORATION API] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
