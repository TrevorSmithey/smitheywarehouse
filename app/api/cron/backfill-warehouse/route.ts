import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { extractWarehouse, withRetry, SHOPIFY_API_VERSION } from "@/lib/shopify";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

const LOCK_NAME = "backfill-warehouse";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 1 minute max

/**
 * Cron job to backfill warehouse field from Shopify tags
 *
 * Runs hourly to catch orders where Shopify Flow adds tags AFTER
 * the webhook fires. Only processes web orders (not POS).
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn("[WAREHOUSE BACKFILL] Skipping - another sync in progress");
    return NextResponse.json(
      { success: false, error: "Sync in progress", skipped: true },
      { status: 409 }
    );
  }

  try {
    // Find orders from last 30 days with null warehouse, excluding POS
    // Extended from 7 days to prevent silent data loss on older orders
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: orders, error: fetchError } = await supabase
      .from("orders")
      .select("id, order_name, source_name")
      .is("warehouse", null)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .neq("source_name", "pos")
      .eq("canceled", false)
      .order("created_at", { ascending: false })
      .limit(100); // Process 100 at a time - increased from 50 for faster backlog clearing

    if (fetchError) {
      throw new Error(`Failed to fetch orders: ${fetchError.message}`);
    }

    console.log(`[WAREHOUSE BACKFILL] Found ${orders?.length || 0} orders to process`);

    if (!orders || orders.length === 0) {
      await logSync(supabase, "success", 0, 0, startTime);
      await releaseCronLock(supabase, LOCK_NAME);
      return NextResponse.json({
        success: true,
        processed: 0,
        updated: 0,
        message: "No orders to backfill",
      });
    }

    let updated = 0;
    let skipped = 0;

    const shopifyStore = process.env.SHOPIFY_STORE_URL;
    const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!shopifyStore || !shopifyToken) {
      throw new Error("Missing Shopify credentials");
    }

    for (const order of orders) {
      try {
        // Fetch current tags from Shopify with retry
        const tags = await withRetry(
          async () => {
            const url = `https://${shopifyStore}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.id}.json?fields=id,tags`;
            const response = await fetch(url, {
              headers: {
                "X-Shopify-Access-Token": shopifyToken,
                "Content-Type": "application/json",
              },
            });

            if (!response.ok) {
              throw new Error(`Shopify API error: ${response.status}`);
            }

            const data = await response.json();
            return data.order?.tags || "";
          },
          { maxRetries: 2, baseDelayMs: 500 },
          `Order ${order.order_name}`
        );

        const warehouse = extractWarehouse(tags);

        if (warehouse) {
          const { error: updateError } = await supabase
            .from("orders")
            .update({ warehouse, updated_at: new Date().toISOString() })
            .eq("id", order.id);

          if (!updateError) {
            console.log(`[WAREHOUSE BACKFILL] ${order.order_name}: ${warehouse}`);
            updated++;
          } else {
            console.error(`[WAREHOUSE BACKFILL] ${order.order_name}: update failed - ${updateError.message}`);
            skipped++;
          }
        } else {
          // No warehouse tag found in Shopify
          skipped++;
        }

        // Rate limit: ~2 requests per second
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[WAREHOUSE BACKFILL] ${order.order_name}: ${err}`);
        skipped++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[WAREHOUSE BACKFILL] Done: ${updated} updated, ${skipped} skipped in ${duration}ms`);

    await logSync(supabase, "success", orders.length, updated, startTime);
    await releaseCronLock(supabase, LOCK_NAME);

    return NextResponse.json({
      success: true,
      processed: orders.length,
      updated,
      skipped,
      duration: `${duration}ms`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[WAREHOUSE BACKFILL] Fatal error: ${message}`);

    await logSync(supabase, "error", 0, 0, startTime, message);
    await releaseCronLock(supabase, LOCK_NAME);

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function logSync(
  supabase: ReturnType<typeof createServiceClient>,
  status: "success" | "error",
  processed: number,
  updated: number,
  startTime: number,
  errorMessage?: string
) {
  const duration = Date.now() - startTime;
  await supabase.from("sync_logs").insert({
    sync_type: "backfill-warehouse",
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date().toISOString(),
    status,
    records_expected: processed,
    records_synced: updated,
    duration_ms: duration,
    error_message: errorMessage || null,
    details: { processed, updated },
  });
}
