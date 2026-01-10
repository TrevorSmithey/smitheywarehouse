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

    // Get the max transaction ID from the TRANSACTIONS table (not line items)
    // This ensures we only fetch line items for transactions that exist in our DB
    // Prevents FK constraint violations
    let sinceTransactionId: number | undefined;

    if (!isFullSync) {
      // CRITICAL: Use transactions table as source of truth
      // Line items can only reference transactions that exist in our DB
      const { data: maxTxnData } = await supabase
        .from("ns_wholesale_transactions")
        .select("ns_transaction_id")
        .order("ns_transaction_id", { ascending: false })
        .limit(1)
        .single();

      // Also get max from line items to understand the gap
      const { data: maxLineData } = await supabase
        .from("ns_wholesale_line_items")
        .select("ns_transaction_id")
        .order("ns_transaction_id", { ascending: false })
        .limit(1)
        .single();

      const maxTxnId = maxTxnData?.ns_transaction_id;
      const maxLineId = maxLineData?.ns_transaction_id;

      // Use the HIGHER of the two - we want to fetch line items for transactions
      // that exist in our DB but don't have line items yet
      sinceTransactionId = maxLineId || 0;

      // But cap it at what exists in transactions table
      if (maxTxnId && sinceTransactionId > maxTxnId) {
        console.log(`[NETSUITE] Line items ahead of transactions: ${sinceTransactionId} > ${maxTxnId}`);
        sinceTransactionId = undefined; // Will default to 0, but transactions don't exist anyway
      }

      console.log(`[NETSUITE] Incremental sync: max_txn=${maxTxnId || 0}, max_line=${maxLineId || 0}, fetching > ${sinceTransactionId || 0}`);
    } else {
      console.log(`[NETSUITE] Full sync: fetching all line items`);
    }

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
    let offset = 0;
    let totalFetched = 0;
    let totalFiltered = 0; // Records skipped due to missing transaction
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

      // Filter to only include line items for transactions that exist in our DB
      const validLineItems = lineItems.filter((li: NSLineItem) => validTxnIds.has(li.transaction_id));
      totalFiltered += lineItems.length - validLineItems.length;

      if (validLineItems.length === 0) {
        // No valid records in this batch, continue to next
        hasMore = lineItems.length === limit;
        if (hasMore) {
          offset += limit;
          await new Promise((r) => setTimeout(r, 50));
        }
        continue;
      }

      const records = validLineItems.map((li: NSLineItem) => ({
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

      // Upsert in batches with FK violation handling
      for (let i = 0; i < records.length; i += LINE_ITEM_BATCH_SIZE) {
        const batch = records.slice(i, i + LINE_ITEM_BATCH_SIZE);

        const { error } = await supabase
          .from("ns_wholesale_line_items")
          .upsert(batch, { onConflict: "ns_transaction_id,ns_line_id" });

        if (error) {
          // Log error details for debugging
          console.log(`[NETSUITE] Upsert error: code=${error.code}, message=${error.message?.substring(0, 100)}`);

          // FK violation? Try upserting records individually to save what we can
          // Supabase wraps postgres errors, so check multiple patterns
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
              // Don't log individual FK errors - they're expected
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
      records_expected: stoppedEarly ? null : totalFetched,
      records_synced: totalUpserted,
      duration_ms: finalElapsed,
      details: {
        mode: isFullSync ? "full" : "incremental",
        since_transaction_id: sinceTransactionId,
        max_transaction_id: maxTransactionId,
        batches: batchCount,
        filtered: totalFiltered,
        valid_transactions: validTxnIds.size,
        stopped_early: stoppedEarly,
        reason: stoppedEarly ? "time_budget_exceeded" : null,
      },
    });

    console.log(`[NETSUITE] Line items sync: ${totalUpserted}/${totalFetched} (${totalFiltered} filtered) in ${batchCount} batches, ${(finalElapsed/1000).toFixed(1)}s${stoppedEarly ? " (stopped early)" : ""}`);

    return NextResponse.json({
      success: !stoppedEarly && totalFiltered < totalFetched, // Success if we actually saved something
      partial: stoppedEarly,
      type: "lineitems",
      mode: isFullSync ? "full" : "incremental",
      fetched: totalFetched,
      filtered: totalFiltered,
      upserted: totalUpserted,
      batches: batchCount,
      validTransactions: validTxnIds.size,
      sinceTransactionId,
      maxTransactionId,
      elapsed: `${(finalElapsed/1000).toFixed(1)}s`,
      stoppedEarly,
      message: stoppedEarly
        ? `Partial sync: ${totalUpserted} records saved, ${totalFiltered} filtered (missing txn). Next run continues from ${maxTransactionId}.`
        : totalFiltered > 0
          ? `Sync complete: ${totalUpserted} saved, ${totalFiltered} skipped (transactions not in DB - run transactions sync first)`
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
