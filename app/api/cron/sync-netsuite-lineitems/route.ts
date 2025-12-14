/**
 * NetSuite Line Items Sync (Part 3 of 3)
 *
 * Syncs wholesale line items from NetSuite.
 * Uses chunked approach - fetches in 200-row batches with safety limit.
 * Optimized for Vercel serverless timeout constraints.
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

    console.log("[NETSUITE] Starting line items sync...");

    // Fetch all batches sequentially (smaller batches to avoid timeouts)
    const limit = 200; // Reduced from 1000 to match customers sync
    let offset = 0;
    let totalFetched = 0;
    let totalUpserted = 0;
    let hasMore = true;
    let batchCount = 0;

    while (hasMore && batchCount < 100) { // Safety limit: max 20,000 line items
      batchCount++;
      console.log(`[NETSUITE] Line items batch ${batchCount}: offset ${offset}`);

      const lineItems = await fetchWholesaleLineItems(offset, limit);
      if (lineItems.length === 0) break;
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
      console.log(`[NETSUITE] Line items batch ${batchCount} done: ${lineItems.length} fetched, ${records.length} upserted`);

      if (hasMore) {
        offset += limit;
        // Small delay between batches to avoid overwhelming APIs
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[NETSUITE] Line items sync complete: ${totalUpserted}/${totalFetched} in ${batchCount} batches, ${(elapsed/1000).toFixed(1)}s`);

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_lineitems",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: totalFetched,
      records_synced: totalUpserted,
      duration_ms: elapsed,
    });

    return NextResponse.json({
      success: true,
      type: "lineitems",
      fetched: totalFetched,
      upserted: totalUpserted,
      batches: batchCount,
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
