/**
 * NetSuite Line Items Sync (Part 3 of 3)
 *
 * Syncs wholesale line items from NetSuite.
 * Uses cursor-based pagination (WHERE t.id > lastTransactionId) since SuiteQL ignores OFFSET.
 * Pass ?full=true for full historical sync.
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
import { BATCH_SIZES } from "@/lib/constants";

const LOCK_NAME = "sync-netsuite-lineitems";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

    console.log(`[NETSUITE] Starting line items sync (${isFullSync ? 'FULL' : 'incremental'}, cursor-based pagination)...`);

    // Pre-fetch all valid transaction IDs from our DB
    // This prevents FK violations by filtering line items for non-existent transactions
    console.log(`[NETSUITE] Loading valid transaction IDs from database...`);
    const { data: validTxnData, error: txnError } = await supabase
      .from("ns_wholesale_transactions")
      .select("ns_transaction_id");

    if (txnError) {
      console.error("[NETSUITE] Failed to load transaction IDs:", txnError);
      throw new Error(`Failed to load transaction IDs: ${txnError.message}`);
    }

    const validTxnIds = new Set(validTxnData?.map(t => t.ns_transaction_id) || []);
    console.log(`[NETSUITE] Loaded ${validTxnIds.size} valid transaction IDs`);

    const limit = 200;
    let lastTransactionId = 0; // Start from the beginning (t.id > 0)
    let totalFetched = 0;
    let totalFiltered = 0; // Records skipped due to missing transaction
    let totalUpserted = 0;
    let hasMore = true;
    let batchCount = 0;
    let stoppedEarly = false;
    const seenLineKeys = new Set<string>(); // Track seen line items (transaction_id:line_id)

    while (hasMore) {
      // Time budget check: stop gracefully before Vercel timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_RUNTIME_MS) {
        console.log(`[NETSUITE] Time budget exceeded (${(elapsed/1000).toFixed(1)}s), stopping gracefully`);
        stoppedEarly = true;
        break;
      }

      batchCount++;
      console.log(`[NETSUITE] Line items batch ${batchCount}: t.id > ${lastTransactionId}`);

      const lineItems = await fetchWholesaleLineItems(lastTransactionId, limit);
      if (lineItems.length === 0) break;
      totalFetched += lineItems.length;

      // Find max transaction ID for cursor pagination
      // Note: NetSuite returns numbers as strings in JSON - must convert!
      const maxTxnId = Math.max(...lineItems.map(li => Number(li.transaction_id)));

      // Filter and transform records
      // CRITICAL: Convert all numeric fields since NetSuite returns strings
      const beforeFilterCount = lineItems.length;
      const records = lineItems
        .filter((li: NSLineItem) => {
          const txnId = Number(li.transaction_id);
          const lineId = Number(li.line_id);
          const key = `${txnId}:${lineId}`;
          // Skip duplicates within this run
          if (seenLineKeys.has(key)) return false;
          seenLineKeys.add(key);
          // Skip line items for transactions not in our DB (FK constraint)
          if (!validTxnIds.has(txnId)) return false;
          return true;
        })
        .map((li: NSLineItem) => ({
          ns_line_id: Number(li.line_id),
          ns_transaction_id: Number(li.transaction_id),
          ns_item_id: li.item_id ? Number(li.item_id) : null,
          sku: li.sku || "UNKNOWN",
          quantity: li.quantity ? parseInt(li.quantity) : 0,
          rate: li.rate ? parseFloat(li.rate) : null,
          net_amount: li.netamount ? parseFloat(li.netamount) : null,
          foreign_amount: li.foreignamount ? parseFloat(li.foreignamount) : null,
          item_type: li.itemtype,
          synced_at: new Date().toISOString(),
        }));

      totalFiltered += beforeFilterCount - records.length;

      if (records.length > 0) {
        // Upsert in batches with FK violation handling
        for (let i = 0; i < records.length; i += BATCH_SIZES.DEFAULT) {
          const batch = records.slice(i, i + BATCH_SIZES.DEFAULT);

          const { error } = await supabase
            .from("ns_wholesale_line_items")
            .upsert(batch, { onConflict: "ns_transaction_id,ns_line_id" });

          if (error) {
            // Log error details for debugging
            console.log(`[NETSUITE] Upsert error: code=${error.code}, message=${error.message?.substring(0, 100)}`);

            // FK violation? Try upserting records individually to save what we can
            const isFkError = error.code === "23503" ||
                             error.message?.includes("foreign key") ||
                             error.message?.includes("violates foreign key constraint") ||
                             error.message?.includes("is not present in table");

            if (isFkError) {
              console.log(`[NETSUITE] FK violation in batch, trying individual inserts...`);
              let batchSuccess = 0;
              for (const record of batch) {
                const { error: singleError } = await supabase
                  .from("ns_wholesale_line_items")
                  .upsert(record, { onConflict: "ns_transaction_id,ns_line_id" });
                if (!singleError) {
                  batchSuccess++;
                }
              }
              totalUpserted += batchSuccess;
              if (batchSuccess > 0) {
                console.log(`[NETSUITE] Saved ${batchSuccess}/${batch.length} from failed batch`);
              }
            } else {
              console.error("[NETSUITE] Line item upsert error:", error);
            }
          } else {
            totalUpserted += batch.length;
          }
        }
      }

      hasMore = lineItems.length === limit;
      lastTransactionId = maxTxnId; // Update cursor for next batch

      console.log(`[NETSUITE] Line items batch ${batchCount} done: ${lineItems.length} fetched, ${records.length} upserted, ${beforeFilterCount - records.length} filtered, next cursor: t.id > ${lastTransactionId}`);

      if (hasMore) {
        // Small delay between batches to avoid overwhelming APIs
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const finalElapsed = Date.now() - startTime;

    // Check data completeness: how many transactions have line items?
    // This determines success regardless of whether we timed out
    const { data: coverageData } = await supabase
      .rpc("count_transactions_with_line_items");
    const txnsWithLineItems = coverageData ?? 0;

    const coveragePercent = validTxnIds.size > 0
      ? ((txnsWithLineItems || 0) / validTxnIds.size) * 100
      : 100;

    // Success if we have good coverage (>80%) - some transactions legitimately have no line items
    // (credits, adjustments, etc.)
    const isDataComplete = coveragePercent >= 80;
    const syncStatus = isDataComplete ? "success" : "partial";

    console.log(`[NETSUITE] Line items sync complete: ${totalUpserted}/${totalFetched} (${totalFiltered} filtered) in ${batchCount} batches, ${(finalElapsed/1000).toFixed(1)}s`);
    console.log(`[NETSUITE] Coverage: ${txnsWithLineItems}/${validTxnIds.size} transactions have line items (${coveragePercent.toFixed(1)}%) - status: ${syncStatus}`);

    // Log sync with proper status
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_lineitems",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: syncStatus,
      records_expected: validTxnIds.size,
      records_synced: totalUpserted,
      duration_ms: finalElapsed,
      details: {
        coverage_percent: Math.round(coveragePercent),
        txns_with_line_items: txnsWithLineItems,
        total_transactions: validTxnIds.size,
        ...(stoppedEarly && { stopped_early: true, last_cursor: lastTransactionId }),
      },
    });

    return NextResponse.json({
      success: isDataComplete,
      partial: !isDataComplete,
      type: "lineitems",
      mode: isFullSync ? "full" : "incremental",
      fetched: totalFetched,
      filtered: totalFiltered,
      upserted: totalUpserted,
      batches: batchCount,
      validTransactions: validTxnIds.size,
      txnsWithLineItems: txnsWithLineItems || 0,
      coveragePercent: Math.round(coveragePercent),
      elapsed: `${(finalElapsed/1000).toFixed(1)}s`,
      stoppedEarly,
      lastCursor: lastTransactionId,
      ...(!isDataComplete && { message: `Coverage at ${coveragePercent.toFixed(1)}% - needs more syncs to reach 80% threshold.` }),
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
