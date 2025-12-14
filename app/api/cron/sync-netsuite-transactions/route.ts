/**
 * NetSuite Transactions Sync (Part 2 of 3)
 *
 * Syncs wholesale transactions from NetSuite.
 * Split from main sync to avoid Vercel timeout.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import {
  hasNetSuiteCredentials,
  testConnection,
  fetchWholesaleTransactions,
  type NSTransaction,
} from "@/lib/netsuite";
import { BATCH_SIZES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

    console.log("[NETSUITE] Starting transactions sync...");

    const connected = await testConnection();
    if (!connected) {
      throw new Error("Failed to connect to NetSuite API");
    }

    let offset = 0;
    const limit = 1000;
    let totalFetched = 0;
    let totalUpserted = 0;
    const seenIds = new Set<number>();

    while (true) {
      const transactions = await fetchWholesaleTransactions(offset, limit);
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

      console.log(`[NETSUITE] Transactions: ${totalFetched} fetched, ${totalUpserted} upserted`);

      if (transactions.length < limit) break;
      offset += limit;
      await new Promise((r) => setTimeout(r, 200));
    }

    const elapsed = Date.now() - startTime;

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_transactions",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: totalFetched,
      records_synced: totalUpserted,
      duration_ms: elapsed,
    });

    console.log(`[NETSUITE] Transactions sync complete: ${totalUpserted} records in ${(elapsed/1000).toFixed(1)}s`);

    return NextResponse.json({
      success: true,
      type: "transactions",
      fetched: totalFetched,
      upserted: totalUpserted,
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
