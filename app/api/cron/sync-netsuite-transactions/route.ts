/**
 * NetSuite Transactions Sync (Part 2 of 3)
 *
 * Syncs wholesale transactions from NetSuite.
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

    console.log(`[NETSUITE] Starting transactions sync (${isFullSync ? 'FULL' : `last ${DEFAULT_SYNC_DAYS} days`})...`);

    const limit = 200;
    let offset = 0;
    let totalFetched = 0;
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
      console.log(`[NETSUITE] Transactions batch ${batchCount}: offset ${offset}`);

      const transactions = await fetchWholesaleTransactions(offset, limit, syncDays);
      if (transactions.length === 0) break;
      totalFetched += transactions.length;

      // CRITICAL: NetSuite returns numbers as strings in JSON - must convert!
      const records = transactions
        .filter((t: NSTransaction) => {
          const txnId = Number(t.transaction_id);
          if (seenIds.has(txnId)) return false;
          seenIds.add(txnId);
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

      if (records.length === 0) {
        if (transactions.length < limit) break;
        offset += limit;
        continue;
      }

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

      hasMore = transactions.length === limit;
      console.log(`[NETSUITE] Transactions batch ${batchCount} done: ${transactions.length} fetched, ${records.length} upserted`);

      if (hasMore) {
        offset += limit;
        // Small delay between batches to avoid overwhelming APIs
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[NETSUITE] Transactions sync complete: ${totalUpserted}/${totalFetched} in ${batchCount} batches, ${(elapsed/1000).toFixed(1)}s${stoppedEarly ? " (stopped early)" : ""}`);

    // Post-sync: Compute derived customer metrics using SQL
    // This runs AFTER transactions are updated (6:05 AM) to ensure fresh data
    // Previously ran in customer sync (6:00 AM), causing metrics to be 1 day stale
    // Skip metrics computation if stopped early (incomplete data)
    let metricsComputed = false;
    let computeError: Error | null = null;

    if (!stoppedEarly) {
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
    } else {
      console.log("[NETSUITE] Skipping metrics computation (stopped early, incomplete data)");
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
        last_offset: offset,
      } : null,
    });

    return NextResponse.json({
      success: !stoppedEarly, // Raw data sync succeeded only if not stopped early
      partial: stoppedEarly,
      metricsComputed,
      type: "transactions",
      mode: isFullSync ? "full" : `incremental_${DEFAULT_SYNC_DAYS}d`,
      fetched: totalFetched,
      upserted: totalUpserted,
      batches: batchCount,
      elapsed: `${(elapsed/1000).toFixed(1)}s`,
      stoppedEarly,
      ...(computeError && { metricsError: computeError.message }),
      ...(stoppedEarly && { message: `Partial sync: ${totalUpserted} transactions saved. Run again to continue.` }),
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
