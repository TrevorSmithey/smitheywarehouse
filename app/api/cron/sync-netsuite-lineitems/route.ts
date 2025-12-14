/**
 * NetSuite Line Items Sync (Part 3 of 3)
 *
 * Syncs wholesale line items from NetSuite using incremental cursor.
 * Uses chunked approach - fetches in 200-row batches.
 * Persists cursor between runs to handle large datasets (~250K rows).
 * Each run processes up to 4 minutes of work, then saves progress.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import {
  hasNetSuiteCredentials,
  fetchWholesaleLineItems,
  type NSLineItem,
} from "@/lib/netsuite";
import { BATCH_SIZES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Time limit for processing (leave 60s buffer for cleanup)
const PROCESSING_TIME_LIMIT_MS = 240000; // 4 minutes

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  try {
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
    }

    // Get the cursor (last offset) from sync details
    const { data: cursorData } = await supabase
      .from("sync_logs")
      .select("details")
      .eq("sync_type", "netsuite_lineitems_cursor")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    // Start from saved offset or 0
    const details = cursorData?.details as { next_offset?: number } | null;
    let offset = details?.next_offset || 0;
    const initialOffset = offset;

    console.log(`[NETSUITE] Starting line items sync from offset ${offset}...`);

    const limit = 200;
    let totalFetched = 0;
    let totalUpserted = 0;
    let hasMore = true;
    let batchCount = 0;
    let isComplete = false;

    // Process batches until time limit or no more data
    while (hasMore && (Date.now() - startTime) < PROCESSING_TIME_LIMIT_MS) {
      batchCount++;

      const lineItems = await fetchWholesaleLineItems(offset, limit);

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

      for (let i = 0; i < records.length; i += BATCH_SIZES.DEFAULT) {
        const batch = records.slice(i, i + BATCH_SIZES.DEFAULT);
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

    // Save cursor for next run (or reset to 0 if complete)
    const nextOffset = isComplete ? 0 : offset;
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_lineitems_cursor",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: 0,
      records_synced: 0,
      duration_ms: 0,
      details: { next_offset: nextOffset, last_processed_offset: offset },
    });

    // Log the actual sync progress
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_lineitems",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: isComplete ? "success" : "partial",
      records_expected: totalFetched,
      records_synced: totalUpserted,
      duration_ms: elapsed,
      details: {
        start_offset: initialOffset,
        end_offset: offset,
        is_complete: isComplete,
        batches: batchCount,
      },
    });

    console.log(`[NETSUITE] Line items sync: ${totalUpserted}/${totalFetched} in ${batchCount} batches, ${(elapsed/1000).toFixed(1)}s. Complete: ${isComplete}`);

    return NextResponse.json({
      success: true,
      type: "lineitems",
      fetched: totalFetched,
      upserted: totalUpserted,
      batches: batchCount,
      startOffset: initialOffset,
      endOffset: offset,
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
  }
}

export async function POST(request: Request) {
  return GET(request);
}
