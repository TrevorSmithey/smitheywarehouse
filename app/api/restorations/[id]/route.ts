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

// =============================================================================
// CONSTANTS - Extracted for consistency and maintainability
// =============================================================================
const MAX_PHOTOS = 3;
const MAX_TAG_NUMBERS = 10;
const MAX_TAG_LENGTH = 20;
const MAX_NOTES_LENGTH = 2000; // Prevent excessively long notes

// All known status values
const KNOWN_STATUSES = [
  "pending_label",
  "label_sent",
  "in_transit_inbound",
  "delivered_warehouse",
  "received",
  "at_restoration",
  "ready_to_ship",
  "shipped",
  "delivered",
  "cancelled",
  "damaged", // Terminal status for damaged items
] as const;

type KnownStatus = (typeof KNOWN_STATUSES)[number];

// Status order for determining forward/backward movement
const STATUS_ORDER = [
  "pending_label",
  "label_sent",
  "in_transit_inbound",
  "delivered_warehouse",
  "received",
  "at_restoration",
  "ready_to_ship",
  "shipped",
  "delivered",
] as const;

// Valid status transitions - NOW INCLUDES BACKWARD MOVEMENT
const VALID_TRANSITIONS: Record<KnownStatus, KnownStatus[]> = {
  // Forward + backward + terminal transitions
  pending_label: ["label_sent", "cancelled", "damaged"],
  label_sent: ["in_transit_inbound", "pending_label", "cancelled", "damaged"],
  in_transit_inbound: ["delivered_warehouse", "label_sent", "pending_label", "cancelled", "damaged"],
  delivered_warehouse: ["received", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  received: ["at_restoration", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  at_restoration: ["ready_to_ship", "received", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  ready_to_ship: ["shipped", "at_restoration", "received", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  shipped: ["delivered", "ready_to_ship", "at_restoration", "received", "damaged"], // Limited backward after shipping
  delivered: [], // Terminal state
  cancelled: [], // Terminal state
  damaged: [], // Terminal state
};

/** Validates that a status is a known status value */
function isKnownStatus(status: string): status is KnownStatus {
  return KNOWN_STATUSES.includes(status as KnownStatus);
}

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
  damaged: "damaged_at",
};

interface UpdateBody {
  status?: string;
  tag_numbers?: string[]; // Array of tag numbers (replaces magnet_number)
  magnet_number?: string; // Legacy support - will be converted to tag_numbers
  notes?: string;
  photos?: string[]; // Array of Supabase Storage URLs (max 3)
  cancellation_reason?: string;
  damage_reason?: string; // For damaged status: broken_beyond_repair, defective_material, lost, other
}

// Supabase project ID for URL validation
const SUPABASE_PROJECT_ID = "rpfkpxoyucocriifutfy";

/**
 * Validates that a URL is a safe Supabase storage URL for restoration photos.
 * Prevents XSS attacks from malicious URLs being stored in the database.
 */
function isValidPhotoUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === `${SUPABASE_PROJECT_ID}.supabase.co` &&
      parsed.pathname.startsWith("/storage/v1/object/public/restoration-photos/")
    );
  } catch {
    return false;
  }
}

/** Get the index of a status in the workflow order */
function getStatusIndex(status: string): number {
  const index = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
  return index >= 0 ? index : -1;
}

/** Check if this is a backward movement */
function isBackwardMovement(fromStatus: string, toStatus: string): boolean {
  const fromIndex = getStatusIndex(fromStatus);
  const toIndex = getStatusIndex(toStatus);
  return fromIndex > 0 && toIndex >= 0 && toIndex < fromIndex;
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
      .select("id, status, tag_numbers, magnet_number")
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
      // First validate that the requested status is a known value
      if (!isKnownStatus(body.status)) {
        return NextResponse.json(
          {
            error: `Unknown status value: '${body.status}'`,
            valid_statuses: KNOWN_STATUSES,
          },
          { status: 400 }
        );
      }

      // Also validate current status is known (should always be true, but defense in depth)
      if (!isKnownStatus(current.status)) {
        console.error(`[RESTORATION API] Invalid current status in DB: ${current.status}`);
        return NextResponse.json(
          { error: "Internal error: restoration has invalid status" },
          { status: 500 }
        );
      }

      const validNextStatuses = VALID_TRANSITIONS[current.status];

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

      // Handle backward movement - clear timestamps for undone statuses
      if (isBackwardMovement(current.status, body.status)) {
        const fromIndex = getStatusIndex(current.status);
        const toIndex = getStatusIndex(body.status);

        // Clear timestamps for ALL statuses from target TO current (INCLUSIVE)
        // This ensures the target status gets a fresh timestamp, not the old one
        for (let i = toIndex; i <= fromIndex; i++) {
          const statusToClear = STATUS_ORDER[i];
          const timestampField = STATUS_TIMESTAMP_FIELDS[statusToClear];
          if (timestampField) {
            update[timestampField] = null;
          }
        }

        // Now set fresh timestamp for target status
        const targetTimestampField = STATUS_TIMESTAMP_FIELDS[body.status];
        if (targetTimestampField) {
          update[targetTimestampField] = new Date().toISOString();
        }
      } else {
        // Set the appropriate timestamp for forward movement
        const timestampField = STATUS_TIMESTAMP_FIELDS[body.status];
        if (timestampField) {
          update[timestampField] = new Date().toISOString();
        }
      }

      // Handle cancellation
      if (body.status === "cancelled" && body.cancellation_reason) {
        update.cancellation_reason = body.cancellation_reason;
      }

      // Handle damaged status
      // Note: damaged_at is already set by STATUS_TIMESTAMP_FIELDS mapping above
      if (body.status === "damaged" && body.damage_reason) {
        update.damage_reason = body.damage_reason;
      }
    }

    // Update tag_numbers (replaces magnet_number)
    if (body.tag_numbers !== undefined) {
      // Validate and clean tag numbers:
      // - Max MAX_TAG_NUMBERS tags, each max MAX_TAG_LENGTH chars
      // - Alphanumeric + internal dashes only (no leading/trailing dashes)
      // - Pattern: single char OR start+middle+end (e.g., "A", "A1", "ABC-123", not "-ABC" or "ABC-")
      const validTags = body.tag_numbers
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => {
          if (t.length === 0 || t.length > MAX_TAG_LENGTH) return false;
          // Must start and end with alphanumeric, dashes only in middle
          if (!/^[A-Z0-9]([A-Z0-9-]*[A-Z0-9])?$|^[A-Z0-9]$/.test(t)) return false;
          return true;
        })
        .slice(0, MAX_TAG_NUMBERS);

      update.tag_numbers = validTags.length > 0 ? validTags : [];
      // Also update legacy magnet_number for backward compatibility (first tag)
      update.magnet_number = validTags[0] || null;
    } else if (body.magnet_number !== undefined) {
      // Legacy support: single magnet_number converts to tag_numbers array
      const tag = body.magnet_number?.trim().toUpperCase() || null;
      // Validate legacy magnet_number with same rules
      const isValidTag = tag && tag.length <= MAX_TAG_LENGTH &&
        /^[A-Z0-9]([A-Z0-9-]*[A-Z0-9])?$|^[A-Z0-9]$/.test(tag);
      update.magnet_number = isValidTag ? tag : null;
      if (isValidTag && tag) {
        update.tag_numbers = [tag];
      }
    }

    // Update notes (with length limit)
    if (body.notes !== undefined) {
      // Truncate if too long (graceful handling - don't reject)
      const notes = typeof body.notes === "string" ? body.notes : "";
      update.notes = notes.slice(0, MAX_NOTES_LENGTH) || null;
    }

    // Update photos (max MAX_PHOTOS) with URL validation for XSS protection
    if (body.photos !== undefined) {
      if (!Array.isArray(body.photos)) {
        return NextResponse.json(
          { error: "photos must be an array" },
          { status: 400 }
        );
      }

      // Filter to only valid Supabase storage URLs
      const validPhotos = body.photos.filter(isValidPhotoUrl).slice(0, MAX_PHOTOS);

      // Log warning if any invalid URLs were submitted (likely malicious or corrupted)
      if (validPhotos.length !== body.photos.length) {
        const invalidUrls = body.photos.filter((url): url is string => !isValidPhotoUrl(url));
        console.warn(
          "[RESTORATION API] Invalid photo URLs rejected:",
          invalidUrls.map(url => typeof url === "string" ? url.substring(0, 100) : String(url))
        );
      }

      update.photos = validPhotos;
    }

    // Perform update with optimistic locking on status
    // This prevents race conditions where two concurrent requests try to change status simultaneously
    const { data: updated, error: updateError } = await supabase
      .from("restorations")
      .update(update)
      .eq("id", restorationId)
      .eq("status", current.status) // Optimistic lock - only update if status unchanged since we read it
      .select()
      .single();

    // Check for race condition (no rows updated means status changed during our processing)
    if (!updated && !updateError) {
      return NextResponse.json(
        { error: "Status changed during update. Please refresh and try again." },
        { status: 409 }
      );
    }

    if (updateError) {
      console.error("[RESTORATION API] Update error:", updateError);
      return NextResponse.json({ error: "Failed to update restoration" }, { status: 500 });
    }

    // Log the event
    const eventData: Record<string, unknown> = {
      previous_status: current.status,
      new_status: body.status || current.status,
    };

    if (body.tag_numbers) {
      eventData.tag_numbers = body.tag_numbers;
    } else if (body.magnet_number) {
      eventData.tag_numbers = [body.magnet_number];
    }
    if (body.notes) {
      eventData.notes = body.notes;
    }
    if (body.cancellation_reason) {
      eventData.cancellation_reason = body.cancellation_reason;
    }
    if (body.damage_reason) {
      eventData.damage_reason = body.damage_reason;
    }

    // Determine event type based on what changed
    let eventType = "manual_update";
    if (body.status === "damaged") {
      eventType = "marked_damaged";
    } else if (body.status === "received") {
      eventType = "checked_in";
    } else if (body.status === "at_restoration") {
      eventType = "sent_to_restoration";
    } else if (body.status === "ready_to_ship") {
      eventType = "back_from_restoration";
    } else if (body.status === "cancelled") {
      eventType = "cancelled";
    } else if (body.status && isBackwardMovement(current.status, body.status)) {
      eventType = "status_rollback";
      eventData.rollback_from = current.status;
      eventData.rollback_to = body.status;
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
