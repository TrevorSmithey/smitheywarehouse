/**
 * NetSuite Transactions Sync (Part 2 of 3)
 *
 * Syncs wholesale transactions from NetSuite.
 * Uses cursor-based pagination (WHERE id > lastId) since SuiteQL ignores OFFSET.
 * Uses incremental sync - only fetches last 7 days by default.
 * Pass ?full=true for full historical sync.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import {
  hasNetSuiteCredentials,
  fetchWholesaleTransactions,
  type NSTransaction,
} from "@/lib/netsuite";
import { BATCH_SIZES } from "@/lib/constants";

const LOCK_NAME = "sync-netsuite-transactions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Default to 7 days for incremental sync
const DEFAULT_SYNC_DAYS = 7;

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
    console.warn(`[NETSUITE] Skipping transactions sync - another sync is in progress`);
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

    console.log(`[NETSUITE] Starting transactions sync (${isFullSync ? 'FULL' : `last ${DEFAULT_SYNC_DAYS} days`}, cursor-based pagination)...`);

    // Pre-fetch all valid customer IDs from our DB
    // This prevents FK violations - transactions can only reference existing customers
    console.log(`[NETSUITE] Loading valid customer IDs from database...`);
    const { data: validCustomerData, error: customerError } = await supabase
      .from("ns_wholesale_customers")
      .select("ns_customer_id");

    if (customerError) {
      console.error("[NETSUITE] Failed to load customer IDs:", customerError);
      throw new Error(`Failed to load customer IDs: ${customerError.message}`);
    }

    const validCustomerIds = new Set(validCustomerData?.map(c => c.ns_customer_id) || []);
    console.log(`[NETSUITE] Loaded ${validCustomerIds.size} valid customer IDs`);

    const limit = 200;
    let lastTransactionId = 0; // Start from the beginning (id > 0)
    let totalFetched = 0;
    let totalFiltered = 0; // Records skipped due to missing customer
    let totalUpserted = 0;
    let hasMore = true;
    let batchCount = 0;
    let stoppedEarly = false;
    const seenIds = new Set<number>();

    while (hasMore) {
      // Time budget check: stop gracefully before Vercel timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_RUNTIME_MS) {
        console.log(`[NETSUITE] Time budget exceeded (${(elapsed/1000).toFixed(1)}s), stopping gracefully`);
        stoppedEarly = true;
        break;
      }

      batchCount++;
      console.log(`[NETSUITE] Transactions batch ${batchCount}: id > ${lastTransactionId}`);

      const transactions = await fetchWholesaleTransactions(lastTransactionId, limit, syncDays);
      if (transactions.length === 0) break;
      totalFetched += transactions.length;

      // Find max transaction ID for cursor pagination
      const maxTxnId = Math.max(...transactions.map(t => Number(t.transaction_id)));

      // CRITICAL: NetSuite returns numbers as strings in JSON - must convert!
      // Also filter out transactions for customers that don't exist in our DB (FK constraint)
      const beforeFilterCount = transactions.length;
      const records = transactions
        .filter((t: NSTransaction) => {
          const txnId = Number(t.transaction_id);
          const custId = Number(t.customer_id);
          // Skip duplicates within this run
          if (seenIds.has(txnId)) return false;
          seenIds.add(txnId);
          // Skip transactions for customers not in our DB
          if (!validCustomerIds.has(custId)) return false;
          return true;
        })
        .map((t: NSTransaction) => ({
          ns_transaction_id: Number(t.transaction_id),
          tran_id: t.tranid,
          transaction_type: t.transaction_type,
          tran_date: t.trandate,
          foreign_total: t.transaction_total ? parseFloat(t.transaction_total) : null,
          status: t.status,
          ns_customer_id: Number(t.customer_id),
          synced_at: new Date().toISOString(),
        }));

      totalFiltered += beforeFilterCount - records.length;

      if (records.length > 0) {
        for (let i = 0; i < records.length; i += BATCH_SIZES.DEFAULT) {
          const batch = records.slice(i, i + BATCH_SIZES.DEFAULT);
          const { error } = await supabase
            .from("ns_wholesale_transactions")
            .upsert(batch, { onConflict: "ns_transaction_id" });

          if (error) {
            console.error("[NETSUITE] Transaction upsert error:", error);
          } else {
            totalUpserted += batch.length;
          }
        }
      }

      hasMore = transactions.length === limit;
      lastTransactionId = maxTxnId; // Update cursor for next batch

      console.log(`[NETSUITE] Transactions batch ${batchCount} done: ${transactions.length} fetched, ${records.length} upserted, ${beforeFilterCount - records.length} filtered, next cursor: id > ${lastTransactionId}`);

      if (hasMore) {
        // Small delay between batches to avoid overwhelming APIs
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[NETSUITE] Transactions sync complete: ${totalUpserted}/${totalFetched} (${totalFiltered} filtered) in ${batchCount} batches, ${(elapsed/1000).toFixed(1)}s${stoppedEarly ? " (stopped early)" : ""}`);

    // Post-sync: Compute derived customer metrics using SQL
    // This runs AFTER transactions are updated (6:05 AM) to ensure fresh data
    // Previously ran in customer sync (6:00 AM), causing metrics to be 1 day stale
    //
    // CRITICAL FIX (2026-01-10): ALWAYS run metrics computation, even on partial sync
    // The function computes from ALL existing DB data, not just new records
    // Skipping when partial caused metrics to go stale for days/weeks
    // See: CLAUDE.md "Silent Dependency Failures"
    let metricsComputed = false;
    let computeError: Error | null = null;

    console.log("[NETSUITE] Computing customer metrics...");
    const { error } = await supabase.rpc("compute_customer_metrics");
    computeError = error;
    metricsComputed = !computeError;

    if (computeError) {
      // CRITICAL: RPC failure means customer metrics are STALE
      // Dashboard will show wrong health_status, days_since_last_order, etc.
      console.error("[NETSUITE] CRITICAL: Failed to compute metrics:", computeError.message);
      console.error("[NETSUITE] Customer metrics are now STALE - dashboard data may be incorrect");
    } else {
      console.log("[NETSUITE] Customer metrics computed successfully");
    }

    // Sync status reflects whether ALL operations succeeded
    // "partial" = stopped early OR metrics computation failed
    const syncStatus = stoppedEarly ? "partial" : metricsComputed ? "success" : "partial";
    const errorMsg = stoppedEarly
      ? "Stopped early due to time budget. Run again to continue."
      : computeError
        ? `Metrics computation failed: ${computeError.message}. Customer metrics are stale.`
        : null;

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_transactions",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: syncStatus,
      records_expected: stoppedEarly ? null : totalFetched,
      records_synced: totalUpserted,
      duration_ms: elapsed,
      error_message: errorMsg,
      details: stoppedEarly ? {
        stopped_early: true,
        reason: "time_budget_exceeded",
        last_cursor: lastTransactionId,
      } : null,
    });

    return NextResponse.json({
      success: !stoppedEarly, // Raw data sync succeeded only if not stopped early
      partial: stoppedEarly,
      metricsComputed,
      type: "transactions",
      mode: isFullSync ? "full" : `incremental_${DEFAULT_SYNC_DAYS}d`,
      fetched: totalFetched,
      filtered: totalFiltered,
      upserted: totalUpserted,
      batches: batchCount,
      validCustomers: validCustomerIds.size,
      elapsed: `${(elapsed/1000).toFixed(1)}s`,
      stoppedEarly,
      lastCursor: lastTransactionId,
      ...(computeError && { metricsError: computeError.message }),
      ...(stoppedEarly && { message: `Partial sync: ${totalUpserted} transactions saved. Run again to continue from id > ${lastTransactionId}.` }),
      ...(totalFiltered > 0 && !stoppedEarly && { note: `${totalFiltered} transactions skipped (customers not in DB)` }),
    });
  } catch (error) {
    console.error("[NETSUITE] Transactions sync failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_transactions",
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
