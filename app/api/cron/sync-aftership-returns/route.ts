/**
 * Aftership Returns Sync
 *
 * Syncs restoration return data from Aftership Returns API to Supabase.
 * Links Aftership returns to Shopify orders via order_number.
 *
 * This is NOT a scheduled cron (we use webhooks for real-time updates).
 * Invoke manually for:
 * - Initial historical backfill
 * - Reconciliation if webhooks missed events
 * - Data cleanup/refresh
 *
 * POST /api/cron/sync-aftership-returns
 *   Body: { mode: "full" | "recent", days?: number }
 *   - full: Sync all historical returns (use for initial backfill)
 *   - recent: Sync last N days (default 30, use for reconciliation)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createAftershipClient,
  AftershipClient,
  type AftershipReturn,
  type ParsedAftershipReturn,
  getRecentSyncDateRange,
  isRestorationReturn,
} from "@/lib/aftership";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { lookupOrdersByNumber } from "@/lib/database-helpers";

const LOCK_NAME = "sync-aftership-returns";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

// Batch size for database operations
const UPSERT_BATCH_SIZE = 50;

interface SyncOptions {
  mode: "full" | "recent";
  days?: number;
}

interface SyncStats {
  totalReturnsFromApi: number;
  restorationReturns: number;
  matchedToOrders: number;
  created: number;
  updated: number;
  errors: number;
}

export async function POST(request: NextRequest) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn("[AFTERSHIP SYNC] Skipping - another sync is in progress");
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  const stats: SyncStats = {
    totalReturnsFromApi: 0,
    restorationReturns: 0,
    matchedToOrders: 0,
    created: 0,
    updated: 0,
    errors: 0,
  };

  try {
    // Parse options from request body
    let options: SyncOptions = { mode: "recent", days: 30 };
    try {
      const body = await request.json();
      if (body.mode === "full" || body.mode === "recent") {
        options.mode = body.mode;
      }
      if (typeof body.days === "number" && body.days > 0) {
        options.days = body.days;
      }
    } catch {
      // Use defaults if body parsing fails
    }

    console.log(`[AFTERSHIP SYNC] Starting ${options.mode} sync...`);

    // Check for required env vars
    if (!process.env.AFTERSHIP_API_KEY) {
      return NextResponse.json(
        { error: "Missing AFTERSHIP_API_KEY environment variable" },
        { status: 500 }
      );
    }

    const aftership = createAftershipClient();

    // Determine date range based on mode
    let dateRange: { createdAtMin?: string; createdAtMax?: string } = {};
    if (options.mode === "recent") {
      dateRange = getRecentSyncDateRange(options.days || 30);
      console.log(
        `[AFTERSHIP SYNC] Syncing returns from ${dateRange.createdAtMin} to ${dateRange.createdAtMax}`
      );
    } else {
      console.log("[AFTERSHIP SYNC] Full sync - fetching all returns");
    }

    // Fetch returns from Aftership
    const returns = await aftership.getAllReturns({
      createdAtMin: dateRange.createdAtMin,
      createdAtMax: dateRange.createdAtMax,
      onProgress: (count) => {
        console.log(`[AFTERSHIP SYNC] Fetched ${count} returns...`);
      },
    });

    stats.totalReturnsFromApi = returns.length;
    console.log(`[AFTERSHIP SYNC] Retrieved ${returns.length} total returns from Aftership`);

    // Filter to restoration returns only (SKU contains "-rest-")
    const restorationReturns = returns.filter(isRestorationReturn);
    stats.restorationReturns = restorationReturns.length;
    console.log(`[AFTERSHIP SYNC] ${restorationReturns.length} are restoration returns`);

    if (restorationReturns.length === 0) {
      const duration = Date.now() - startTime;
      return NextResponse.json({
        success: true,
        message: "No restoration returns found",
        stats,
        duration,
      });
    }

    // Get all unique Shopify order numbers from returns
    const orderNumbers = [...new Set(restorationReturns.map((r) => r.order.order_number))];
    console.log(`[AFTERSHIP SYNC] Looking up ${orderNumbers.length} Shopify orders...`);

    // Batch lookup orders by order_name (which matches Shopify's order_number with # prefix)
    const orderMap = await lookupOrdersByNumber(supabase, orderNumbers);
    console.log(`[AFTERSHIP SYNC] Found ${orderMap.size} matching orders in database`);

    // Parse returns and match to orders
    const parsedReturns: Array<{
      parsed: ParsedAftershipReturn;
      orderId: number | null;
      raw: AftershipReturn;
    }> = [];

    for (const raw of restorationReturns) {
      const parsed = aftership.parseReturn(raw);
      const orderId = orderMap.get(raw.order.order_number) || null;

      if (orderId) {
        stats.matchedToOrders++;
      }

      parsedReturns.push({ parsed, orderId, raw });
    }

    console.log(`[AFTERSHIP SYNC] Matched ${stats.matchedToOrders} returns to orders`);

    // Upsert restorations in batches
    for (let i = 0; i < parsedReturns.length; i += UPSERT_BATCH_SIZE) {
      const batch = parsedReturns.slice(i, i + UPSERT_BATCH_SIZE);

      for (const { parsed, orderId, raw } of batch) {
        try {
          const result = await upsertRestoration(supabase, parsed, orderId, raw);
          if (result.created) {
            stats.created++;
          } else if (result.updated) {
            stats.updated++;
          }
        } catch (error) {
          console.error(
            `[AFTERSHIP SYNC] Error upserting restoration ${parsed.rma_number}:`,
            error
          );
          stats.errors++;
        }
      }

      // Progress logging
      const processed = Math.min(i + UPSERT_BATCH_SIZE, parsedReturns.length);
      console.log(`[AFTERSHIP SYNC] Processed ${processed}/${parsedReturns.length} returns`);
    }

    const duration = Date.now() - startTime;
    console.log(`[AFTERSHIP SYNC] Complete in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      mode: options.mode,
      stats,
      duration,
    });
  } catch (error) {
    console.error("[AFTERSHIP SYNC] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    return NextResponse.json(
      { error: errorMessage, stats, duration: elapsed },
      { status: 500 }
    );
  } finally {
    await releaseCronLock(supabase, LOCK_NAME);
  }
}

/**
 * Upsert a restoration record from Aftership data
 * Creates if not exists, updates if changed
 */
async function upsertRestoration(
  supabase: ReturnType<typeof createServiceClient>,
  parsed: ParsedAftershipReturn,
  orderId: number | null,
  raw: AftershipReturn
): Promise<{ created: boolean; updated: boolean }> {
  // Check if restoration already exists (by aftership_return_id or order_id)
  const { data: existing } = await supabase
    .from("restorations")
    .select("id, status, return_tracking_status")
    .or(
      `aftership_return_id.eq.${parsed.aftership_return_id},order_id.eq.${orderId || -1}`
    )
    .maybeSingle();

  // Map Aftership status to our restoration status
  const status = AftershipClient.mapTrackingStatus(
    parsed.return_tracking_status,
    parsed.is_received_in_aftership
  );

  // Determine stage timestamps based on current data
  const timestamps = mapTimestamps(parsed, raw);

  // DEBUG: Log tracking_status_updated_at for specific RMA to diagnose timestamp issue
  if (raw.rma_number === "PW0Y4GRR") {
    const ps = raw.shipments?.[0];
    console.log(`[DEBUG PW0Y4GRR] tracking_status_updated_at: ${ps?.tracking_status_updated_at}`);
    console.log(`[DEBUG PW0Y4GRR] parsed.received_at: ${parsed.received_at}`);
    console.log(`[DEBUG PW0Y4GRR] timestamps.delivered_to_warehouse_at: ${timestamps.delivered_to_warehouse_at}`);
    console.log(`[DEBUG PW0Y4GRR] raw shipment keys: ${ps ? Object.keys(ps).join(", ") : "no shipment"}`);
  }

  const record = {
    aftership_return_id: parsed.aftership_return_id,
    rma_number: parsed.rma_number,
    order_id: orderId,
    status,
    return_tracking_number: parsed.return_tracking_number,
    return_carrier: parsed.return_carrier,
    return_tracking_status: parsed.return_tracking_status,
    ...timestamps,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Update existing record
    const { error } = await supabase
      .from("restorations")
      .update(record)
      .eq("id", existing.id);

    if (error) throw error;

    // Log event if status changed
    if (existing.status !== status || existing.return_tracking_status !== parsed.return_tracking_status) {
      await logEvent(supabase, existing.id, "tracking_update", {
        previous_status: existing.status,
        new_status: status,
        tracking_status: parsed.return_tracking_status,
      });
    }

    return { created: false, updated: true };
  } else {
    // Create new record
    const { data: newRecord, error } = await supabase
      .from("restorations")
      .insert({
        ...record,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) throw error;

    // Log creation event
    await logEvent(supabase, newRecord.id, "synced_from_aftership", {
      rma_number: parsed.rma_number,
      aftership_return_id: parsed.aftership_return_id,
      initial_status: status,
    });

    return { created: true, updated: false };
  }
}

/**
 * Map Aftership data to our stage timestamps
 */
function mapTimestamps(
  parsed: ParsedAftershipReturn,
  raw: AftershipReturn
): Record<string, string | null> {
  const timestamps: Record<string, string | null> = {
    label_sent_at: null,
    customer_shipped_at: null,
    delivered_to_warehouse_at: null,
    received_at: null,
  };

  const primaryShipment = raw.shipments?.[0];

  // Label sent when return is approved (and has tracking)
  if (parsed.return_tracking_number && raw.approved_at) {
    timestamps.label_sent_at = raw.approved_at;
  }

  // Customer shipped - use shipment created_at if available, else fall back to approved_at
  const inMotionStatuses = ["InTransit", "OutForDelivery", "Delivered", "AvailableForPickup", "AttemptFail", "Exception"];
  if (parsed.return_tracking_status && inMotionStatuses.includes(parsed.return_tracking_status)) {
    timestamps.customer_shipped_at = primaryShipment?.created_at || raw.approved_at || new Date().toISOString();
  }

  // Delivered to warehouse - use tracking_status_updated_at (actual carrier delivery timestamp)
  if (parsed.return_tracking_status === "Delivered") {
    // Priority: tracking_status_updated_at (carrier delivery) > received_at (manual) > null
    timestamps.delivered_to_warehouse_at = primaryShipment?.tracking_status_updated_at || parsed.received_at || null;
  }

  // Received in Aftership (marks as received in their system - manual check-in)
  if (parsed.is_received_in_aftership) {
    timestamps.received_at = parsed.received_at;
  }

  return timestamps;
}

/**
 * Log a restoration event for audit trail
 */
async function logEvent(
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
    source: "aftership_sync",
    created_by: "system",
  });

  if (error) {
    console.error(`[AFTERSHIP SYNC] Error logging event:`, error);
  }
}

// GET handler for health check / status
export async function GET(request: Request) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  return NextResponse.json({
    status: "ready",
    description: "Aftership Returns Sync - POST to trigger sync",
    options: {
      mode: "full | recent (default: recent)",
      days: "number (default: 30, only for recent mode)",
    },
    example: { mode: "recent", days: 30 },
  });
}
