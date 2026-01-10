/**
 * NetSuite Line Items Sync (Part 3 of 3)
 *
 * Syncs wholesale line items from NetSuite.
 * Uses incremental sync by tracking last synced transaction ID.
 * Pass ?full=true for full historical sync.
 *
 * Optimized: Only fetches NEW transactions (typically ~200 items/day)
 * instead of re-fetching all transactions from last N days (was 133K+ items).
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import {
  hasNetSuiteCredentials,
  fetchWholesaleLineItems,
  type NSLineItem,
} from "@/lib/netsuite";

const LOCK_NAME = "sync-netsuite-lineitems";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Batch size for upserts
const LINE_ITEM_BATCH_SIZE = 200;

// Time budget: stop gracefully before Vercel kills us
// Leave 20s buffer for final logging and response
const MAX_RUNTIME_MS = 280_000;

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[NETSUITE] Skipping line items sync - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  // Check for full sync flag
  const url = new URL(request.url);
  const isFullSync = url.searchParams.get("full") === "true";

  try {
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
    }

    // Get the max transaction ID we've already synced (for incremental sync)
    let sinceTransactionId: number | undefined;

    if (!isFullSync) {
      const { data: maxIdData } = await supabase
        .from("ns_wholesale_line_items")
        .select("ns_transaction_id")
        .order("ns_transaction_id", { ascending: false })
        .limit(1)
        .single();

      sinceTransactionId = maxIdData?.ns_transaction_id;
      console.log(`[NETSUITE] Incremental sync: fetching transactions > ${sinceTransactionId || 0}`);
    } else {
      console.log(`[NETSUITE] Full sync: fetching all line items`);
    }

    const limit = 200;
    let offset = 0;
    let totalFetched = 0;
    let totalUpserted = 0;
    let hasMore = true;
    let batchCount = 0;
    let maxTransactionId = sinceTransactionId || 0;

    let stoppedEarly = false;

    while (hasMore) {
      // Time budget check: stop gracefully before Vercel timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_RUNTIME_MS) {
        console.log(`[NETSUITE] Time budget exceeded (${(elapsed/1000).toFixed(1)}s), stopping gracefully`);
        stoppedEarly = true;
        break;
      }

      batchCount++;

      const lineItems = await fetchWholesaleLineItems(offset, limit, sinceTransactionId);

      if (lineItems.length === 0) {
        break;
      }

      totalFetched += lineItems.length;

      // Track max transaction ID for logging
      for (const li of lineItems) {
        if (li.transaction_id > maxTransactionId) {
          maxTransactionId = li.transaction_id;
        }
      }

      const records = lineItems.map((li: NSLineItem) => ({
        ns_line_id: li.line_id,
        ns_transaction_id: li.transaction_id,
        ns_item_id: li.item_id,
        sku: li.sku || "UNKNOWN",
        quantity: li.quantity ? parseInt(li.quantity) : 0,
        rate: li.rate ? parseFloat(li.rate) : null,
        net_amount: li.netamount ? parseFloat(li.netamount) : null,
        foreign_amount: li.foreignamount ? parseFloat(li.foreignamount) : null,
        item_type: li.itemtype,
        synced_at: new Date().toISOString(),
      }));

      // Upsert in batches
      for (let i = 0; i < records.length; i += LINE_ITEM_BATCH_SIZE) {
        const batch = records.slice(i, i + LINE_ITEM_BATCH_SIZE);

        const { error } = await supabase
          .from("ns_wholesale_line_items")
          .upsert(batch, { onConflict: "ns_transaction_id,ns_line_id" });

        if (error) {
          console.error("[NETSUITE] Line item upsert error:", error);
        } else {
          totalUpserted += batch.length;
        }
      }

      hasMore = lineItems.length === limit;

      if (hasMore) {
        offset += limit;
        // Small delay between batches
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    const finalElapsed = Date.now() - startTime;
    const syncStatus = stoppedEarly ? "partial" : "success";

    // Log sync with proper status
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_lineitems",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: syncStatus,
      records_expected: stoppedEarly ? null : totalFetched, // Unknown total when stopped early
      records_synced: totalUpserted,
      duration_ms: finalElapsed,
      details: {
        mode: isFullSync ? "full" : "incremental",
        since_transaction_id: sinceTransactionId,
        max_transaction_id: maxTransactionId,
        batches: batchCount,
        stopped_early: stoppedEarly,
        reason: stoppedEarly ? "time_budget_exceeded" : null,
      },
    });

    console.log(`[NETSUITE] Line items sync: ${totalUpserted}/${totalFetched} in ${batchCount} batches, ${(finalElapsed/1000).toFixed(1)}s${stoppedEarly ? " (stopped early)" : ""}`);

    return NextResponse.json({
      success: !stoppedEarly,
      partial: stoppedEarly,
      type: "lineitems",
      mode: isFullSync ? "full" : "incremental",
      fetched: totalFetched,
      upserted: totalUpserted,
      batches: batchCount,
      sinceTransactionId,
      maxTransactionId,
      elapsed: `${(finalElapsed/1000).toFixed(1)}s`,
      stoppedEarly,
      message: stoppedEarly
        ? `Partial sync: ${totalUpserted} records saved. Next run will continue from transaction ${maxTransactionId}.`
        : undefined,
    });
  } catch (error) {
    console.error("[NETSUITE] Line items sync failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_lineitems",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "failed",
      records_expected: 0,
      records_synced: 0,
      error_message: errorMessage,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  } finally {
    await releaseCronLock(supabase, LOCK_NAME);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
