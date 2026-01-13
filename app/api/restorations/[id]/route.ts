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
import { requireAuth } from "@/lib/auth/server";

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
  "damaged", // Decision point - can continue restoration or trash
  "pending_trash", // Customer said trash it, awaiting physical disposal confirmation
  "trashed", // Terminal - physically disposed
] as const;

type KnownStatus = (typeof KNOWN_STATUSES)[number];

// Valid damage reasons (must match frontend DAMAGE_REASONS)
const VALID_DAMAGE_REASONS = [
  "damaged_upon_arrival",
  "damaged_internal",
  "lost",
] as const;

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
// Note: delivered_warehouse can now go directly to at_restoration (skipping "received")
const VALID_TRANSITIONS: Record<KnownStatus, KnownStatus[]> = {
  // Forward + backward + terminal transitions
  pending_label: ["label_sent", "cancelled", "damaged"],
  label_sent: ["in_transit_inbound", "pending_label", "cancelled", "damaged"],
  in_transit_inbound: ["delivered_warehouse", "label_sent", "pending_label", "cancelled", "damaged"],
  delivered_warehouse: ["at_restoration", "received", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  received: ["at_restoration", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  at_restoration: ["ready_to_ship", "received", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  ready_to_ship: ["shipped", "at_restoration", "received", "delivered_warehouse", "in_transit_inbound", "label_sent", "pending_label", "cancelled", "damaged"],
  shipped: ["delivered", "ready_to_ship", "at_restoration", "received", "damaged"], // Limited backward after shipping
  delivered: [], // Terminal state
  cancelled: [], // Terminal state
  damaged: ["delivered_warehouse", "pending_trash", "ready_to_ship"], // Decision point: continue restoration, trash, or return to customer
  pending_trash: ["trashed"], // Only valid transition is confirming disposal
  trashed: [], // Terminal state
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
  pending_trash: "trashed_at",
  trashed: "trash_confirmed_at",
};

interface UpdateBody {
  status?: string;
  tag_numbers?: string[]; // Array of tag numbers (replaces magnet_number)
  magnet_number?: string; // Legacy support - will be converted to tag_numbers
  notes?: string;
  photos?: string[]; // Array of Supabase Storage URLs (max 3)
  cancellation_reason?: string;
  damage_reason?: string; // For damaged status: damaged_upon_arrival, damaged_internal, lost
  resolved_at?: string; // When CS marks a damaged item as resolved (customer contacted, handled)
  local_pickup?: boolean; // If true, customer will pick up restored item (no return shipping)
  // Damaged workflow action flags
  continue_restoration?: boolean; // If true, return damaged item to delivered_warehouse with was_damaged flag
  mark_for_trash?: boolean; // If true, move damaged item to pending_trash (customer said trash it)
  return_to_customer?: boolean; // If true, skip restoration and go directly to ready_to_ship (return as-is)
  confirm_trashed?: boolean; // If true, move pending_trash item to trashed (physical disposal confirmed)
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

// =============================================================================
// TEAMS NOTIFICATION - Fire and forget alert for damaged items
// =============================================================================

const DAMAGE_REASON_LABELS: Record<string, string> = {
  damaged_upon_arrival: "Damaged Upon Arrival",
  damaged_internal: "Damaged Internally",
  lost: "Lost",
};

/**
 * Sends a Teams notification when a restoration is marked as damaged.
 * Non-blocking: failures are logged but don't affect the API response.
 * Includes 5-second timeout to prevent hanging if webhook is slow.
 */
async function sendTeamsNotification(
  restorationId: number,
  damageReason?: string
): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[RESTORATION API] TEAMS_WEBHOOK_URL not configured, skipping notification");
    return;
  }

  // Build direct link to restoration modal
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://smitheywarehouse.vercel.app";
  const directLink = `${baseUrl}/restoration?id=${restorationId}`;

  // Format the damage reason
  const reasonText = DAMAGE_REASON_LABELS[damageReason || ""] || damageReason || "Unknown";

  // Power Automate has issues with emojis and markdown asterisks in JSON
  // Using simple text format that works reliably
  const message = {
    text: `ALERT: Restoration Marked Damaged\n\n` +
          `Restoration ID: #${restorationId}\n` +
          `Reason: ${reasonText}\n\n` +
          `View Details: ${directLink}`,
  };

  // 5-second timeout for non-critical notification
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Log the response body for debugging
      const errorBody = await response.text().catch(() => "Could not read body");
      console.error(`[RESTORATION API] Teams webhook failed: ${response.status} - ${errorBody}`);
      throw new Error(`Teams webhook returned ${response.status}: ${response.statusText}`);
    }

    console.log(`[RESTORATION API] Teams notification sent for restoration #${restorationId}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sends a Teams notification when a restoration is marked for trash disposal.
 * Different message format from damage notification.
 * Non-blocking: failures are logged but don't affect the API response.
 */
async function sendTeamsTrashNotification(
  restorationId: number,
  damageReason?: string
): Promise<void> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[RESTORATION API] TEAMS_WEBHOOK_URL not configured, skipping trash notification");
    return;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://smitheywarehouse.vercel.app";
  const directLink = `${baseUrl}/restoration?id=${restorationId}`;
  const reasonText = DAMAGE_REASON_LABELS[damageReason || ""] || damageReason || "Unknown";

  const message = {
    text: `ACTION REQUIRED: Restoration Marked for Disposal\n\n` +
          `Restoration ID: #${restorationId}\n` +
          `Original Damage Reason: ${reasonText}\n\n` +
          `Item pending physical disposal confirmation.\n` +
          `View Details: ${directLink}`,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Could not read body");
      console.error(`[RESTORATION API] Teams trash webhook failed: ${response.status} - ${errorBody}`);
    } else {
      console.log(`[RESTORATION API] Teams trash notification sent for restoration #${restorationId}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
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
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

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
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

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
      .select("id, status, tag_numbers, magnet_number, damage_reason, was_damaged")
      .eq("id", restorationId)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: "Restoration not found" }, { status: 404 });
    }

    // Build update object
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // =========================================================================
    // DAMAGED WORKFLOW ACTION FLAGS
    // These special flags handle the two-path decision from damaged status
    // =========================================================================

    // Handle "Continue Restoration" - return damaged item to pipeline with flag
    if (body.continue_restoration) {
      if (current.status !== "damaged") {
        return NextResponse.json(
          { error: "continue_restoration can only be used on damaged items" },
          { status: 400 }
        );
      }
      // Return to delivered_warehouse, set was_damaged flag, clear damaged timestamps
      update.status = "delivered_warehouse";
      update.was_damaged = true;
      update.damaged_at = null;
      update.resolved_at = null;
      update.delivered_to_warehouse_at = new Date().toISOString();
      // Note: damage_reason is preserved for analytics
    }

    // Handle "Mark for Trash" - customer said trash it
    if (body.mark_for_trash) {
      if (current.status !== "damaged") {
        return NextResponse.json(
          { error: "mark_for_trash can only be used on damaged items" },
          { status: 400 }
        );
      }
      update.status = "pending_trash";
      update.trashed_at = new Date().toISOString();
      // Note: damage_reason preserved for analytics
    }

    // Handle "Return to Customer" - skip restoration, ship back as-is
    if (body.return_to_customer) {
      if (current.status !== "damaged") {
        return NextResponse.json(
          { error: "return_to_customer can only be used on damaged items" },
          { status: 400 }
        );
      }
      // Go directly to ready_to_ship (skip restoration), set was_damaged flag
      update.status = "ready_to_ship";
      update.was_damaged = true;
      update.damaged_at = null;
      update.resolved_at = null;
      update.back_from_restoration_at = new Date().toISOString();
      // Note: damage_reason preserved for analytics
    }

    // Handle "Confirm Trashed" - physical disposal confirmed by operator
    if (body.confirm_trashed) {
      if (current.status !== "pending_trash") {
        return NextResponse.json(
          { error: "confirm_trashed can only be used on pending_trash items" },
          { status: 400 }
        );
      }
      update.status = "trashed";
      update.trash_confirmed_at = new Date().toISOString();
    }

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
      if (body.status === "damaged") {
        // Validate damage_reason is required and valid
        if (!body.damage_reason) {
          return NextResponse.json(
            {
              error: "damage_reason is required when marking as damaged",
              valid_reasons: VALID_DAMAGE_REASONS,
            },
            { status: 400 }
          );
        }
        if (!VALID_DAMAGE_REASONS.includes(body.damage_reason as typeof VALID_DAMAGE_REASONS[number])) {
          return NextResponse.json(
            {
              error: `Invalid damage_reason: '${body.damage_reason}'`,
              valid_reasons: VALID_DAMAGE_REASONS,
            },
            { status: 400 }
          );
        }
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

    // Handle resolved_at for damaged items (CS marks as resolved)
    if (body.resolved_at !== undefined) {
      // Validate it's either null or a valid ISO timestamp
      if (body.resolved_at !== null) {
        const resolvedDate = new Date(body.resolved_at);
        if (isNaN(resolvedDate.getTime())) {
          return NextResponse.json(
            { error: "Invalid resolved_at timestamp" },
            { status: 400 }
          );
        }
        update.resolved_at = resolvedDate.toISOString();
      } else {
        update.resolved_at = null;
      }
    }

    // Handle local_pickup toggle (customer picks up vs ship back)
    if (body.local_pickup !== undefined) {
      if (typeof body.local_pickup !== "boolean") {
        return NextResponse.json(
          { error: "local_pickup must be a boolean" },
          { status: 400 }
        );
      }
      update.local_pickup = body.local_pickup;
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
    // Determine new_status from action flags or explicit status change
    const newStatus = body.continue_restoration
      ? "delivered_warehouse"
      : body.mark_for_trash
        ? "pending_trash"
        : body.return_to_customer
          ? "ready_to_ship"
          : body.confirm_trashed
            ? "trashed"
            : body.status || current.status;

    const eventData: Record<string, unknown> = {
      previous_status: current.status,
      new_status: newStatus,
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
    if (body.resolved_at !== undefined) {
      eventData.resolved_at = body.resolved_at;
    }
    if (body.local_pickup !== undefined) {
      eventData.local_pickup = body.local_pickup;
    }

    // Determine event type based on what changed
    let eventType = "manual_update";
    if (body.continue_restoration) {
      eventType = "continued_from_damaged"; // Damaged item returned to restoration pipeline
      eventData.was_damaged = true;
    } else if (body.mark_for_trash) {
      eventType = "marked_for_trash"; // Customer said trash it
    } else if (body.return_to_customer) {
      eventType = "returned_to_customer"; // Skip restoration, ship back as-is
      eventData.was_damaged = true;
    } else if (body.confirm_trashed) {
      eventType = "disposal_confirmed"; // Physical disposal confirmed by operator
    } else if (body.resolved_at && body.resolved_at !== null) {
      eventType = "damage_resolved"; // CS marked damaged item as resolved (legacy)
    } else if (body.status === "damaged") {
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

    // Send Teams notification when marked as damaged (fire and forget)
    if (body.status === "damaged") {
      sendTeamsNotification(restorationId, body.damage_reason).catch((err) => {
        console.error("[RESTORATION API] Teams notification failed:", err);
      });
    }

    // Send Teams notification when marked for trash (fire and forget)
    if (body.mark_for_trash) {
      sendTeamsTrashNotification(restorationId, current.damage_reason).catch((err) => {
        console.error("[RESTORATION API] Teams trash notification failed:", err);
      });
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
