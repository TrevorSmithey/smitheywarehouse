/**
 * NetSuite Line Items Sync (Part 3 of 3)
 *
 * Syncs wholesale line items from NetSuite.
 * Uses incremental sync - only fetches last 7 days by default.
 * Pass ?full=true for full historical sync (uses cursor for large dataset).
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

// Default to 7 days for incremental sync
const DEFAULT_SYNC_DAYS = 7;
// Time limit for full sync processing (leave 60s buffer for cleanup)
const PROCESSING_TIME_LIMIT_MS = 240000; // 4 minutes
// Smaller batch size for line items to avoid statement timeouts
const LINE_ITEM_BATCH_SIZE = 100;

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
  const syncDays = isFullSync ? undefined : DEFAULT_SYNC_DAYS;

  try {
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
    }

    let offset = 0;
    const initialOffset = 0;
    // Track last successfully committed offset to prevent data gaps on partial failures
    let lastCommittedOffset = 0;

    // For full sync, use cursor to handle 250K+ rows across multiple runs
    if (isFullSync) {
      const { data: cursorData } = await supabase
        .from("sync_logs")
        .select("details")
        .eq("sync_type", "netsuite_lineitems_cursor")
        .order("started_at", { ascending: false })
        .limit(1)
        .single();

      const details = cursorData?.details as { next_offset?: number } | null;
      offset = details?.next_offset || 0;
      lastCommittedOffset = offset; // Initialize to starting offset
    }

    console.log(`[NETSUITE] Starting line items sync (${isFullSync ? `FULL from offset ${offset}` : `last ${DEFAULT_SYNC_DAYS} days`})...`);

    const limit = 200;
    let totalFetched = 0;
    let totalUpserted = 0;
    let hasMore = true;
    let batchCount = 0;
    let isComplete = false;
    let hadUpsertFailures = false;

    // Always use time limit to ensure we complete and log within Vercel's 300s limit
    // Even incremental sync can have many records (7 days of line items)
    const useTimeLimit = true;

    while (hasMore && (!useTimeLimit || (Date.now() - startTime) < PROCESSING_TIME_LIMIT_MS)) {
      batchCount++;

      const lineItems = await fetchWholesaleLineItems(offset, limit, syncDays);

      if (lineItems.length === 0) {
        // No more data - sync complete
        isComplete = true;
        break;
      }

      totalFetched += lineItems.length;

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

      // Use smaller batch size to avoid Supabase statement timeouts
      // Track if ALL sub-batches in this fetch succeed
      let allBatchesSucceeded = true;

      for (let i = 0; i < records.length; i += LINE_ITEM_BATCH_SIZE) {
        const batch = records.slice(i, i + LINE_ITEM_BATCH_SIZE);

        // Retry logic for transient failures
        let retries = 3;
        let success = false;
        while (retries > 0 && !success) {
          const { error } = await supabase
            .from("ns_wholesale_line_items")
            .upsert(batch, { onConflict: "ns_transaction_id,ns_line_id" });

          if (error) {
            retries--;
            if (retries > 0) {
              console.warn(`[NETSUITE] Line item upsert retry (${3 - retries}/3): ${error.message}`);
              await new Promise((r) => setTimeout(r, 1000)); // Wait 1s before retry
            } else {
              console.error("[NETSUITE] Line item upsert failed after 3 retries:", error);
              allBatchesSucceeded = false;
              hadUpsertFailures = true;
            }
          } else {
            totalUpserted += batch.length;
            success = true;
          }
        }
      }

      hasMore = lineItems.length === limit;

      // Only advance lastCommittedOffset if ALL sub-batches succeeded
      // This prevents cursor corruption - next run will re-fetch failed batches
      if (allBatchesSucceeded) {
        lastCommittedOffset = offset + limit;
      } else {
        console.warn(`[NETSUITE] Some batches failed at offset ${offset} - cursor will not advance past this point`);
        // Don't advance offset further - stop processing to prevent gaps
        if (isFullSync) {
          console.warn(`[NETSUITE] Stopping full sync early to prevent data gaps. Will resume from offset ${lastCommittedOffset}`);
          break;
        }
      }

      if (batchCount % 10 === 0) {
        console.log(`[NETSUITE] Line items batch ${batchCount}: ${totalFetched} fetched, ${totalUpserted} upserted`);
      }

      if (hasMore) {
        offset += limit;
        // Small delay between batches
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    const elapsed = Date.now() - startTime;

    // Only save cursor for full sync (not needed for incremental)
    if (isFullSync) {
      // Use lastCommittedOffset (not offset) to prevent data gaps
      // If sync is complete, reset to 0 for next full sync
      // Otherwise, resume from lastCommittedOffset to re-fetch any failed batches
      const nextOffset = isComplete ? 0 : lastCommittedOffset;
      await supabase.from("sync_logs").insert({
        sync_type: "netsuite_lineitems_cursor",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: hadUpsertFailures ? "partial" : "success",
        records_expected: 0,
        records_synced: 0,
        duration_ms: 0,
        details: {
          next_offset: nextOffset,
          last_committed_offset: lastCommittedOffset,
          last_attempted_offset: offset,
          had_failures: hadUpsertFailures,
        },
      });
    }

    // Log the actual sync progress
    // Status: "success" if complete with no failures
    //         "partial" if either incomplete (timed out) OR had upsert failures
    const syncStatus = isComplete && !hadUpsertFailures ? "success" : "partial";
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_lineitems",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: syncStatus,
      records_expected: totalFetched,
      records_synced: totalUpserted,
      duration_ms: elapsed,
      details: {
        start_offset: initialOffset,
        end_offset: offset,
        last_committed_offset: lastCommittedOffset,
        is_complete: isComplete,
        had_failures: hadUpsertFailures,
        batches: batchCount,
      },
    });

    console.log(`[NETSUITE] Line items sync: ${totalUpserted}/${totalFetched} in ${batchCount} batches, ${(elapsed/1000).toFixed(1)}s. Complete: ${isComplete}`);

    return NextResponse.json({
      success: true,
      type: "lineitems",
      mode: isFullSync ? "full" : `incremental_${DEFAULT_SYNC_DAYS}d`,
      fetched: totalFetched,
      upserted: totalUpserted,
      batches: batchCount,
      ...(isFullSync ? { startOffset: initialOffset, endOffset: offset } : {}),
      isComplete,
      elapsed: `${(elapsed/1000).toFixed(1)}s`,
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
