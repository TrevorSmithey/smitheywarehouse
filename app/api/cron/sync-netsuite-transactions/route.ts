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
import {
  hasNetSuiteCredentials,
  fetchWholesaleTransactions,
  type NSTransaction,
} from "@/lib/netsuite";
import { BATCH_SIZES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Default to 7 days for incremental sync
const DEFAULT_SYNC_DAYS = 7;

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

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
    const seenIds = new Set<number>();

    while (hasMore && batchCount < 50) {
      batchCount++;
      console.log(`[NETSUITE] Transactions batch ${batchCount}: offset ${offset}`);

      const transactions = await fetchWholesaleTransactions(offset, limit, syncDays);
      if (transactions.length === 0) break;
      totalFetched += transactions.length;

      const records = transactions
        .filter((t: NSTransaction) => {
          if (seenIds.has(t.transaction_id)) return false;
          seenIds.add(t.transaction_id);
          return true;
        })
        .map((t: NSTransaction) => ({
          ns_transaction_id: t.transaction_id,
          tran_id: t.tranid,
          transaction_type: t.transaction_type,
          tran_date: t.trandate,
          foreign_total: t.transaction_total ? parseFloat(t.transaction_total) : null,
          status: t.status,
          ns_customer_id: t.customer_id,
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
    console.log(`[NETSUITE] Transactions sync complete: ${totalUpserted}/${totalFetched} in ${batchCount} batches, ${(elapsed/1000).toFixed(1)}s`);

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_transactions",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: totalFetched,
      records_synced: totalUpserted,
      duration_ms: elapsed,
    });

    return NextResponse.json({
      success: true,
      type: "transactions",
      mode: isFullSync ? "full" : `incremental_${DEFAULT_SYNC_DAYS}d`,
      fetched: totalFetched,
      upserted: totalUpserted,
      batches: batchCount,
      elapsed: `${(elapsed/1000).toFixed(1)}s`,
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
  }
}

export async function POST(request: Request) {
  return GET(request);
}
