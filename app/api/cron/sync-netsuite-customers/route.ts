/**
 * NetSuite Customers Sync (Part 1 of 3)
 *
 * Syncs wholesale customers from NetSuite.
 * Uses cursor-based pagination (WHERE id > lastId) since SuiteQL ignores OFFSET.
 * Expect ~1027 wholesale customers total.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import {
  hasNetSuiteCredentials,
  fetchWholesaleCustomers,
  type NSCustomer,
} from "@/lib/netsuite";
import { BATCH_SIZES } from "@/lib/constants";

const LOCK_NAME = "sync-netsuite-customers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Time budget: stop gracefully before Vercel kills us
const MAX_RUNTIME_MS = 280_000;

// Transform raw NetSuite customer to database record
// CRITICAL: NetSuite returns numbers as strings in JSON - must convert!
function transformCustomer(c: NSCustomer) {
  return {
    ns_customer_id: Number(c.id),
    entity_id: c.entityid,
    company_name: c.companyname || "Unknown",
    email: c.email,
    phone: c.phone,
    alt_phone: c.altphone,
    fax: c.fax,
    url: c.url,
    first_sale_date: c.firstsaledate,
    last_sale_date: c.lastsaledate,
    first_order_date: c.firstorderdate,
    last_order_date: c.lastorderdate,
    date_created: c.datecreated ? new Date(c.datecreated).toISOString().split("T")[0] : null,
    last_modified: c.lastmodifieddate,
    is_inactive: c.isinactive === "T",
    parent_id: c.parent ? Number(c.parent) : null,
    terms: c.terms,
    category: c.category,
    entity_status: c.entitystatus,
    sales_rep: c.salesrep,
    territory: c.territory,
    currency: c.currency,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Fetch and upsert a single batch using cursor-based pagination
async function syncBatch(
  supabase: ReturnType<typeof createServiceClient>,
  afterId: number,
  limit: number
): Promise<{ fetched: number; upserted: number; hasMore: boolean; maxId: number }> {
  const customers = await fetchWholesaleCustomers(afterId, limit);
  if (customers.length === 0) {
    return { fetched: 0, upserted: 0, hasMore: false, maxId: afterId };
  }

  const records = customers.map(transformCustomer);
  let upserted = 0;

  // Find max ID for cursor pagination
  const maxId = Math.max(...records.map(r => r.ns_customer_id));

  for (let i = 0; i < records.length; i += BATCH_SIZES.DEFAULT) {
    const batch = records.slice(i, i + BATCH_SIZES.DEFAULT);
    const { error } = await supabase
      .from("ns_wholesale_customers")
      .upsert(batch, { onConflict: "ns_customer_id" });

    if (error) {
      console.error(`[NETSUITE] Upsert error (after id ${afterId}):`, error.message);
    } else {
      upserted += batch.length;
    }
  }

  return { fetched: customers.length, upserted, hasMore: customers.length === limit, maxId };
}

export async function GET(request: Request) {
  const startTime = Date.now();
  console.log("[NETSUITE] Starting customers sync (cursor-based pagination)");

  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[NETSUITE] Skipping customers sync - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  try {
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
    }

    // Fetch all batches sequentially using cursor-based pagination
    // Expect ~1027 wholesale customers, so ~6 batches of 200
    const limit = 200;
    let lastId = 0; // Start from the beginning (id > 0)
    let totalFetched = 0;
    let totalUpserted = 0;
    let hasMore = true;
    let batchCount = 0;
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
      console.log(`[NETSUITE] Batch ${batchCount}: id > ${lastId}`);

      const result = await syncBatch(supabase, lastId, limit);
      totalFetched += result.fetched;
      totalUpserted += result.upserted;
      hasMore = result.hasMore;
      lastId = result.maxId; // Update cursor for next batch

      console.log(`[NETSUITE] Batch ${batchCount} done: ${result.fetched} fetched, ${result.upserted} upserted, next cursor: id > ${lastId}`);

      if (hasMore) {
        // Small delay between batches to avoid overwhelming APIs
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // NOTE: compute_customer_metrics() is now called by sync-netsuite-transactions
    // This ensures metrics are computed AFTER transactions are updated (6:05 AM)
    // Previously this ran here at 6:00 AM, causing 1-day stale data

    const finalElapsed = Date.now() - startTime;
    const syncStatus = stoppedEarly ? "partial" : "success";

    console.log(`[NETSUITE] Sync complete: ${totalUpserted}/${totalFetched} in ${batchCount} batches, ${(finalElapsed/1000).toFixed(1)}s${stoppedEarly ? " (stopped early)" : ""}`);

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_customers",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: syncStatus,
      records_expected: stoppedEarly ? null : totalFetched,
      records_synced: totalUpserted,
      duration_ms: finalElapsed,
      details: stoppedEarly ? {
        stopped_early: true,
        reason: "time_budget_exceeded",
        last_cursor: lastId,
      } : null,
    });

    return NextResponse.json({
      success: !stoppedEarly,
      partial: stoppedEarly,
      type: "customers",
      fetched: totalFetched,
      upserted: totalUpserted,
      batches: batchCount,
      elapsed: `${(finalElapsed/1000).toFixed(1)}s`,
      stoppedEarly,
      lastCursor: lastId,
      message: stoppedEarly
        ? `Partial sync: ${totalUpserted} customers saved. Run again to continue from id > ${lastId}.`
        : undefined,
    });
  } catch (error) {
    console.error("[NETSUITE] Sync failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_customers",
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
