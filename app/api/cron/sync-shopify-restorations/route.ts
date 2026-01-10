/**
 * Shopify Restorations Sync
 *
 * Creates restoration records from Shopify orders containing restoration SKUs.
 * This is the SOURCE OF TRUTH for restoration orders.
 *
 * - POS orders: Customer drops off pan in store → immediate "received" status
 * - Web orders: Customer ships pan back → starts at "pending_label"
 *
 * AfterShip Returns sync updates tracking info for web orders.
 *
 * POST /api/cron/sync-shopify-restorations
 *   Body: { mode: "full" | "recent", days?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

const LOCK_NAME = "sync-shopify-restorations";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

interface SyncOptions {
  mode: "full" | "recent";
  days?: number;
}

interface SyncStats {
  ordersScanned: number;
  posOrdersFound: number;
  webOrdersFound: number;
  alreadyExists: number;
  created: number;
  errors: number;
}

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn("[SHOPIFY RESTO SYNC] Skipping - another sync is in progress");
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  const stats: SyncStats = {
    ordersScanned: 0,
    posOrdersFound: 0,
    webOrdersFound: 0,
    alreadyExists: 0,
    created: 0,
    errors: 0,
  };

  try {
    // Parse options
    let options: SyncOptions = { mode: "recent", days: 90 };
    try {
      const body = await request.json();
      if (body.mode === "full" || body.mode === "recent") {
        options.mode = body.mode;
      }
      if (typeof body.days === "number" && body.days > 0) {
        options.days = body.days;
      }
    } catch {
      // Use defaults
    }

    console.log(`[SHOPIFY RESTO SYNC] Starting ${options.mode} sync...`);

    // Build date filter for recent mode
    let dateFilter = "";
    if (options.mode === "recent") {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - (options.days || 90));
      dateFilter = cutoffDate.toISOString();
      console.log(`[SHOPIFY RESTO SYNC] Syncing orders since ${dateFilter}`);
    }

    // Find orders with restoration SKUs that don't have restoration records
    // Using a subquery to find restoration orders
    let query = supabase
      .from("orders")
      .select(`
        id,
        order_name,
        source_name,
        created_at,
        line_items!inner (
          sku,
          title,
          quantity
        )
      `)
      .ilike("line_items.sku", "%rest%");

    if (dateFilter) {
      query = query.gte("created_at", dateFilter);
    }

    const { data: restorationOrders, error: queryError } = await query;

    if (queryError) {
      throw new Error(`Failed to query orders: ${queryError.message}`);
    }

    stats.ordersScanned = restorationOrders?.length || 0;
    console.log(`[SHOPIFY RESTO SYNC] Found ${stats.ordersScanned} restoration orders`);

    if (!restorationOrders || restorationOrders.length === 0) {
      const duration = Date.now() - startTime;
      return NextResponse.json({
        success: true,
        message: "No restoration orders found",
        stats,
        duration,
      });
    }

    // Get existing restoration order_ids to avoid duplicates
    const orderIds = restorationOrders.map((o) => o.id);
    const { data: existingRestorations } = await supabase
      .from("restorations")
      .select("order_id")
      .in("order_id", orderIds);

    const existingOrderIds = new Set(existingRestorations?.map((r) => r.order_id) || []);

    // Process each order
    for (const order of restorationOrders) {
      // Skip if restoration record already exists
      if (existingOrderIds.has(order.id)) {
        stats.alreadyExists++;
        continue;
      }

      const isPOS = order.source_name === "pos";
      if (isPOS) {
        stats.posOrdersFound++;
      } else {
        stats.webOrdersFound++;
      }

      try {
        await createRestorationFromOrder(supabase, order, isPOS);
        stats.created++;
      } catch (error) {
        console.error(
          `[SHOPIFY RESTO SYNC] Error creating restoration for ${order.order_name}:`,
          error
        );
        stats.errors++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[SHOPIFY RESTO SYNC] Complete in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      mode: options.mode,
      stats,
      duration,
    });
  } catch (error) {
    console.error("[SHOPIFY RESTO SYNC] Fatal error:", error);
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

interface OrderWithLineItems {
  id: number;
  order_name: string;
  source_name: string;
  created_at: string;
  line_items: Array<{
    sku: string;
    title: string;
    quantity: number;
  }>;
}

/**
 * Create a restoration record from a Shopify order
 *
 * POS orders: Start at "received" (Smithey has immediate possession)
 * Web orders: Start at "pending_label" (waiting for AfterShip return)
 */
async function createRestorationFromOrder(
  supabase: ReturnType<typeof createServiceClient>,
  order: OrderWithLineItems,
  isPOS: boolean
): Promise<void> {
  const now = new Date().toISOString();
  const orderCreatedAt = order.created_at;

  // For POS orders, clock starts at order creation (immediate possession)
  // For web orders, clock starts when delivered to warehouse (AfterShip updates this)
  const initialStatus = isPOS ? "received" : "pending_label";

  const record = {
    order_id: order.id,
    status: initialStatus,
    is_pos: isPOS,
    created_at: now,
    updated_at: now,
    // POS orders: received immediately at order creation
    ...(isPOS && {
      received_at: orderCreatedAt,
      delivered_to_warehouse_at: orderCreatedAt, // For SLA calculation
    }),
  };

  const { data: newRestoration, error } = await supabase
    .from("restorations")
    .insert(record)
    .select("id")
    .single();

  if (error) throw error;

  // Log creation event
  await supabase.from("restoration_events").insert({
    restoration_id: newRestoration.id,
    event_type: "synced_from_shopify",
    event_timestamp: now,
    event_data: {
      order_name: order.order_name,
      source_name: order.source_name,
      is_pos: isPOS,
      initial_status: initialStatus,
    },
    source: "shopify_sync",
    created_by: "system",
  });

  console.log(
    `[SHOPIFY RESTO SYNC] Created restoration for ${order.order_name} (${isPOS ? "POS" : "web"}) -> ${initialStatus}`
  );
}

// GET handler for health check
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  return NextResponse.json({
    status: "ready",
    description: "Shopify Restorations Sync - Creates restoration records from Shopify orders",
    options: {
      mode: "full | recent (default: recent)",
      days: "number (default: 90, only for recent mode)",
    },
    notes: {
      pos_orders: "Start at 'received' status (immediate possession)",
      web_orders: "Start at 'pending_label' (AfterShip updates tracking)",
      sku_pattern: "Orders with line items containing '-rest-' in SKU",
    },
  });
}
