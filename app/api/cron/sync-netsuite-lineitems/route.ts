/**
 * NetSuite Line Items Sync (Part 3 of 3)
 *
 * Syncs wholesale line items from NetSuite.
 * Split from main sync to avoid Vercel timeout.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import {
  hasNetSuiteCredentials,
  testConnection,
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

    const connected = await testConnection();
    if (!connected) {
      throw new Error("Failed to connect to NetSuite API");
    }

    let offset = 0;
    const limit = 1000;
    let totalFetched = 0;
    let totalUpserted = 0;

    while (true) {
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

      console.log(`[NETSUITE] Line items: ${totalFetched} fetched, ${totalUpserted} upserted`);

      if (lineItems.length < limit) break;
      offset += limit;
      await new Promise((r) => setTimeout(r, 200));
    }

    const elapsed = Date.now() - startTime;

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_lineitems",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: totalFetched,
      records_synced: totalUpserted,
      duration_ms: elapsed,
    });

    console.log(`[NETSUITE] Line items sync complete: ${totalUpserted} records in ${(elapsed/1000).toFixed(1)}s`);

    return NextResponse.json({
      success: true,
      type: "lineitems",
      fetched: totalFetched,
      upserted: totalUpserted,
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
